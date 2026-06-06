import { ObjectId } from 'mongodb'
import { collections } from './db'
import { hashDocumentNumber } from './matching'
import { getStationForUserId } from './station-info'
import { sendWatchFoundNotificationEmail } from './watch-alert-email'

export type DocumentType =
  | 'ID_CARD'
  | 'PASSPORT'
  | 'ATM_CARD'
  | 'STUDENT_CARD'
  | 'DRIVERS_LICENSE'
  | 'OTHER'

export type DocumentWatchAlert = {
  _id?: ObjectId
  documentType: DocumentType
  documentNumber?: string | null
  description?: string | null
  lostDate?: Date | null
  lostLocation?: string | null
  contactName: string
  contactEmail: string
  contactPhone?: string | null
  status: 'ACTIVE' | 'NOTIFIED' | 'CANCELLED'
  matchedFoundReportId?: ObjectId | null
  notifiedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

function normalizeText(value: string) {
  return value.toLowerCase().trim()
}

export function watchAlertMatchesFound(
  watch: Pick<DocumentWatchAlert, 'documentType' | 'documentNumber' | 'lostLocation' | 'description'>,
  found: {
    documentType: DocumentType
    documentNumber?: string | null
    foundLocation?: string | null
    description?: string | null
  }
): { matches: boolean; isExact: boolean } {
  if (watch.documentType !== found.documentType) {
    return { matches: false, isExact: false }
  }

  if (watch.documentNumber?.trim() && found.documentNumber?.trim()) {
    const exact =
      hashDocumentNumber(watch.documentNumber) === hashDocumentNumber(found.documentNumber)
    return { matches: exact, isExact: exact }
  }

  if (watch.documentNumber?.trim() && !found.documentNumber?.trim()) {
    return { matches: false, isExact: false }
  }

  let score = 0.3

  if (watch.lostLocation && found.foundLocation) {
    const w = normalizeText(watch.lostLocation)
    const f = normalizeText(found.foundLocation)
    if (w === f || w.includes(f) || f.includes(w)) score += 0.25
  }

  if (watch.description && found.description) {
    const w = normalizeText(watch.description)
    const f = normalizeText(found.description)
    if (w === f || w.includes(f) || f.includes(w)) score += 0.2
  }

  return { matches: score >= 0.45, isExact: false }
}

async function notifyOneWatch(
  watch: DocumentWatchAlert & { _id: ObjectId },
  found: {
    _id: ObjectId
    userId?: ObjectId
    documentType: DocumentType
    documentNumber?: string | null
    foundLocation?: string | null
  }
) {
  const station = found.userId
    ? await getStationForUserId(found.userId)
    : {
        name: found.foundLocation || 'Collection station',
        address: null,
        phone: null,
        email: null,
      }

  const documentTypeLabel = String(found.documentType).replace(/_/g, ' ')

  await sendWatchFoundNotificationEmail({
    to: watch.contactEmail,
    contactName: watch.contactName,
    documentTypeLabel,
    documentNumber: found.documentNumber,
    station,
    foundLocation: found.foundLocation,
  })

  await collections.documentWatchAlerts().updateOne(
    { _id: watch._id },
    {
      $set: {
        status: 'NOTIFIED',
        matchedFoundReportId: found._id,
        notifiedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  )
}

export async function notifyWatchAgainstExistingFound(watchId: string) {
  const watch = (await collections.documentWatchAlerts().findOne({
    _id: new ObjectId(watchId),
    status: 'ACTIVE',
  })) as (DocumentWatchAlert & { _id: ObjectId }) | null

  if (!watch) return { notified: false }

  const candidates = await collections
    .foundReports()
    .find({
      documentType: watch.documentType,
      status: { $nin: ['HANDED_OVER'] },
    })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray()

  for (const found of candidates) {
    const { matches } = watchAlertMatchesFound(watch, found as any)
    if (matches) {
      await notifyOneWatch(watch, found as any)
      return { notified: true, foundReportId: found._id!.toString() }
    }
  }
  return { notified: false }
}
