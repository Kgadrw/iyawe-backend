import { Router, Request, Response } from 'express'
import { ObjectId } from 'mongodb'
import { collections } from '../lib/db'

const router = Router()

// GET /api/institutions - Get all active institutions (public endpoint)
router.get('/', async (req: Request, res: Response) => {
  try {
    const institutions = await collections.institutions()
      .find({ isActive: true })
      .sort({ createdAt: -1 })
      .toArray()

    // Get user info for each institution
    const institutionsWithUsers = await Promise.all(
      institutions.map(async (institution: any) => {
        let user = null
        if (institution.userId) {
          try {
            user = await collections.users().findOne({ 
              _id: typeof institution.userId === 'string' 
                ? new ObjectId(institution.userId) 
                : institution.userId 
            })
          } catch (err) {
            console.error('Error fetching user for institution:', err)
          }
        }
        return {
          ...institution,
          id: institution._id!.toString(),
          userId: institution.userId ? (typeof institution.userId === 'object' ? institution.userId.toString() : institution.userId) : undefined,
          user: user ? { name: user.name, email: user.email } : null,
        }
      })
    )

    return res.json({ institutions: institutionsWithUsers })
  } catch (error) {
    console.error('Error fetching institutions:', error)
    return res.status(500).json({ error: 'Failed to fetch institutions' })
  }
})

export default router
