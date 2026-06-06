import { Router, Request, Response } from 'express'
import { ObjectId } from 'mongodb'
import { collections } from '../lib/db'
import { getStationForUserId } from '../lib/station-info'

const router = Router()

// GET /api/documents/latest
router.get('/latest', async (req: Request, res: Response) => {
  try {
    const limit = parseInt((req.query.limit as string) || '50')
    const category = req.query.category as string | undefined
    const filter = req.query.filter as string | undefined

    const foundFilter: Record<string, unknown> = {}
    if (category && category !== 'all') {
      foundFilter.documentType = category
    }
    if (filter === 'urgent') {
      foundFilter.isUrgent = true
    }
    if (filter === 'available') {
      foundFilter.$or = [{ status: 'PENDING' }, { status: { $exists: false } }]
    }
    if (filter === 'claimed') {
      foundFilter.status = { $in: ['CLAIM_PENDING', 'VERIFIED', 'MATCHED'] }
    }
    if (filter === 'collected' || filter === 'reunited') {
      foundFilter.status = 'HANDED_OVER'
    }

    const queryLimit =
      filter === 'urgent' || filter === 'claimed' || filter === 'collected' || filter === 'reunited'
        ? 1000
        : limit

    let foundReports = await collections
      .foundReports()
      .find(foundFilter)
      .sort({ createdAt: -1 })
      .limit(queryLimit)
      .toArray()

    if (filter === 'available') {
      foundReports = foundReports.filter((r) => !r.status || r.status === 'PENDING')
    }

    const documents = await Promise.all(
      foundReports.map(async (report) => {
        let station = null
        if (report.userId) {
          try {
            station = await getStationForUserId(report.userId)
            if (typeof report.stationName === 'string' && report.stationName.trim()) {
              station = { ...station, name: report.stationName.trim() }
            }
          } catch {
            station = null
          }
        } else if (typeof report.stationName === 'string' && report.stationName.trim()) {
          station = { name: report.stationName.trim() }
        }

        let uploader = null
        if (report.userId) {
          try {
            const user = await collections.users().findOne({
              _id:
                typeof report.userId === 'string'
                  ? new ObjectId(report.userId)
                  : report.userId,
            })
            if (user) {
              uploader = { name: user.name, email: user.email, phone: user.phone }
            }
          } catch {
            /* skip */
          }
        }

        return {
          id: report._id!.toString(),
          type: 'found' as const,
          documentType: report.documentType,
          documentNumber: report.documentNumber || null,
          description: report.description || null,
          foundLocation: report.foundLocation || null,
          lostLocation: null,
          status: report.status || 'PENDING',
          isUrgent: report.isUrgent || false,
          urgentMessage: report.urgentMessage || null,
          createdAt: report.createdAt || new Date(),
          reportDate: report.foundDate || report.createdAt || new Date(),
          image: report.image || null,
          station,
          user: uploader,
        }
      })
    )

    const sliced =
      filter === 'urgent' || filter === 'claimed' || filter === 'collected' || filter === 'reunited'
        ? documents
        : documents.slice(0, limit)

    return res.json({
      documents: sliced,
      count: sliced.length,
    })
  } catch (error) {
    console.error('Error fetching latest documents:', error)
    return res.status(500).json({
      error: 'Failed to fetch latest documents',
      documents: [],
      count: 0,
    })
  }
})

// GET /api/documents/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const type = req.query.type as string

    if (!type || (type !== 'lost' && type !== 'found')) {
      return res.status(400).json({ error: 'Document type (lost or found) is required' })
    }

    let document: Record<string, unknown> | null = null

    if (type === 'lost') {
      const lostDoc = await collections.lostReports().findOne({ _id: new ObjectId(id) })
      if (!lostDoc) {
        return res.status(404).json({ error: 'Document not found' })
      }

      let userInfo = null
      if (lostDoc.userId) {
        const user = await collections.users().findOne({
          _id:
            typeof lostDoc.userId === 'string' ? new ObjectId(lostDoc.userId) : lostDoc.userId,
        })
        if (user) {
          userInfo = { name: user.name, email: user.email, phone: user.phone }
        }
      }
      if (!userInfo && (lostDoc.reporterName || lostDoc.reporterEmail)) {
        userInfo = {
          name: lostDoc.reporterName || null,
          email: lostDoc.reporterEmail || null,
          phone: lostDoc.reporterPhone || null,
        }
      }

      document = {
        id: lostDoc._id!.toString(),
        type: 'lost',
        documentType: lostDoc.documentType,
        documentNumber: lostDoc.documentNumber || null,
        description: lostDoc.description || null,
        lostLocation: lostDoc.lostLocation || null,
        foundLocation: null,
        status: lostDoc.status || 'PENDING',
        reportDate: lostDoc.lostDate || lostDoc.createdAt || new Date(),
        image: null,
        user: userInfo,
      }
    } else {
      const foundDoc = await collections.foundReports().findOne({ _id: new ObjectId(id) })
      if (!foundDoc) {
        return res.status(404).json({ error: 'Document not found' })
      }

      let userInfo = null
      if (foundDoc.userId) {
        const user = await collections.users().findOne({
          _id:
            typeof foundDoc.userId === 'string' ? new ObjectId(foundDoc.userId) : foundDoc.userId,
        })
        if (user) {
          userInfo = { name: user.name, email: user.email, phone: user.phone }
        }
      }
      if (!userInfo && (foundDoc.uploaderName || foundDoc.uploaderEmail)) {
        userInfo = {
          name: foundDoc.uploaderName || null,
          email: foundDoc.uploaderEmail || null,
          phone: foundDoc.uploaderPhone || null,
        }
      }

      document = {
        id: foundDoc._id!.toString(),
        type: 'found',
        documentType: foundDoc.documentType,
        documentNumber: foundDoc.documentNumber || null,
        description: foundDoc.description || null,
        lostLocation: null,
        foundLocation: foundDoc.foundLocation || null,
        status: foundDoc.status || 'PENDING',
        reportDate: foundDoc.foundDate || foundDoc.createdAt || new Date(),
        image: foundDoc.image || null,
        user: userInfo,
      }
    }

    const documentType = document.documentType as string
    let relatedDocuments: Record<string, unknown>[] = []

    if (documentType) {
      const relatedLost = await collections
        .lostReports()
        .find({ documentType, _id: { $ne: new ObjectId(id) } })
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray()

      const relatedFound = await collections
        .foundReports()
        .find({ documentType, _id: { $ne: new ObjectId(id) } })
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray()

      relatedDocuments = [
        ...relatedLost.map((r) => ({
          id: r._id!.toString(),
          type: 'lost',
          documentType: r.documentType,
          reportDate: r.lostDate || r.createdAt || new Date(),
        })),
        ...relatedFound.map((r) => ({
          id: r._id!.toString(),
          type: 'found',
          documentType: r.documentType,
          reportDate: r.foundDate || r.createdAt || new Date(),
        })),
      ]
        .sort(
          (a, b) =>
            new Date(String(b.reportDate)).getTime() - new Date(String(a.reportDate)).getTime()
        )
        .slice(0, 6)
    }

    return res.json({ document, relatedDocuments })
  } catch (error) {
    console.error('Error fetching document:', error)
    return res.status(500).json({ error: 'Failed to fetch document' })
  }
})

export default router
