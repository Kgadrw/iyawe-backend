import { MongoClient, Db, Collection, MongoClientOptions, Document } from 'mongodb'

let client: MongoClient | null = null
let db: Db | null = null

export async function connectDatabase(): Promise<Db> {
  if (db) {
    return db
  }

  const uri = process.env.DATABASE_URL
  if (!uri) {
    throw new Error('DATABASE_URL environment variable is not set. Please create a .env file in the backend directory with your MongoDB connection string.')
  }

  // Connection options optimized for MongoDB Atlas
  const options: MongoClientOptions = {
    serverSelectionTimeoutMS: 10000, // Reduce timeout to 10 seconds for faster feedback
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    retryWrites: true,
    retryReads: true,
  }

  try {
    console.log('🔄 Connecting to MongoDB...')
    client = new MongoClient(uri, options)
    await client.connect()
    
    // Test the connection
    await client.db('admin').command({ ping: 1 })
    
    // Extract database name from URI or use default
    const dbName = extractDatabaseName(uri) || 'iyawe'
    db = client.db(dbName)

    console.log(`✅ Connected to MongoDB database: ${dbName}`)
    return db
  } catch (error: any) {
    console.error('❌ Failed to connect to MongoDB')
    
    // Provide helpful error messages
    if (error.message?.includes('authentication failed')) {
      console.error('💡 Authentication failed. Please check:')
      console.error('   - Your username and password in the connection string')
      console.error('   - If your password contains special characters, URL-encode them (@ → %40, # → %23, etc.)')
    } else if (error.message?.includes('timeout') || error.message?.includes('Server selection timed out')) {
      console.error('💡 Connection timeout. Please check:')
      console.error('   - Your IP address is whitelisted in MongoDB Atlas Network Access')
      console.error('   - Your internet connection is working')
      console.error('   - The MongoDB cluster is running and accessible')
      console.error('   - Try adding "Allow Access from Anywhere" (0.0.0.0/0) in MongoDB Atlas Network Access for testing')
    } else if (error.message?.includes('ENOTFOUND') || error.message?.includes('DNS')) {
      console.error('💡 DNS resolution failed. Please check:')
      console.error('   - Your connection string is correct')
      console.error('   - The cluster hostname in the connection string matches your Atlas cluster')
    } else {
      console.error('💡 Connection error:', error.message)
    }
    
    console.error('\n📖 For help, see: backend/MONGODB_SETUP.md')
    throw error
  }
}

function extractDatabaseName(uri: string): string | null {
  try {
    // Try to extract database name from URI
    // Format: mongodb+srv://user:pass@host/dbname?options
    const match = uri.match(/mongodb(\+srv)?:\/\/[^/]+\/([^?]+)/)
    if (match && match[2]) {
      return match[2]
    }
    return null
  } catch {
    return null
  }
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close()
    client = null
    db = null
    console.log('✅ Disconnected from MongoDB')
  }
}

export function getDatabase(): Db {
  if (!db) {
    throw new Error('Database not connected. Call connectDatabase() first.')
  }
  return db
}

// Collection helpers
export function getCollection<T extends Document = Document>(name: string): Collection<T> {
  return getDatabase().collection<T>(name)
}

// Collections
export const collections = {
  users: () => getCollection('users'),
  lostReports: () => getCollection('lostReports'),
  foundReports: () => getCollection('foundReports'),
  matches: () => getCollection('matches'),
  verifications: () => getCollection('verifications'),
  handovers: () => getCollection('handovers'),
  institutions: () => getCollection('institutions'),
  ads: () => getCollection('ads'),
  notifications: () => getCollection('notifications'),
  auditLogs: () => getCollection('auditLogs'),
}
