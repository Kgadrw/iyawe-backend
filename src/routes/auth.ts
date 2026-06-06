import { Router, Request, Response } from 'express'
import { getUserByEmail, verifyPassword } from '../lib/auth'
import { z } from 'zod'
import { SignJWT } from 'jose'
import { writeAuditLog } from '../lib/audit'
import { ObjectId } from 'mongodb'

const router = Router()

const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key-change-in-production')

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

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
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7 * 1000, // 7 days in milliseconds
      path: '/',
    })

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
