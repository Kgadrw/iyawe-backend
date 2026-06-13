import { Router, Request, Response } from 'express'
import multer from 'multer'
import { collections } from '../lib/db'
import { findMatchesForLostReport, findMatchesForFoundReport } from '../lib/matching'
import { authenticate, AuthRequest, getUserIdFromToken, getUserFromToken, requireRoles } from '../lib/middleware.js'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { writeAuditLog } from '../lib/audit.js'
import { getStaffStationContext, staffCanManageFoundReport } from '../lib/station-scope.js'

async function loadStaffContext(user: { userId: string; role: string }) {
  if (user.role === 'ADMIN') {
    return { userId: user.userId, role: user.role, stationName: null, stationKey: null }
  }
  return getStaffStationContext(user.userId)
}

async function assertStaffCanManageReport(
  user: { userId: string; role: string },
  report: { userId?: ObjectId | string; stationName?: string | null }
) {
  const ctx = await loadStaffContext(user)
  if (!staffCanManageFoundReport(ctx, report)) {
    return false
  }
  return true
}

function serializeFoundReport(report: Record<string, unknown>, extras?: Record<string, unknown>) {
  return {
    id: String(report._id),
    documentType: report.documentType,
    documentNumber: report.documentNumber ?? null,
    description: report.description ?? null,
    foundLocation: report.foundLocation ?? null,
    status: report.status ?? 'PENDING',
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    foundDate: report.foundDate,
    userId: report.userId?.toString?.() ?? String(report.userId),
    ...extras,
  }
}

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
})

const router = Router()

const documentTypeEnum = z.enum(['ID_CARD', 'PASSPORT', 'ATM_CARD', 'STUDENT_CARD', 'DRIVERS_LICENSE', 'OTHER'])

const lostReportSchema = z.object({
  documentType: documentTypeEnum,
  documentNumber: z.string().optional(),
  description: z.string().optional(),
  lostDate: z.string().optional(),
  lostLocation: z.string().optional(),
  reporterName: z.string().min(2).optional(),
  reporterEmail: z.string().email().optional(),
  reporterPhone: z.string().optional(),
})

const foundReportSchema = z.object({
  documentType: documentTypeEnum,
  documentNumber: z.string().optional(),
  description: z.string().optional(),
  foundLocation: z.string().optional(),
  uploaderName: z.string().min(2).optional(),
  uploaderEmail: z.string().email().optional(),
  uploaderPhone: z.string().optional(),
})

// POST /api/reports/lost
router.post('/lost', async (req: Request, res: Response) => {
  try {
    // Try to get user from token (optional)
    const userId = await getUserIdFromToken(req)
    
    const data = lostReportSchema.parse(req.body)
    const now = new Date()

    // Validate: Either userId (logged in) or contact info (anonymous) must be provided
    if (!userId && (!data.reporterName || !data.reporterEmail)) {
      return res.status(400).json({ 
        error: 'Please provide your name and email, or login to report' 
      })
    }

    const lostReport: any = {
      documentType: data.documentType,
      documentNumber: data.documentNumber,
      description: data.description,
      lostDate: data.lostDate ? new Date(data.lostDate) : undefined,
      lostLocation: data.lostLocation,
      status: 'PENDING' as const,
      createdAt: now,
      updatedAt: now,
    }

    // Add userId if logged in
    if (userId) {
      lostReport.userId = new ObjectId(userId)
    }

    // Add reporter contact info (always store, even for logged-in users)
    if (data.reporterName) {
      lostReport.reporterName = data.reporterName
    }
    if (data.reporterEmail) {
      lostReport.reporterEmail = data.reporterEmail
    }
    if (data.reporterPhone) {
      lostReport.reporterPhone = data.reporterPhone
    }

    const result = await collections.lostReports().insertOne(lostReport)
    const insertedReport = { ...lostReport, _id: result.insertedId }

    // Try to find matches
    const matches = await findMatchesForLostReport(result.insertedId.toString())

    return res.status(201).json({
      message: 'Lost report created successfully',
      report: {
        id: result.insertedId.toString(),
        ...insertedReport,
        userId: insertedReport.userId?.toString(), // userId might be undefined for anonymous
      },
      matchesFound: matches.length,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors })
    }
    console.error('Error creating lost report:', error)
    return res.status(500).json({ error: 'Failed to create lost report' })
  }
})

// GET /api/reports/lost
router.get('/lost', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const reports = await collections.lostReports()
      .find({ userId: new ObjectId(req.userId!) })
      .sort({ createdAt: -1 })
      .toArray()

    // Get matches for each report
    const reportsWithMatches = await Promise.all(
      reports.map(async (report) => {
        const matches = await collections.matches()
          .find({ lostReportId: report._id! })
          .toArray()

        const matchesWithFoundReports = await Promise.all(
          matches.map(async (match) => {
            const foundReport = await collections.foundReports().findOne({ _id: match.foundReportId })
            return {
              id: match._id!.toString(),
              confidence: match.confidence,
              status: match.status,
              foundReport: foundReport
                ? {
                    id: foundReport._id!.toString(),
                    documentType: foundReport.documentType,
                    foundDate: foundReport.foundDate,
                    foundLocation: foundReport.foundLocation,
                    status: foundReport.status,
                  }
                : null,
            }
          })
        )

        return {
          id: report._id!.toString(),
          ...report,
          userId: report.userId.toString(),
          matches: matchesWithFoundReports,
        }
      })
    )

    return res.json({ reports: reportsWithMatches })
  } catch (error) {
    console.error('Error fetching lost reports:', error)
    return res.status(500).json({ error: 'Failed to fetch lost reports' })
  }
})

// POST /api/reports/found
// SUBIZWA-aligned policy: only authorized roles can register found credentials
router.post('/found', requireRoles(['ADMIN', 'OFFICER', 'INSTITUTION']), upload.single('image'), async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    
    // Handle both JSON and FormData
    let bodyData: any = {}
    
    if (req.headers['content-type']?.includes('multipart/form-data')) {
      // FormData - extract from req.body
      bodyData = {
        documentType: req.body.documentType,
        documentNumber: req.body.documentNumber || '',
        description: req.body.description || '',
        foundLocation: req.body.foundLocation,
        uploaderName: req.body.uploaderName || '',
        uploaderEmail: req.body.uploaderEmail || '',
        uploaderPhone: req.body.uploaderPhone || '',
      }
    } else {
      // JSON
      bodyData = req.body
    }

    const data = foundReportSchema.parse(bodyData)
    const now = new Date()

    // In this mode, the authenticated account is the registrar (officer/institution personnel).

    // Convert image to base64 if provided (multipart upload or JSON data URL)
    let imageBase64: string | undefined
    if (req.file) {
      imageBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`
    } else if (typeof req.body?.image === 'string' && req.body.image.trim()) {
      imageBase64 = req.body.image.trim()
    }

    const foundReport: any = {
      documentType: data.documentType,
      documentNumber: data.documentNumber,
      description: data.description,
      foundLocation: data.foundLocation,
      image: imageBase64,
      foundDate: now,
      status: 'PENDING' as const,
      createdAt: now,
      updatedAt: now,
    }

    // Registrar account (RNP admin/officer or approved institution personnel)
    foundReport.userId = new ObjectId(userId)

    // Optional registrar contact info (kept for operational follow-up)
     if (data.uploaderName) {
      foundReport.uploaderName = data.uploaderName
    }
    if (data.uploaderEmail) {
      foundReport.uploaderEmail = data.uploaderEmail
    }
    if (data.uploaderPhone) {
      foundReport.uploaderPhone = data.uploaderPhone
    }

    const result = await collections.foundReports().insertOne(foundReport)
    const insertedReport = { ...foundReport, _id: result.insertedId }

    // Try to find matches
    const matches = await findMatchesForFoundReport(result.insertedId.toString())

    const exactMatches = matches.filter((m: any) => m.isExactMatch === true)

    try {
      const { createUserNotification, createAdminNotification, NotificationType } = await import(
        '../lib/notifications.js'
      )

      if (exactMatches.length > 0) {
        for (const match of exactMatches) {
          const lostReport = await collections.lostReports().findOne({ _id: match.lostReportId })
          const foundReportDoc = await collections.foundReports().findOne({ _id: match.foundReportId })

          if (lostReport && foundReportDoc) {
            const documentTypeLabel = foundReportDoc.documentType.replace(/_/g, ' ')
            const documentNumberPartial = foundReportDoc.documentNumber
              ? `${foundReportDoc.documentNumber.substring(0, 2)}****${foundReportDoc.documentNumber.substring(foundReportDoc.documentNumber.length - 2)}`
              : 'N/A'

            await createAdminNotification(
              NotificationType.ADMIN_MATCH_ALERT,
              '🚨 Exact Document Match Found!',
              `An exact document number match has been found!\n\nDocument Type: ${documentTypeLabel}\nDocument Number: ${documentNumberPartial}\nFound Location: ${foundReportDoc.foundLocation || 'N/A'}\n\nPlease review and verify the match.`,
              match._id,
              match.lostReportId,
              match.foundReportId
            )

            if (lostReport.userId) {
              await createUserNotification(
                lostReport.userId,
                NotificationType.MATCH_FOUND,
                '🎉 Potential Match Found!',
                `We found a document that matches your lost ${documentTypeLabel}!\n\nDocument Number: ${documentNumberPartial}\nFound Location: ${foundReportDoc.foundLocation || 'N/A'}\n\nPlease verify if this is your document.`,
                match._id,
                match.lostReportId,
                match.foundReportId
              )
            } else if (lostReport.reporterEmail) {
              console.log(`Match found for anonymous lost report. Email: ${lostReport.reporterEmail}`)
            }
          }
        }
      } else if (matches.length > 0) {
        await createAdminNotification(
          NotificationType.ADMIN_MATCH_ALERT,
          '⚠️ Potential Document Match Found',
          `${matches.length} potential match(es) found for the newly uploaded found document. Please review.`,
          undefined,
          undefined,
          result.insertedId
        )
      }
    } catch (notifyError) {
      console.error('Match notifications failed (report still saved):', notifyError)
    }

    return res.status(201).json({
      message: 'Found report created successfully',
      report: {
        id: result.insertedId.toString(),
        ...insertedReport,
        userId: insertedReport.userId ? insertedReport.userId.toString() : undefined,
      },
      matchesFound: matches.length,
      exactMatchesFound: exactMatches.length,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors })
    }
    console.error('Error creating found report:', error)
    return res.status(500).json({ error: 'Failed to create found report' })
  }
})

// GET /api/reports/found
router.get('/found', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const reports = await collections.foundReports()
      .find({ userId: new ObjectId(req.userId!) })
      .sort({ createdAt: -1 })
      .toArray()

    // Get matches for each report
    const reportsWithMatches = await Promise.all(
      reports.map(async (report) => {
        const matches = await collections.matches()
          .find({ foundReportId: report._id! })
          .toArray()

        const matchesWithLostReports = await Promise.all(
          matches.map(async (match) => {
            const lostReport = await collections.lostReports().findOne({ _id: match.lostReportId })
            return {
              id: match._id!.toString(),
              confidence: match.confidence,
              status: match.status,
              lostReport: lostReport
                ? {
                    id: lostReport._id!.toString(),
                    documentType: lostReport.documentType,
                    lostDate: lostReport.lostDate,
                    lostLocation: lostReport.lostLocation,
                    status: lostReport.status,
                  }
                : null,
            }
          })
        )

        const pendingClaimCount = await collections.claims().countDocuments({
          foundReportId: report._id!,
          status: 'PENDING',
        })

        return serializeFoundReport(report as Record<string, unknown>, {
          matches: matchesWithLostReports,
          pendingClaimCount,
        })
      })
    )

    return res.json({ reports: reportsWithMatches })
  } catch (error) {
    console.error('Error fetching found reports:', error)
    return res.status(500).json({ error: 'Failed to fetch found reports' })
  }
})

const statusSchema = z.object({
  status: z.enum(['PENDING', 'CLAIM_PENDING', 'MATCHED', 'VERIFIED', 'HANDED_OVER']),
  note: z.string().max(500).optional(),
})

function isRejectTransition(from: string | undefined, to: string): boolean {
  return to === 'PENDING' && from === 'CLAIM_PENDING'
}

function isCollectTransition(to: string): boolean {
  return to === 'HANDED_OVER'
}

// PATCH /api/reports/found/:id/status
router.patch('/found/:id/status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!
    if (!['ADMIN', 'OFFICER', 'INSTITUTION'].includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const { id } = req.params
    const data = statusSchema.parse(req.body)

    const report = await collections.foundReports().findOne({ _id: new ObjectId(id) })
    if (!report) return res.status(404).json({ error: 'Report not found' })

    const previousStatus = (report.status as string | undefined) || 'PENDING'

    if (previousStatus === 'HANDED_OVER') {
      return res.status(400).json({ error: 'This document has already been collected' })
    }

    if (isRejectTransition(previousStatus, data.status)) {
      // Reject pending claim(s) — document returns to station
    } else if (isCollectTransition(data.status)) {
      if (previousStatus !== 'PENDING' && previousStatus !== 'CLAIM_PENDING') {
        return res.status(400).json({ error: 'Cannot mark this document as collected' })
      }
    } else if (data.status !== previousStatus) {
      return res.status(400).json({ error: 'Invalid status change for staff' })
    }

    if (user.role !== 'ADMIN') {
      const allowed = await assertStaffCanManageReport(user, {
        userId: report.userId as ObjectId | string | undefined,
        stationName: (report as { stationName?: string | null }).stationName,
      })
      if (!allowed) {
        return res.status(403).json({ error: 'Forbidden' })
      }
    }

    await collections.foundReports().updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: data.status, statusNote: data.note || null, updatedAt: new Date() } }
    )

    if (isRejectTransition(previousStatus, data.status)) {
      await collections.claims().updateMany(
        { foundReportId: report._id, status: 'PENDING' },
        {
          $set: {
            status: 'REJECTED',
            rejectionNote: data.note || 'Claim rejected by station staff',
            updatedAt: new Date(),
          },
        }
      )
    }

    if (isCollectTransition(data.status)) {
      await collections.claims().updateMany(
        { foundReportId: report._id, status: 'PENDING' },
        { $set: { status: 'FULFILLED', updatedAt: new Date() } }
      )
    }

    const auditMessage = isRejectTransition(previousStatus, data.status)
      ? 'Rejected pending claim(s); document returned to station'
      : isCollectTransition(data.status)
        ? 'Document marked as collected by owner'
        : `Updated found report status to ${data.status}`

    await writeAuditLog({
      actorUserId: new ObjectId(user.userId),
      actorRole: user.role as any,
      action: 'REPORT_STATUS_UPDATE',
      entityType: 'FOUND_REPORT',
      entityId: new ObjectId(id),
      message: auditMessage,
      metadata: { note: data.note || null, previousStatus, newStatus: data.status },
    })

    return res.json({
      message: isRejectTransition(previousStatus, data.status)
        ? 'Claim rejected — document is available at station again'
        : isCollectTransition(data.status)
          ? 'Document marked as collected'
          : 'Status updated successfully',
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors })
    }
    console.error('Error updating found report status:', error)
    return res.status(500).json({ error: 'Failed to update status' })
  }
})

const updateFoundReportSchema = z.object({
  documentType: documentTypeEnum.optional(),
  documentNumber: z.string().max(120).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  foundLocation: z.string().max(200).optional().nullable(),
})

// GET /api/reports/found/:id/claims — staff view claimants
router.get('/found/:id/claims', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!
    if (!['ADMIN', 'OFFICER', 'INSTITUTION'].includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const report = await collections.foundReports().findOne({ _id: new ObjectId(req.params.id) })
    if (!report) return res.status(404).json({ error: 'Report not found' })

    if (user.role !== 'ADMIN') {
      const allowed = await assertStaffCanManageReport(user, {
        userId: report.userId as ObjectId | string | undefined,
        stationName: (report as { stationName?: string | null }).stationName,
      })
      if (!allowed) return res.status(403).json({ error: 'Forbidden' })
    }

    const claims = await collections
      .claims()
      .find({ foundReportId: report._id })
      .sort({ createdAt: -1 })
      .toArray()

    return res.json({
      claims: claims.map((c) => ({
        id: c._id!.toString(),
        claimantName: c.claimantName,
        claimantEmail: c.claimantEmail,
        claimantPhone: c.claimantPhone ?? null,
        documentNumber: c.documentNumber ?? null,
        description: c.description ?? null,
        status: c.status ?? 'PENDING',
        rejectionNote: c.rejectionNote ?? null,
        createdAt: c.createdAt,
      })),
    })
  } catch (error) {
    console.error('Error fetching claims:', error)
    return res.status(500).json({ error: 'Failed to fetch claims' })
  }
})

// PUT /api/reports/found/:id — staff edit document
router.put('/found/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!
    if (!['ADMIN', 'OFFICER', 'INSTITUTION'].includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const data = updateFoundReportSchema.parse(req.body)
    const report = await collections.foundReports().findOne({ _id: new ObjectId(req.params.id) })
    if (!report) return res.status(404).json({ error: 'Report not found' })

    if (report.status === 'HANDED_OVER') {
      return res.status(400).json({ error: 'Collected documents cannot be edited' })
    }

    if (user.role !== 'ADMIN') {
      const allowed = await assertStaffCanManageReport(user, {
        userId: report.userId as ObjectId | string | undefined,
        stationName: (report as { stationName?: string | null }).stationName,
      })
      if (!allowed) return res.status(403).json({ error: 'Forbidden' })
    }

    const update: Record<string, unknown> = { updatedAt: new Date() }
    if (data.documentType !== undefined) update.documentType = data.documentType
    if (data.documentNumber !== undefined) update.documentNumber = data.documentNumber || null
    if (data.description !== undefined) update.description = data.description || null
    if (data.foundLocation !== undefined) update.foundLocation = data.foundLocation || null

    await collections.foundReports().updateOne({ _id: report._id }, { $set: update })

    await writeAuditLog({
      actorUserId: new ObjectId(user.userId),
      actorRole: user.role as any,
      action: 'REPORT_STATUS_UPDATE',
      entityType: 'FOUND_REPORT',
      entityId: report._id as ObjectId,
      message: 'Updated found document details',
    })

    const updated = await collections.foundReports().findOne({ _id: report._id })
    return res.json({
      message: 'Document updated',
      report: serializeFoundReport(updated as Record<string, unknown>),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors })
    }
    console.error('Error updating found report:', error)
    return res.status(500).json({ error: 'Failed to update document' })
  }
})

// DELETE /api/reports/found/:id — staff remove document
router.delete('/found/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!
    if (!['ADMIN', 'OFFICER', 'INSTITUTION'].includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const report = await collections.foundReports().findOne({ _id: new ObjectId(req.params.id) })
    if (!report) return res.status(404).json({ error: 'Report not found' })

    if (user.role !== 'ADMIN' && report.status === 'HANDED_OVER') {
      return res.status(400).json({ error: 'Collected documents cannot be deleted' })
    }

    if (user.role !== 'ADMIN') {
      const allowed = await assertStaffCanManageReport(user, {
        userId: report.userId as ObjectId | string | undefined,
        stationName: (report as { stationName?: string | null }).stationName,
      })
      if (!allowed) return res.status(403).json({ error: 'Forbidden' })
    }

    await collections.claims().deleteMany({ foundReportId: report._id })
    await collections.matches().deleteMany({
      $or: [{ foundReportId: report._id }, { lostReportId: report._id }],
    })
    await collections.foundReports().deleteOne({ _id: report._id })

    await writeAuditLog({
      actorUserId: new ObjectId(user.userId),
      actorRole: user.role as any,
      action: 'REPORT_STATUS_UPDATE',
      entityType: 'FOUND_REPORT',
      entityId: report._id as ObjectId,
      message: 'Deleted found document',
    })

    return res.json({ message: 'Document deleted' })
  } catch (error) {
    console.error('Error deleting found report:', error)
    return res.status(500).json({ error: 'Failed to delete document' })
  }
})

export default router
