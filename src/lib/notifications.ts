import { collections } from './db'
import { ObjectId } from 'mongodb'

export enum NotificationType {
  MATCH_FOUND = 'MATCH_FOUND',
  DOCUMENT_VERIFIED = 'DOCUMENT_VERIFIED',
  DOCUMENT_HANDED_OVER = 'DOCUMENT_HANDED_OVER',
  ADMIN_MATCH_ALERT = 'ADMIN_MATCH_ALERT',
}

export interface Notification {
  _id?: ObjectId
  userId?: ObjectId | null // null for admin notifications
  type: NotificationType
  title: string
  message: string
  relatedMatchId?: ObjectId
  relatedLostReportId?: ObjectId
  relatedFoundReportId?: ObjectId
  isRead: boolean
  createdAt: Date
  updatedAt: Date
}

/**
 * Create a notification for a user
 */
export async function createUserNotification(
  userId: ObjectId | string,
  type: NotificationType,
  title: string,
  message: string,
  relatedMatchId?: ObjectId | string,
  relatedLostReportId?: ObjectId | string,
  relatedFoundReportId?: ObjectId | string
): Promise<Notification> {
  const notification: Notification = {
    userId: typeof userId === 'string' ? new ObjectId(userId) : userId,
    type,
    title,
    message,
    relatedMatchId: relatedMatchId ? (typeof relatedMatchId === 'string' ? new ObjectId(relatedMatchId) : relatedMatchId) : undefined,
    relatedLostReportId: relatedLostReportId ? (typeof relatedLostReportId === 'string' ? new ObjectId(relatedLostReportId) : relatedLostReportId) : undefined,
    relatedFoundReportId: relatedFoundReportId ? (typeof relatedFoundReportId === 'string' ? new ObjectId(relatedFoundReportId) : relatedFoundReportId) : undefined,
    isRead: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const result = await collections.notifications().insertOne(notification)
  notification._id = result.insertedId
  return notification
}

/**
 * Create a notification for admin
 */
export async function createAdminNotification(
  type: NotificationType,
  title: string,
  message: string,
  relatedMatchId?: ObjectId | string,
  relatedLostReportId?: ObjectId | string,
  relatedFoundReportId?: ObjectId | string
): Promise<Notification> {
  const notification: Notification = {
    userId: null, // null means admin notification
    type,
    title,
    message,
    relatedMatchId: relatedMatchId ? (typeof relatedMatchId === 'string' ? new ObjectId(relatedMatchId) : relatedMatchId) : undefined,
    relatedLostReportId: relatedLostReportId ? (typeof relatedLostReportId === 'string' ? new ObjectId(relatedLostReportId) : relatedLostReportId) : undefined,
    relatedFoundReportId: relatedFoundReportId ? (typeof relatedFoundReportId === 'string' ? new ObjectId(relatedFoundReportId) : relatedFoundReportId) : undefined,
    isRead: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const result = await collections.notifications().insertOne(notification)
  notification._id = result.insertedId
  return notification
}

/**
 * Get notifications for a user
 */
export async function getUserNotifications(userId: ObjectId | string, limit: number = 50): Promise<Notification[]> {
  const notifications = await collections.notifications()
    .find({ userId: typeof userId === 'string' ? new ObjectId(userId) : userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray()
  
  return notifications as Notification[]
}

/**
 * Get admin notifications
 */
export async function getAdminNotifications(limit: number = 50): Promise<Notification[]> {
  const notifications = await collections.notifications()
    .find({ userId: null })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray()
  
  return notifications as Notification[]
}

/**
 * Mark notification as read
 */
export async function markNotificationAsRead(notificationId: ObjectId | string): Promise<void> {
  await collections.notifications().updateOne(
    { _id: typeof notificationId === 'string' ? new ObjectId(notificationId) : notificationId },
    { $set: { isRead: true, updatedAt: new Date() } }
  )
}

/**
 * Get unread notification count for a user
 */
export async function getUnreadNotificationCount(userId: ObjectId | string): Promise<number> {
  return await collections.notifications().countDocuments({
    userId: typeof userId === 'string' ? new ObjectId(userId) : userId,
    isRead: false,
  })
}

/**
 * Get unread admin notification count
 */
export async function getUnreadAdminNotificationCount(): Promise<number> {
  return await collections.notifications().countDocuments({
    userId: null,
    isRead: false,
  })
}
