import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { collections } from '../lib/db'
import { getStationForUserId } from '../lib/station-info'
import { isEmailConfigured } from '../lib/email'
import { sendClaimConfirmationEmail } from '../lib/claim-email'
import { writeAuditLog } from '../lib/audit'

const router = Router()

const claimSchema = z.object({
  foundReportId: z.string().min(1),
  claimantName: z.string().min(2),
  claimantEmail: z.string().email(),
  claimantPhone: z.string().optional(),
  lostDate: z.string().optional(),
  description: z.string().optional(),
  documentNumber: z.string().optional(),
})

// POST /api/claims
router.post('/', async (req: Request, res: Response) => {
  try {
    const data = claimSchema.parse(req.body)

    const foundReport = await collections.foundReports().findOne({
      _id: new ObjectId(data.foundReportId),
    })

    if (!foundReport) {
      return res.status(404).json({ error: 'Document not found' })
    }

    if (foundReport.status === 'HANDED_OVER') {
      return res.status(400).json({ error: 'This document has already been collected' })
    }

    const normalizedEmail = data.claimantEmail.trim().toLowerCase()
    const existingClaim = await collections.claims().findOne({
      foundReportId: foundReport._id,
      claimantEmail: normalizedEmail,
      status: 'PENDING',
    })
    if (existingClaim) {
      return res.status(400).json({ error: 'You have already submitted a claim for this document' })
    }

    const claimDoc = {
      foundReportId: foundReport._id,
      claimantName: data.claimantName.trim(),
      claimantEmail: normalizedEmail,
      claimantPhone: data.claimantPhone || null,
      lostDate: data.lostDate ? new Date(data.lostDate) : null,
      description: data.description || null,
      documentNumber: data.documentNumber || null,
      status: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const claimResult = await collections.claims().insertOne(claimDoc)

    await collections.foundReports().updateOne(
      { _id: foundReport._id, status: { $ne: 'HANDED_OVER' } },
      {
        $set: {
          status: 'CLAIM_PENDING',
          updatedAt: new Date(),
        },
      }
    )

    const station = foundReport.userId
      ? await getStationForUserId(foundReport.userId)
      : {
          name: foundReport.foundLocation || 'Collection station',
          address: null,
          phone: null,
          email: null,
        }

    const documentTypeLabel = String(foundReport.documentType || 'Document').replace(/_/g, ' ')
    const emailQueued = isEmailConfigured()

    if (emailQueued) {
      void sendClaimConfirmationEmail({
        to: data.claimantEmail,
        claimantName: data.claimantName,
        documentTypeLabel,
        documentNumber: foundReport.documentNumber,
        station,
        foundLocation: foundReport.foundLocation,
      }).catch((error) => {
        console.error('Background claim email failed:', error)
      })
    } else {
      console.warn('SMTP not configured on server — claim confirmation email skipped')
    }

    void writeAuditLog({
      actorUserId: null,
      actorRole: null,
      action: 'REPORT_FOUND_CREATE',
      entityType: 'FOUND_REPORT',
      entityId: foundReport._id as ObjectId,
      message: 'Public claim submitted for found document',
      metadata: {
        claimId: claimResult.insertedId.toString(),
        foundReportId: data.foundReportId,
        emailQueued,
      },
    }).catch((error) => {
      console.error('Claim audit log failed:', error)
    })

    return res.status(201).json({
      message: 'Claim submitted successfully',
      claimId: claimResult.insertedId.toString(),
      emailSent: emailQueued,
      emailQueued,
      station: {
        name: station.name,
        address: station.address,
        phone: station.phone,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors })
    }
    console.error('Error creating claim:', error)
    return res.status(500).json({ error: 'Failed to submit claim' })
  }
})

export default router
