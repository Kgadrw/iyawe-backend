import { Router, Request, Response } from 'express'
import { getUserByEmail, verifyPassword, getUserById, hashPassword } from '../lib/auth'
import { collections } from '../lib/db'
import { z } from 'zod'
import { SignJWT } from 'jose'
import { writeAuditLog } from '../lib/audit'
import { ObjectId } from 'mongodb'
import { getStaffStationContext } from '../lib/station-scope'

const router = Router()

const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key-change-in-production')

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

const STAFF_LOGIN_ROLES = ['ADMIN', 'OFFICER', 'INSTITUTION'] as const

const updateProfileSchema = z
  .object({
    name: z.string().min(2).max(120),
    email: z.string().email(),
    phone: z.string().max(30).optional().nullable(),
    stationName: z.string().max(120).optional().nullable(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(6).optional(),
  })
  .refine(
    (data) => {
      if (data.newPassword) return !!data.currentPassword
      return true
    },
    { message: 'Current password is required to set a new password', path: ['currentPassword'] }
  )

function publicUser(user: {
  _id: ObjectId
  email: string
  name: string
  phone?: string | null
  stationName?: string | null
  role: string
  createdAt?: Date
}) {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    phone: user.phone ?? '',
    stationName: user.stationName?.trim() || '',
    role: user.role,
    createdAt: user.createdAt,
  }
}

function authCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7 * 1000,
    path: '/',
  }
}

// POST /api/auth/register — disabled; staff accounts are created by admins
router.post('/register', async (_req: Request, res: Response) => {
  return res.status(403).json({
    error:
      'Self-registration is not available. Ask your administrator to create a staff account.',
  })
})

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const data = loginSchema.parse(req.body)

    const user = await getUserByEmail(data.email)
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const isValid = await verifyPassword(data.password, user.passwordHash)
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    if (user.role === 'USER') {
      return res.status(403).json({
        error:
          'Public accounts cannot log in here. This portal is for admin, police officers, and registered institutions only. Observers can use the site without signing in.',
      })
    }

    // Create JWT token
    const token = await new SignJWT({
      userId: user._id!.toString(),
      email: user.email,
      role: user.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret)

    // Set HTTP-only cookie
    res.cookie('token', token, authCookieOptions())

    await writeAuditLog({
      actorUserId: user._id ? new ObjectId(user._id) : null,
      actorRole: user.role,
      action: 'AUTH_LOGIN',
      entityType: 'USER',
      entityId: user._id ? new ObjectId(user._id) : null,
      message: 'User logged in',
      metadata: { email: user.email, role: user.role },
    })

    return res.json({
      message: 'Login successful',
      user: {
        id: user._id!.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors })
    }
    console.error('Login error:', error)
    return res.status(500).json({ error: 'Failed to login. Please try again.' })
  }
})

// GET /api/auth/me
router.get('/me', async (req: Request, res: Response) => {
  const { getUserFromToken } = await import('../lib/middleware')
  const session = await getUserFromToken(req)
  if (!session) {
    return res.json({ user: null })
  }

  const user = await getUserById(session.userId)
  if (!user) {
    return res.json({ user: null })
  }

  const stationCtx = await getStaffStationContext(session.userId)

  return res.json({
    user: {
      ...publicUser(user as any),
      stationName: stationCtx.stationName || '',
    },
  })
})

// PATCH /api/auth/me
router.patch('/me', async (req: Request, res: Response) => {
  try {
    const { getUserFromToken } = await import('../lib/middleware')
    const session = await getUserFromToken(req)
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    if (!STAFF_LOGIN_ROLES.includes(session.role as (typeof STAFF_LOGIN_ROLES)[number])) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const data = updateProfileSchema.parse(req.body)
    const existing = await getUserById(session.userId)
    if (!existing) {
      return res.status(404).json({ error: 'User not found' })
    }

    if (data.email.toLowerCase() !== existing.email.toLowerCase()) {
      const emailTaken = await getUserByEmail(data.email)
      if (emailTaken && emailTaken._id!.toString() !== session.userId) {
        return res.status(400).json({ error: 'Email is already in use' })
      }
    }

    const update: Record<string, unknown> = {
      name: data.name.trim(),
      email: data.email.trim().toLowerCase(),
      phone: data.phone?.trim() || null,
      updatedAt: new Date(),
    }

    if (data.stationName !== undefined && ['OFFICER', 'INSTITUTION'].includes(existing.role)) {
      update.stationName = data.stationName?.trim() || null
    }

    if (data.newPassword) {
      const valid = await verifyPassword(data.currentPassword!, existing.passwordHash)
      if (!valid) {
        return res.status(400).json({ error: 'Current password is incorrect' })
      }
      update.passwordHash = await hashPassword(data.newPassword)
    }

    await collections.users().updateOne({ _id: existing._id }, { $set: update })

    const updated = await getUserById(session.userId)
    if (!updated) {
      return res.status(500).json({ error: 'Failed to load updated profile' })
    }

    const token = await new SignJWT({
      userId: updated._id!.toString(),
      email: updated.email,
      role: updated.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret)

    res.cookie('token', token, authCookieOptions())

    return res.json({
      message: 'Profile updated',
      user: publicUser(updated as any),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors })
    }
    console.error('Profile update error:', error)
    return res.status(500).json({ error: 'Failed to update profile' })
  }
})

// POST /api/auth/logout
router.post('/logout', async (req: Request, res: Response) => {
  res.clearCookie('token', { path: '/' })
  // Can't reliably identify the user here without verifying token again.
  await writeAuditLog({
    actorUserId: null,
    actorRole: null,
    action: 'AUTH_LOGOUT',
    entityType: 'SYSTEM',
    entityId: null,
    message: 'User logged out',
  })
  return res.json({ message: 'Logged out successfully' })
})

export default router
