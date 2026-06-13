import express, { Express, Request, Response } from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import dotenv from 'dotenv'
import { connectDatabase, closeDatabase } from './lib/db'
import { initializeDatabaseIndexes } from './lib/db-init'
import { verifyEmailTransport } from './lib/email'
import authRoutes from './routes/auth'
import reportsRoutes from './routes/reports'
import matchesRoutes from './routes/matches'
import verifyRoutes from './routes/verify'
import searchRoutes from './routes/search'
import documentsRoutes from './routes/documents'
import adminRoutes from './routes/admin'
import institutionsRoutes from './routes/institutions'
import adsRoutes from './routes/ads'
import claimsRoutes from './routes/claims'
import documentWatchRoutes from './routes/document-watch'

// Load environment variables
dotenv.config()

const app: Express = express()
const PORT = process.env.PORT || 5000

// Middleware
const allowedOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',')
  : ['http://localhost:3000', 'http://localhost:3001']

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true)
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true)
    } else {
      callback(null, true) // Allow all origins in development
    }
  },
  credentials: true,
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Iyawe Backend API is running' })
})

// API Routes
app.use('/api/auth', authRoutes)
app.use('/api/reports', reportsRoutes)
app.use('/api/matches', matchesRoutes)
app.use('/api/verify', verifyRoutes)
app.use('/api/search', searchRoutes)
app.use('/api/documents', documentsRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/institutions', institutionsRoutes)
app.use('/api/ads', adsRoutes)
app.use('/api/claims', claimsRoutes)
app.use('/api/document-watch', documentWatchRoutes)

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' })
})

// Error handler
app.use((err: Error, req: Request, res: Response, next: any) => {
  console.error('Error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

// Start server (local / Render). On Vercel, the Express app is exported as a serverless handler.
async function startServer() {
  try {
    let dbConnected = false
    let retries = 3

    while (retries > 0 && !dbConnected) {
      try {
        await connectDatabase()
        await initializeDatabaseIndexes()
        dbConnected = true
      } catch (dbError) {
        retries--
        if (retries > 0) {
          console.log(`⏳ Retrying MongoDB connection... (${retries} attempts left)`)
          await new Promise((resolve) => setTimeout(resolve, 2000))
        } else {
          console.warn('⚠️  Could not connect to MongoDB. Server will start but database operations may fail.')
          console.warn('📖 See: backend/MONGODB_SETUP.md for MongoDB setup instructions')
        }
      }
    }

    app.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`)
      console.log(`📝 Health check: http://localhost:${PORT}/health`)
      if (dbConnected) {
        console.log(`✅ MongoDB is connected`)
      } else {
        console.log(`⚠️  MongoDB is NOT connected - API routes may fail`)
      }
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

void (async () => {
  try {
    await connectDatabase()
    await initializeDatabaseIndexes()
  } catch (error) {
    console.warn('⚠️  MongoDB not connected at startup:', error)
  }
  void verifyEmailTransport()
})()

if (!process.env.VERCEL) {
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...')
    await closeDatabase()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down gracefully...')
    await closeDatabase()
    process.exit(0)
  })

  void startServer()
}

export default app
