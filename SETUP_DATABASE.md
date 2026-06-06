# Database Setup Guide

## Current Issue: MongoDB Cluster Not Found

The error `ENOTFOUND _mongodb._tcp.cluster0.b53bq.mongodb.net` means the MongoDB cluster in your connection string doesn't exist or is unreachable.

## Solution Options

### Option 1: Get New MongoDB Atlas Connection String (Recommended)

1. **Go to MongoDB Atlas**: https://cloud.mongodb.com/
2. **Sign in** or create a free account
3. **Create a Free Cluster**:
   - Click "Build a Database"
   - Choose "Free" (M0) tier
   - Select a cloud provider and region
   - Click "Create"
   - Wait 3-5 minutes for cluster creation

4. **Create Database User**:
   - Go to "Database Access" → "Add New Database User"
   - Choose "Password" authentication
   - Create username and password (remember these!)
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
   - **Add database name**: `mongodb+srv://...@cluster0.xxxxx.mongodb.net/iyawe?retryWrites=true&w=majority`
   - **Important**: If password has special characters, URL-encode them:
     - `@` → `%40`
     - `#` → `%23`
     - `/` → `%2F`
     - `:` → `%3A`

### Option 2: Use Local MongoDB

1. **Install MongoDB Community Edition**:
   - Download from: https://www.mongodb.com/try/download/community
   - Install MongoDB
   - Start MongoDB service (usually starts automatically)

2. **Update .env file**:
   ```env
   DATABASE_URL="mongodb://localhost:27017/iyawe"
   ```

3. **Start the server**:
   ```bash
   npm run dev
   ```

### Option 3: Use MongoDB Atlas Free Tier

MongoDB Atlas offers a completely free tier (M0) perfect for development:
- 512 MB storage
- Shared RAM
- No credit card required (for M0 tier)

## Testing the Connection

After updating your `.env` file, test the connection:

```bash
npm run dev
```

If successful, you should see:
```
✅ Connected to MongoDB
✅ Created index on users.email
✅ Created indexes on lostReports
...
🚀 Server is running on http://localhost:5000
```

## Common Issues

### Password Encoding
If your password is `MyP@ss#123`, encode it as `MyP%40ss%23123` in the connection string.

### Network Access
Make sure your IP is whitelisted in MongoDB Atlas Network Access settings.

### Connection String Format
- ✅ Correct: `mongodb+srv://user:pass@cluster.mongodb.net/dbname?retryWrites=true&w=majority`
- ❌ Wrong: `mongodb+srv://user:pass@cluster.mongodb.net` (missing database name)
