import { isEmailConfigured, sendEmail } from './email'
import { buildSubizwaEmail, getAppUrl } from './email-template'
import type { StationInfo } from './station-info'

type ClaimEmailParams = {
  to: string
  claimantName: string
  documentTypeLabel: string
  documentNumber?: string | null
  station: StationInfo
  foundLocation?: string | null
}

export async function sendClaimConfirmationEmail(params: ClaimEmailParams): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn('[email] SMTP not configured — claim confirmation skipped')
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
    subject: 'Subizwa — Your claim was received',
    preheader: 'Your document claim is recorded. Visit the station with valid ID.',
    recipientName: params.claimantName,
    headline: 'Your claim has been recorded',
    bodyParagraphs: [
      'Thank you for using Subizwa. We have received your claim for the document below.',
      'Please visit the collection station with valid government-issued ID and the contact details you used when claiming. Station staff will verify your identity before handover.',
      'Note: Other people may also claim the same document. The station will confirm the rightful owner.',
    ],
    sections: [
      { title: 'Document', rows: [{ label: 'Type', value: docRef }] },
      { title: 'Collection station', rows: stationRows },
    ],
    cta: { label: 'View on Subizwa', url: getAppUrl() },
    footerNote:
      'This is an automated confirmation only. Do not reply to this email. For help, contact the station listed above.',
  })

  try {
    await sendEmail({ to: params.to, subject, text, html })
    return true
  } catch (error) {
    console.error('[email] Claim confirmation failed:', error)
    return false
  }
}
