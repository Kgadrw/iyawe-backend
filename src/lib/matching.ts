import { collections } from './db'
import { ObjectId } from 'mongodb'
import crypto from 'crypto'

export interface LostReport {
  _id?: ObjectId
  userId?: ObjectId // Optional for anonymous reports
  documentType: 'ID_CARD' | 'PASSPORT' | 'ATM_CARD' | 'STUDENT_CARD' | 'DRIVERS_LICENSE' | 'OTHER'
  documentNumber?: string
  description?: string
  lostDate?: Date
  lostLocation?: string
  status: 'PENDING' | 'MATCHED' | 'VERIFIED' | 'HANDED_OVER' | 'CLOSED'
  reporterName?: string // For anonymous reports
  reporterEmail?: string // For anonymous reports
  reporterPhone?: string // For anonymous reports
  createdAt: Date
  updatedAt: Date
}

export interface FoundReport {
  _id?: ObjectId
  userId?: ObjectId // Optional - for logged-in users
  uploaderName?: string // Name of person who found/uploaded the document
  uploaderEmail?: string // Email of person who found/uploaded the document
  uploaderPhone?: string // Phone of person who found/uploaded the document
  documentType: 'ID_CARD' | 'PASSPORT' | 'ATM_CARD' | 'STUDENT_CARD' | 'DRIVERS_LICENSE' | 'OTHER'
  documentNumber?: string
  description?: string
  foundDate: Date
  foundLocation?: string
  image?: string // Base64 encoded image
  status: 'PENDING' | 'MATCHED' | 'VERIFIED' | 'HANDED_OVER' | 'CLOSED'
  createdAt: Date
  updatedAt: Date
}

export interface Match {
  _id?: ObjectId
  lostReportId: ObjectId
  foundReportId: ObjectId
  confidence: number
  isExactMatch?: boolean
  status: 'PENDING' | 'MATCHED' | 'VERIFIED' | 'HANDED_OVER' | 'CLOSED'
  createdAt: Date
  updatedAt: Date
}

/**
 * Hash a document number for secure comparison
 */
export function hashDocumentNumber(documentNumber: string): string {
  return crypto.createHash('sha256').update(documentNumber.toLowerCase().trim()).digest('hex')
}

/**
 * Get partial document number for display (first 2, last 2)
 */
export function getPartialDocumentNumber(documentNumber: string): string {
  if (documentNumber.length <= 4) return '****'
  return `${documentNumber.substring(0, 2)}****${documentNumber.substring(documentNumber.length - 2)}`
}

/**
 * Calculate match confidence between lost and found reports
 * Returns both confidence score and whether it's an exact document number match
 */
function calculateMatchConfidence(
  lostDocType: string,
  foundDocType: string,
  lostDocNumber: string | null | undefined,
  foundDocNumber: string | null | undefined,
  lostLocation: string | null | undefined,
  foundLocation: string | null | undefined,
  lostDate: Date | null | undefined,
  foundDate: Date
): { confidence: number; isExactMatch: boolean } {
  let confidence = 0
  let isExactMatch = false

  // Document type match (required)
  if (lostDocType !== foundDocType) {
    return { confidence: 0, isExactMatch: false }
  }
  confidence += 0.3

  // Document number match (if both provided)
  if (lostDocNumber && foundDocNumber) {
    const lostHash = hashDocumentNumber(lostDocNumber)
    const foundHash = hashDocumentNumber(foundDocNumber)
    if (lostHash === foundHash) {
      confidence += 0.5
      isExactMatch = true
    } else {
      // Partial match (first/last few characters)
      const lostPartial = lostDocNumber.substring(0, 4).toLowerCase()
      const foundPartial = foundDocNumber.substring(0, 4).toLowerCase()
      if (lostPartial === foundPartial) {
        confidence += 0.2
      }
    }
  }

  // Location match (if both provided)
  if (lostLocation && foundLocation) {
    const lostLocLower = lostLocation.toLowerCase().trim()
    const foundLocLower = foundLocation.toLowerCase().trim()
    if (lostLocLower === foundLocLower) {
      confidence += 0.1
    } else if (lostLocLower.includes(foundLocLower) || foundLocLower.includes(lostLocLower)) {
      confidence += 0.05
    }
  }

  // Date proximity (found date should be after lost date)
  if (lostDate) {
    const daysDiff = Math.floor((foundDate.getTime() - lostDate.getTime()) / (1000 * 60 * 60 * 24))
    if (daysDiff >= 0 && daysDiff <= 30) {
      confidence += 0.1 - (daysDiff / 300) // Decreases over 30 days
    }
  }

  return { confidence: Math.min(confidence, 1.0), isExactMatch }
}

/**
 * Find and create matches for a new lost report
 */
export async function findMatchesForLostReport(lostReportId: string) {
  const lostReport = await collections.lostReports().findOne({ _id: new ObjectId(lostReportId) }) as LostReport | null

  if (!lostReport || lostReport.status !== 'PENDING') {
    return []
  }

  // Find all pending found reports of the same document type
  const foundReports = await collections.foundReports()
    .find({ documentType: lostReport.documentType, status: 'PENDING' })
    .toArray() as FoundReport[]

  const matches = []

  for (const foundReport of foundReports) {
    const { confidence, isExactMatch } = calculateMatchConfidence(
      lostReport.documentType,
      foundReport.documentType,
      lostReport.documentNumber,
      foundReport.documentNumber,
      lostReport.lostLocation,
      foundReport.foundLocation,
      lostReport.lostDate,
      foundReport.foundDate
    )

    // Only create match if confidence is above threshold
    if (confidence >= 0.3) {
      const match: Match = {
        lostReportId: new ObjectId(lostReportId),
        foundReportId: foundReport._id!,
        confidence,
        isExactMatch,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      
      const result = await collections.matches().insertOne(match)
      match._id = result.insertedId
      matches.push(match)
    }
  }

  return matches
}

/**
 * Find and create matches for a new found report
 */
export async function findMatchesForFoundReport(foundReportId: string) {
  const foundReport = await collections.foundReports().findOne({ _id: new ObjectId(foundReportId) }) as FoundReport | null

  if (!foundReport || foundReport.status !== 'PENDING') {
    return []
  }

  // Find all pending lost reports of the same document type
  const lostReports = await collections.lostReports()
    .find({ documentType: foundReport.documentType, status: 'PENDING' })
    .toArray() as LostReport[]

  const matches = []

  for (const lostReport of lostReports) {
    const { confidence, isExactMatch } = calculateMatchConfidence(
      lostReport.documentType,
      foundReport.documentType,
      lostReport.documentNumber,
      foundReport.documentNumber,
      lostReport.lostLocation,
      foundReport.foundLocation,
      lostReport.lostDate,
      foundReport.foundDate
    )

    // Only create match if confidence is above threshold
    if (confidence >= 0.3) {
      const match: any = {
        lostReportId: lostReport._id!,
        foundReportId: new ObjectId(foundReportId),
        confidence,
        isExactMatch,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      
      const result = await collections.matches().insertOne(match)
      match._id = result.insertedId
      matches.push({ ...match, isExactMatch })
    }
  }

  return matches
}
