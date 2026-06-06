/**
 * Script to create an officer user
 * Run with: npx tsx scripts/create-officer.ts
 */

import dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env file in the backend root
// Using process.cwd() to get the backend directory when running from backend folder
const envPath = resolve(process.cwd(), '.env')
dotenv.config({ path: envPath })

import { connectDatabase, closeDatabase } from '../src/lib/db'
import { createUser, getUserByEmail } from '../src/lib/auth'

async function createOfficer() {
  const email = process.argv[2] || 'officer@subizwa.rw'
  const password = process.argv[3] || 'officer123'
  const name = process.argv[4] || 'RNP Officer'

  try {
    // Connect to database
    await connectDatabase()

    // Check if officer already exists
    const existingUser = await getUserByEmail(email)
    if (existingUser) {
      console.log(`❌ User with email ${email} already exists`)
      if (existingUser.role === 'OFFICER') {
        console.log('✅ This user is already an officer')
      } else {
        console.log(`⚠️  This user has role: ${existingUser.role}`)
        console.log('   You may need to update the role manually in the database')
      }
      process.exit(1)
    }

    // Create officer user
    const officer = await createUser(
      email,
      password,
      name,
      undefined,
      'OFFICER'
    )

    console.log('✅ Officer user created successfully!')
    console.log('')
    console.log('Login credentials:')
    console.log(`  Email: ${officer.email}`)
    console.log(`  Password: ${password}`)
    console.log('')
    console.log('⚠️  Please change the password after first login!')

  } catch (error) {
    console.error('❌ Error creating officer user:', error)
    process.exit(1)
  } finally {
    await closeDatabase()
  }
}

createOfficer()

