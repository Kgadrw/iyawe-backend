import { isEmailConfigured, sendEmail } from './email'
import type { StationInfo } from './station-info'

type WatchFoundEmailParams = {
  to: string
  contactName: string
  documentTypeLabel: string
  documentNumber?: string | null
  station: StationInfo
  foundLocation?: string | null
}

export async function sendWatchFoundNotificationEmail(
  params: WatchFoundEmailParams
): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn('SMTP not configured — watch alert email skipped')
    return false
  }

  const appUrl = process.env.APP_URL || 'http://localhost:3000'
  const docRef = params.documentNumber
    ? `${params.documentTypeLabel} (${params.documentNumber})`
    : params.documentTypeLabel

  const subject = 'Subizwa: A matching document was found'
  const text = `Hello ${params.contactName},

Good news — a document matching your alert is listed on Subizwa.

Document: ${docRef}

Collection station:
${params.station.name}
${params.station.address || ''}
${params.station.phone ? `Phone: ${params.station.phone}` : ''}
${params.foundLocation ? `Found at: ${params.foundLocation}` : ''}

Visit ${appUrl} to view details and claim your document.

— Subizwa`

  try {
    await sendEmail({ to: params.to, subject, text })
    return true
  } catch (error) {
    console.error('Failed to send watch alert email:', error)
    return false
  }
}
