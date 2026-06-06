# MongoDB Setup Guide

## Issue: DNS Resolution Error

If you're getting a DNS resolution error, it means the MongoDB cluster in your connection string doesn't exist or is unreachable.

## Solution 1: Get New MongoDB Atlas Connection String

1. **Go to MongoDB Atlas**: https://cloud.mongodb.com/
2. **Sign in** to your account
3. **Select or Create a Cluster**:
   - If you don't have a cluster, click "Build a Database" → "Free" tier
   - Choose a cloud provider and region
   - Click "Create"
4. **Create Database User**:
   - Go to "Database Access" → "Add New Database User"
   - Choose "Password" authentication
   - Create username and password
   - **Important**: Remember the password!
   - Click "Add User"
5. **Whitelist Your IP**:
   - Go to "Network Access" → "Add IP Address"
   - Click "Allow Access from Anywhere" (for development) or add your specific IP
   - Click "Confirm"
6. **Get Connection String**:
   - Go to "Database" → Click "Connect" on your cluster
   - Choose "Connect your application"
   - Copy the connection string
   - It looks like: `mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
7. **Update .env file**:
   - Open `backend/.env`
   - Replace `DATABASE_URL` with your new connection string
   - **Important**: If your password contains special characters, URL-encode them:
     - `@` → `%40`
     - `#` → `%23`
     - `/` → `%2F`
     - `:` → `%3A`
   - Add the database name: `mongodb+srv://...@cluster0.xxxxx.mongodb.net/iyawe?retryWrites=true&w=majority`

## Solution 2: Use Local MongoDB (Alternative)

If you prefer to use a local MongoDB instance:

1. **Install MongoDB Community Edition**:
   - Download from: https://www.mongodb.com/try/download/community
   - Install and start MongoDB service

2. **Update .env file**:
   ```env
   DATABASE_URL="mongodb://localhost:27017/iyawe"
   ```

3. **Run the setup**:
   ```bash
   npm run db:generate
   npm run db:push
   ```

## Solution 3: Use MongoDB Atlas Free Tier

MongoDB Atlas offers a free tier (M0) that's perfect for development:

1. Sign up at https://cloud.mongodb.com/
2. Create a free cluster (takes a few minutes)
3. Follow Solution 1 steps above

## Testing the Connection

After updating your `.env` file, test the connection:

```bash
npm run db:push
```

If successful, you should see:
```
✔ Generated Prisma Client
✔ The database is already in sync with the Prisma schema.
```

## Common Issues

### Password Encoding
If your password contains special characters, you MUST URL-encode them:
- Password: `MyP@ss#123` → `MyP%40ss%23123`

### Network Access
Make sure your IP is whitelisted in MongoDB Atlas Network Access settings.

### Connection String Format
- ✅ Correct: `mongodb+srv://user:pass@cluster.mongodb.net/dbname?retryWrites=true&w=majority`
- ❌ Wrong: `mongodb+srv://user:pass@cluster.mongodb.net` (missing database name)
