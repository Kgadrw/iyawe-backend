import { Router, Request, Response } from 'express'
import { verifyOwnership } from '../lib/verification'
import { z } from 'zod'

const router = Router()

const verifySchema = z.object({
  verificationCode: z.string(),
  documentNumber: z.string(),
})

// POST /api/verify
router.post('/', async (req: Request, res: Response) => {
  try {
    const data = verifySchema.parse(req.body)

    const result = await verifyOwnership(data.verificationCode, data.documentNumber)

    if (!result.success) {
      return res.status(400).json({ error: result.message })
    }

    return res.json({
      message: result.message,
      verification: result.verification,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors })
    }
    console.error('Error verifying ownership:', error)
    return res.status(500).json({ error: 'Failed to verify ownership' })
  }
})

export default router
