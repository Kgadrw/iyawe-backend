import { Router, Request, Response } from 'express'
import { collections } from '../lib/db'

const router = Router()

// GET /api/documents/latest
router.get('/latest', async (req: Request, res: Response) => {
  try {
    const limit = parseInt((req.query.limit as string) || '6')
    const type = req.query.type as string // 'lost' or 'found'

    // Fetch latest lost reports
    const latestLost = type === 'found' ? [] : await collections.lostReports()
      .find({})
      .sort({ createdAt: -1 })
      .limit(Math.ceil(limit / 2))
      .toArray() as any[]

    // Fetch latest found reports
    const latestFound = type === 'lost' ? [] : await collections.foundReports()
      .find({})
      .sort({ createdAt: -1 })
      .limit(Math.ceil(limit / 2))
      .toArray() as any[]

    // Get user info for reports
    const lostWithUsers = await Promise.all(
      latestLost.map(async (report) => {
        let user = null
        if (report.userId) {
          user = await collections.users().findOne({ _id: report.userId as any })
        }
        return {
          ...report,
          id: report._id!.toString(),
          userId: report.userId ? report.userId.toString() : undefined,
          user: user 
            ? { 
                name: user.name,
                email: user.email,
                phone: user.phone 
              } 
            : (report.reporterName ? { 
                name: report.reporterName,
                email: report.reporterEmail,
                phone: report.reporterPhone 
              } : null),
          // Include all reporter fields for details view
          reporterName: report.reporterName,
          reporterEmail: report.reporterEmail,
          reporterPhone: report.reporterPhone,
        }
      })
    )

    const foundWithUsers = await Promise.all(
      latestFound.map(async (report) => {
        let user = null
        if (report.userId) {
          user = await collections.users().findOne({ _id: report.userId as any })
        }
        return {
          ...report,
          id: report._id!.toString(),
          userId: report.userId ? report.userId.toString() : undefined,
          user: user 
            ? { 
                name: user.name,
                email: user.email,
                phone: user.phone 
              } 
            : (report.uploaderName ? { 
                name: report.uploaderName,
                email: report.uploaderEmail,
                phone: report.uploaderPhone 
              } : null),
          // Include all uploader fields for details view
          uploaderName: report.uploaderName,
          uploaderEmail: report.uploaderEmail,
          uploaderPhone: report.uploaderPhone,
        }
      })
    )

    // Combine and sort by date
    const allDocuments = [
      ...lostWithUsers.map((report) => ({
        ...report,
        type: 'lost' as const,
        reportDate: report.lostDate || report.createdAt,
        lostLocation: report.lostLocation,
        description: report.description,
      })),
      ...foundWithUsers.map((report) => ({
        ...report,
        type: 'found' as const,
        reportDate: report.foundDate || report.createdAt,
        foundLocation: report.foundLocation,
        description: report.description,
        image: report.image, // Include image for found documents
      })),
    ]
      .sort((a, b) => {
        const dateA = a.reportDate instanceof Date ? a.reportDate : new Date(a.reportDate)
        const dateB = b.reportDate instanceof Date ? b.reportDate : new Date(b.reportDate)
        return dateB.getTime() - dateA.getTime()
      })
      .slice(0, limit)

    return res.json({
      documents: allDocuments,
      count: allDocuments.length,
    })
  } catch (error) {
    console.error('Error fetching latest documents:', error)
    return res.status(500).json({ error: 'Failed to fetch latest documents' })
  }
})

export default router
