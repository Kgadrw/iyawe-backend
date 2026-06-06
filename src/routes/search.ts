import { Router, Request, Response } from 'express'
import { searchDocuments } from '../lib/search-documents'

const router = Router()

router.get('/', async (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string)?.trim()

    if (!query) {
      return res.status(400).json({ error: 'Search query is required' })
    }

    const { lostReports, foundReports, count } = await searchDocuments(query)

    return res.json({
      query,
      results: {
        lostReports,
        foundReports,
      },
      count,
    })
  } catch (error) {
    console.error('Search error:', error)
    return res.status(500).json({ error: 'Failed to perform search' })
  }
})

export default router
