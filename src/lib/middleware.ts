import { Request, Response, NextFunction } from 'express'
import { jwtVerify } from 'jose'

const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'your-secret-key-change-in-production')

export interface AuthRequest extends Request {
  userId?: string
  user?: {
    userId: string
    email: string
    role: string
  }
}

export async function getUserIdFromToken(req: Request): Promise<string | null> {
  try {
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '')
    if (!token) {
      return null
    }

    const { payload } = await jwtVerify(token, secret)
    return payload.userId as string
  } catch (error) {
    return null
  }
}

export async function getUserFromToken(req: Request) {
  try {
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '')
    if (!token) {
      return null
    }

    const { payload } = await jwtVerify(token, secret)
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      role: payload.role as string,
    }
  } catch (error) {
    return null
  }
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const user = await getUserFromToken(req)
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  req.user = user
  req.userId = user.userId
  next()
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const user = await getUserFromToken(req)
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  req.user = user
  req.userId = user.userId
  next()
}

export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    console.log('requireAdmin middleware - Checking authentication')
    console.log('Request path:', req.path)
    console.log('Request method:', req.method)
    console.log('Cookies:', req.cookies)
    console.log('Authorization header:', req.headers.authorization ? 'Present' : 'Missing')
    
    const user = await getUserFromToken(req)
    if (!user) {
      console.log('requireAdmin: No user found')
      return res.status(401).json({ error: 'Unauthorized' })
    }
    console.log('requireAdmin: User found:', { userId: user.userId, email: user.email, role: user.role })
    if (user.role !== 'ADMIN') {
      console.log('requireAdmin: User is not admin')
      return res.status(403).json({ error: 'Forbidden: Admin access required' })
    }
    req.user = user
    req.userId = user.userId
    console.log('requireAdmin: Authentication successful')
    next()
  } catch (error: any) {
    console.error('Error in requireAdmin middleware:', error)
    console.error('Error stack:', error.stack)
    return res.status(401).json({ error: 'Unauthorized', details: error.message })
  }
}

export function requireRoles(allowedRoles: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = await getUserFromToken(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    req.user = user
    req.userId = user.userId
    next()
  }
}
