import { Router, Request, Response } from 'express'
import { collections } from '../lib/db'

const router = Router()

const AD_PLACEMENTS = ['BANNER_TOP', 'SIDEBAR_RIGHT'] as const
type AdPlacement = (typeof AD_PLACEMENTS)[number]

function normalizeAdPlacement(value: unknown): AdPlacement {
  if (value === 'BANNER_TOP' || value === 'SIDEBAR_RIGHT') return value
  return 'SIDEBAR_RIGHT'
}

// GET /api/ads — public active ads for homepage
router.get('/', async (_req: Request, res: Response) => {
  try {
    const ads = await collections
      .ads()
      .find({ isActive: true })
      .sort({ order: 1, createdAt: -1 })
      .toArray()

    const publicAds = ads.map((ad) => ({
      id: ad._id!.toString(),
      image: ad.image || ad.imageUrl || '',
      link: ad.link || '',
      title: ad.title,
      placement: normalizeAdPlacement(ad.placement),
      order: ad.order ?? 0,
    }))

    const byPlacement: Record<AdPlacement, typeof publicAds> = {
      BANNER_TOP: [],
      SIDEBAR_RIGHT: [],
    }
    for (const ad of publicAds) {
      byPlacement[ad.placement].push(ad)
    }
    byPlacement.BANNER_TOP = byPlacement.BANNER_TOP.slice(0, 2)

    return res.json({
      ads: publicAds,
      byPlacement,
      bannerTop: byPlacement.BANNER_TOP,
      sidebarRight: byPlacement.SIDEBAR_RIGHT,
    })
  } catch (error: unknown) {
    console.error('Error fetching ads:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return res.status(500).json({ error: 'Failed to fetch ads', details: message })
  }
})

export default router
