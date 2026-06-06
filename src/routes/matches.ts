import { Router, Response } from 'express'
import { createVerification } from '../lib/verification'
import { authenticate, AuthRequest } from '../lib/middleware'
import { collections } from '../lib/db'
import { ObjectId } from 'mongodb'

const router = Router()

// POST /api/matches/:matchId/verify
router.post('/:matchId/verify', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { matchId } = req.params

    const match = await collections.matches().findOne({ _id: new ObjectId(matchId) })

    if (!match) {
      return res.status(404).json({ error: 'Match not found' })
    }

    // Get lost and found reports
    const lostReport = await collections.lostReports().findOne({ _id: match.lostReportId as ObjectId })
    const foundReport = await collections.foundReports().findOne({ _id: match.foundReportId as ObjectId })

    if (!lostReport || !foundReport) {
      return res.status(404).json({ error: 'Report not found' })
    }

    // Check if user owns either the lost or found report
    const lostUserId = lostReport.userId.toString()
    const foundUserId = foundReport.userId.toString()
    
    if (lostUserId !== req.userId && foundUserId !== req.userId) {
      return res.status(403).json({ error: 'Unauthorized' })
    }

    const verification = await createVerification(matchId)

    return res.json({
      message: 'Verification created successfully',
      verification: {
        id: verification._id!.toString(),
        verificationCode: verification.verificationCode,
        matchId: verification.matchId.toString(),
      },
    })
  } catch (error) {
    console.error('Error creating verification:', error)
    return res.status(500).json({ error: 'Failed to create verification' })
  }
})

export default router
