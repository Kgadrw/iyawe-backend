import { getDatabase, collections } from './db'

/**
 * Initialize database indexes for better performance
 */
export async function initializeDatabaseIndexes() {
  try {
    const db = getDatabase()

    // Users collection indexes
    await collections.users().createIndex({ email: 1 }, { unique: true })
    console.log('✅ Created index on users.email')

    // Lost Reports collection indexes
    await collections.lostReports().createIndex({ userId: 1 })
    await collections.lostReports().createIndex({ documentType: 1, status: 1 })
    await collections.lostReports().createIndex({ createdAt: -1 })
    console.log('✅ Created indexes on lostReports')

    // Found Reports collection indexes
    await collections.foundReports().createIndex({ userId: 1 })
    await collections.foundReports().createIndex({ documentType: 1, status: 1 })
    await collections.foundReports().createIndex({ createdAt: -1 })
    console.log('✅ Created indexes on foundReports')

    // Matches collection indexes
    await collections.matches().createIndex({ lostReportId: 1 })
    await collections.matches().createIndex({ foundReportId: 1 })
    await collections.matches().createIndex({ status: 1 })
    console.log('✅ Created indexes on matches')

    // Verifications collection indexes
    await collections.verifications().createIndex({ verificationCode: 1 }, { unique: true })
    await collections.verifications().createIndex({ matchId: 1 })
    console.log('✅ Created indexes on verifications')

    console.log('✅ Database indexes initialized successfully')
  } catch (error) {
    console.error('❌ Error initializing database indexes:', error)
    throw error
  }
}
