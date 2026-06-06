/**
 * Script to create an admin user
 * Run with: npx tsx scripts/create-admin.ts
 */

import dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env file in the backend root
// Using process.cwd() to get the backend directory when running from backend folder
const envPath = resolve(process.cwd(), '.env')
dotenv.config({ path: envPath })

import { connectDatabase, closeDatabase } from '../src/lib/db'
import { createUser, getUserByEmail } from '../src/lib/auth'

async function createAdmin() {
  const email = process.argv[2] || 'admin@iyawe.com'
  const password = process.argv[3] || 'admin123'
  const name = process.argv[4] || 'Admin User'

  try {
    // Connect to database
    await connectDatabase()

    // Check if admin already exists
    const existingUser = await getUserByEmail(email)
    if (existingUser) {
      console.log(`❌ User with email ${email} already exists`)
      if (existingUser.role === 'ADMIN') {
        console.log('✅ This user is already an admin')
      } else {
        console.log(`⚠️  This user has role: ${existingUser.role}`)
        console.log('   You may need to update the role manually in the database')
      }
      process.exit(1)
    }

    // Create admin user
    const admin = await createUser(
      email,
      password,
      name,
      undefined,
      'ADMIN'
    )

    console.log('✅ Admin user created successfully!')
    console.log('')
    console.log('Login credentials:')
    console.log(`  Email: ${admin.email}`)
    console.log(`  Password: ${password}`)
    console.log('')
    console.log('⚠️  Please change the password after first login!')

  } catch (error) {
    console.error('❌ Error creating admin user:', error)
    process.exit(1)
  } finally {
    await closeDatabase()
  }
}

createAdmin()
