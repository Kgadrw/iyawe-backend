import { ObjectId } from 'mongodb'
import { collections } from './db'

export type AuditAction =
  | 'AUTH_LOGIN'
  | 'AUTH_LOGOUT'
  | 'AUTH_REGISTER'
  | 'REPORT_LOST_CREATE'
  | 'REPORT_FOUND_CREATE'
  | 'REPORT_STATUS_UPDATE'
  | 'ADMIN_VIEW'

export type AuditEntityType = 'USER' | 'LOST_REPORT' | 'FOUND_REPORT' | 'SYSTEM'

export async function writeAuditLog(entry: {
  actorUserId?: ObjectId | null
  actorRole?: string | null
  action: AuditAction
  entityType: AuditEntityType
  entityId?: ObjectId | null
  message?: string
  metadata?: Record<string, unknown>
}) {
  await collections.auditLogs().insertOne({
    ...entry,
    createdAt: new Date(),
  })
}

