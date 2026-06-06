import { collections } from './db'
import { ObjectId } from 'mongodb'
import crypto from 'crypto'

export interface Verification {
  _id?: ObjectId
  matchId: ObjectId
  lostReportId: ObjectId
  foundReportId: ObjectId
  verificationCode: string
  isVerified: boolean
  verifiedAt?: Date
  createdAt: Date
  updatedAt: Date
}

/**
 * Generate a secure verification code
 */
export function generateVerificationCode(): string {
  return crypto.randomBytes(8).toString('hex').toUpperCase()
}

/**
 * Create a verification record for a match
 */
export async function createVerification(matchId: string): Promise<Verification> {
  const match = await collections.matches().findOne({ _id: new ObjectId(matchId) })
  
  if (!match) {
    throw new Error('Match not found')
  }

  // Check if verification already exists
  const existing = await collections.verifications().findOne({ matchId: new ObjectId(matchId) }) as Verification | null

  if (existing) {
    return existing
  }

  const verificationCode = generateVerificationCode()
  const now = new Date()

  const verification: Verification = {
    matchId: new ObjectId(matchId),
    lostReportId: match.lostReportId as ObjectId,
    foundReportId: match.foundReportId as ObjectId,
    verificationCode,
    isVerified: false,
    createdAt: now,
    updatedAt: now,
  }

  const result = await collections.verifications().insertOne(verification)
  verification._id = result.insertedId

  return verification
}

/**
 * Verify ownership using the verification code
 */
export async function verifyOwnership(verificationCode: string, documentNumber: string) {
  const verification = await collections.verifications().findOne({ verificationCode }) as Verification | null

  if (!verification) {
    return { success: false, message: 'Invalid verification code' }
  }

  if (verification.isVerified) {
    return { success: false, message: 'This verification has already been completed' }
  }

  // Get the lost report to verify document number
  const lostReport = await collections.lostReports().findOne({ _id: verification.lostReportId })

  if (!lostReport) {
    return { success: false, message: 'Lost report not found' }
  }

  // Verify the document number matches
  const lostDocNumber = lostReport.documentNumber
  if (!lostDocNumber || lostDocNumber.toLowerCase() !== documentNumber.toLowerCase()) {
    return { success: false, message: 'Document number does not match' }
  }

  // Mark as verified
  await collections.verifications().updateOne(
    { _id: verification._id },
    {
      $set: {
        isVerified: true,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  )

  // Update match status
  await collections.matches().updateOne(
    { _id: verification.matchId },
    {
      $set: {
        status: 'VERIFIED',
        updatedAt: new Date(),
      },
    }
  )

  // Update report statuses
  await collections.lostReports().updateOne(
    { _id: verification.lostReportId },
    {
      $set: {
        status: 'VERIFIED',
        updatedAt: new Date(),
      },
    }
  )

  await collections.foundReports().updateOne(
    { _id: verification.foundReportId },
    {
      $set: {
        status: 'VERIFIED',
        updatedAt: new Date(),
      },
    }
  )

  return {
    success: true,
    message: 'Ownership verified successfully',
    verification,
  }
}
