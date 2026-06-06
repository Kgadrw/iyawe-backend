# Iyawe Backend API

Backend server for the Iyawe document recovery platform, built with Express.js, TypeScript, and MongoDB.

## Features

- 🔐 JWT-based authentication
- 📝 Document reporting (lost/found)
- 🔍 Smart matching algorithm
- ✅ Ownership verification system
- 🔎 Search functionality
- 📊 Document management

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: MongoDB (native driver)
- **Authentication**: JWT (jose)
- **Validation**: Zod

## Prerequisites

- Node.js 18+ and npm
- MongoDB database (local or Atlas)

## Setup Instructions

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Environment Variables

Create a `.env` file in the `backend` directory:

```env
# Database
DATABASE_URL="mongodb+srv://username:password@cluster.mongodb.net/iyawe?retryWrites=true&w=majority"
# OR for local MongoDB:
# DATABASE_URL="mongodb://localhost:27017/iyawe"

# JWT Secret
JWT_SECRET="your-secret-key-change-in-production"

# Server
PORT=5000
NODE_ENV=development

# CORS
CORS_ORIGIN="http://localhost:3000"
```

**Important**: 
- Replace the `DATABASE_URL` with your actual MongoDB connection string
- If your password contains special characters, URL-encode them:
  - `@` → `%40`
  - `#` → `%23`
  - `/` → `%2F`
- Use a strong `JWT_SECRET` in production

### 3. Start the Server

**Development mode** (with hot reload):
```bash
npm run dev
```

The server will:
- Connect to MongoDB
- Initialize database indexes automatically
- Start on `http://localhost:5000`

**Production mode**:
```bash
npm run build
npm start
```

## Database Structure

The backend uses MongoDB with the following collections:

- **users** - User accounts
- **lostReports** - Lost document reports
- **foundReports** - Found document reports
- **matches** - Matches between lost and found reports
- **verifications** - Ownership verification records
- **handovers** - Document handover records
- **institutions** - Institution accounts

Indexes are automatically created on startup for optimal performance.

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/logout` - Logout user

### Reports
- `POST /api/reports/lost` - Create lost document report
- `GET /api/reports/lost` - Get user's lost reports
- `POST /api/reports/found` - Create found document report
- `GET /api/reports/found` - Get user's found reports

### Matching & Verification
- `POST /api/matches/:matchId/verify` - Create verification for a match
- `POST /api/verify` - Verify ownership with code

### Search & Documents
- `GET /api/search?q=query` - Search documents
- `GET /api/documents/latest` - Get latest documents

### Health Check
- `GET /health` - Server health check

## Project Structure

```
backend/
├── src/
│   ├── lib/              # Utility libraries
│   │   ├── auth.ts       # Authentication helpers
│   │   ├── db.ts         # Database connection
│   │   ├── db-init.ts   # Database initialization
│   │   ├── matching.ts  # Matching algorithm
│   │   ├── middleware.ts # Auth middleware
│   │   └── verification.ts # Verification system
│   ├── routes/          # API route handlers
│   │   ├── auth.ts
│   │   ├── documents.ts
│   │   ├── matches.ts
│   │   ├── reports.ts
│   │   ├── search.ts
│   │   └── verify.ts
│   └── index.ts         # Express app entry point
├── package.json
├── tsconfig.json
└── .env                 # Environment variables (create this)
```

## Troubleshooting

### Database Connection Issues

If you see connection errors:

1. **Check your MongoDB connection string**:
   - Ensure the cluster name is correct
   - Verify your IP is whitelisted in MongoDB Atlas (if using Atlas)
   - Check that the database name is correct

2. **Test connection string format**:
   ```
   mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority
   ```

3. **For local MongoDB**:
   ```
   mongodb://localhost:27017/iyawe
   ```

### Port Already in Use

Change the `PORT` in your `.env` file to a different port.

## Development

The backend uses `tsx` for development with hot reload. Changes to TypeScript files will automatically restart the server.

## Production

Build the TypeScript code before deploying:
```bash
npm run build
npm start
```

The compiled JavaScript will be in the `dist/` directory.
