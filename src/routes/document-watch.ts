import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { collections } from '../lib/db'
import { notifyWatchAgainstExistingFound } from '../lib/document-watch'

const router = Router()

const documentTypes = [
  'ID_CARD',
  'PASSPORT',
  'ATM_CARD',
  'STUDENT_CARD',
  'DRIVERS_LICENSE',
  'OTHER',
] as const

const watchSchema = z.object({
  documentType: z.enum(documentTypes),
  documentNumber: z.string().optional(),
  description: z.string().optional(),
  lostDate: z.string().optional(),
  lostLocation: z.string().optional(),
  contactName: z.string().min(2),
  contactEmail: z.string().email(),
  contactPhone: z.string().optional(),
})

// POST /api/document-watch
router.post('/', async (req: Request, res: Response) => {
  try {
    const data = watchSchema.parse(req.body)

    if (!data.documentNumber?.trim() && !data.lostLocation?.trim() && !data.description?.trim()) {
      return res.status(400).json({
        error:
          'Provide a document number, where you lost it, or a short description so we can match your alert.',
      })
    }

    const watchCol = collections.documentWatchAlerts()
    const now = new Date()

    const duplicate = await watchCol.findOne({
      status: 'ACTIVE',
      contactEmail: data.contactEmail.toLowerCase(),
      documentType: data.documentType,
      ...(data.documentNumber?.trim() ? { documentNumber: data.documentNumber.trim() } : {}),
    })

    if (duplicate) {
      return res.status(400).json({ error: 'You already have an active alert for this document.' })
    }

    const result = await watchCol.insertOne({
      documentType: data.documentType,
      documentNumber: data.documentNumber?.trim() || null,
      description: data.description?.trim() || null,
      lostDate: data.lostDate ? new Date(data.lostDate) : null,
      lostLocation: data.lostLocation?.trim() || null,
      contactName: data.contactName,
      contactEmail: data.contactEmail.toLowerCase(),
      contactPhone: data.contactPhone?.trim() || null,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    })

    const immediate = await notifyWatchAgainstExistingFound(result.insertedId.toString())

    return res.status(201).json({
      message: immediate.notified
        ? 'A matching document is already listed. Check your email for details.'
        : 'Alert registered. We will email you when a matching document is listed.',
      watchId: result.insertedId.toString(),
      alreadyListed: immediate.notified,
      emailSent: immediate.notified,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors })
    }
    console.error('Error creating document watch alert:', error)
    return res.status(500).json({ error: 'Failed to register alert' })
  }
})

export default router
