import { isEmailConfigured, sendEmail } from './email'
import { buildSubizwaEmail, getAppUrl } from './email-template'
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
    console.warn('[email] SMTP not configured — watch alert skipped')
    return false
  }

  const docRef = params.documentNumber
    ? `${params.documentTypeLabel} · ${params.documentNumber}`
    : params.documentTypeLabel

  const stationRows = [
    { label: 'Station', value: params.station.name },
    ...(params.station.address ? [{ label: 'Address', value: params.station.address }] : []),
    ...(params.station.phone ? [{ label: 'Phone', value: params.station.phone }] : []),
    ...(params.foundLocation ? [{ label: 'Found near', value: params.foundLocation }] : []),
  ]

  const { subject, text, html } = buildSubizwaEmail({
    subject: 'Subizwa — A matching document was found',
    preheader: 'Good news — a document matching your alert is listed on Subizwa.',
    recipientName: params.contactName,
    headline: 'A matching document has been listed',
    bodyParagraphs: [
      'Good news — a document matching the details you registered on Subizwa has been found and listed at a station.',
      'Sign in or visit Subizwa to review the listing and submit a claim if this is your document.',
    ],
    sections: [
      { title: 'Document', rows: [{ label: 'Type', value: docRef }] },
      { title: 'Collection station', rows: stationRows },
    ],
    cta: { label: 'View & claim on Subizwa', url: getAppUrl() },
    footerNote:
      'You registered this alert on Subizwa. If you no longer need it, you can ignore this message.',
  })

  try {
    await sendEmail({ to: params.to, subject, text, html })
    return true
  } catch (error) {
    console.error('[email] Watch alert failed:', error)
    return false
  }
}
