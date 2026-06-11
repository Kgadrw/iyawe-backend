import { Router, Request, Response } from 'express'
import multer from 'multer'
import { collections } from '../lib/db'
import { findMatchesForLostReport, findMatchesForFoundReport } from '../lib/matching'
import { authenticate, AuthRequest, getUserIdFromToken, getUserFromToken, requireRoles } from '../lib/middleware.js'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { writeAuditLog } from '../lib/audit.js'
import { getStaffStationContext, staffCanManageFoundReport } from '../lib/station-scope.js'

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

        return {
          id: report._id!.toString(),
          documentType: report.documentType,
          documentNumber: report.documentNumber ?? null,
          description: report.description ?? null,
          foundLocation: report.foundLocation ?? null,
          status: report.status ?? 'PENDING',
          createdAt: report.createdAt,
          updatedAt: report.updatedAt,
          foundDate: report.foundDate,
          userId: report.userId?.toString?.() ?? String(report.userId),
          matches: matchesWithLostReports,
        }
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
  note: z.string().optional(),
})

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

    if (user.role !== 'ADMIN') {
      const stationCtx = await getStaffStationContext(user.userId)
      if (
        !staffCanManageFoundReport(stationCtx, {
          userId: report.userId as ObjectId | string | undefined,
          stationName: (report as { stationName?: string | null }).stationName,
        })
      ) {
        return res.status(403).json({ error: 'Forbidden' })
      }
    }

    await collections.foundReports().updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: data.status, statusNote: data.note || null, updatedAt: new Date() } }
    )

    await writeAuditLog({
      actorUserId: new ObjectId(user.userId),
      actorRole: user.role as any,
      action: 'REPORT_STATUS_UPDATE',
      entityType: 'FOUND_REPORT',
      entityId: new ObjectId(id),
      message: `Updated found report status to ${data.status}`,
      metadata: { note: data.note || null, previousStatus: report.status || null },
    })

    return res.json({ message: 'Status updated successfully' })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors })
    }
    console.error('Error updating found report status:', error)
    return res.status(500).json({ error: 'Failed to update status' })
  }
})

export default router
