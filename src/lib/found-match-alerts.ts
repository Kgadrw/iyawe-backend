import { ObjectId } from 'mongodb'
import { collections } from './db'
import { getUserById } from './auth'
import { isEmailConfigured, sendEmail } from './email'
import {
  createAdminNotification,
  createUserNotification,
  NotificationType,
} from './notifications'

type LostReportDoc = {
  _id?: ObjectId
  userId?: ObjectId | null
  documentType: string
  documentNumber?: string | null
  lostLocation?: string | null
  reporterName?: string | null
  reporterEmail?: string | null
}

type FoundReportDoc = {
  _id?: ObjectId
  documentType: string
  documentNumber?: string | null
  foundLocation?: string | null
}

export type MatchAlertRow = {
  _id?: ObjectId
  lostReportId: ObjectId | string
  foundReportId: ObjectId | string
  isExactMatch?: boolean
}

function formatDocType(type: string) {
  return type.replace(/_/g, ' ')
}

function maskDocumentNumber(num?: string | null) {
  if (!num || num.length < 4) return 'N/A'
  return `${num.substring(0, 2)}****${num.substring(num.length - 2)}`
}

async function resolveLostOwnerContact(lostReport: LostReportDoc) {
  if (lostReport.reporterEmail) {
    return {
      email: lostReport.reporterEmail,
      name: lostReport.reporterName || 'there',
    }
  }

  if (lostReport.userId) {
    const user = await getUserById(lostReport.userId.toString())
    if (user?.email) {
      return { email: user.email, name: user.name || 'there' }
    }
  }

  return null
}

function buildOwnerEmail(lostReport: LostReportDoc, foundReport: FoundReportDoc, isExact: boolean) {
  const docType = formatDocType(foundReport.documentType)
  const docNum = maskDocumentNumber(foundReport.documentNumber)
  const location = foundReport.foundLocation || 'Not specified'
  const appUrl = process.env.APP_URL || 'http://localhost:3000'

  const subject = isExact
    ? 'Subizwa: Strong match found for your lost document'
    : 'Subizwa: Possible match for your lost document'

  const intro = isExact
    ? `Good news — a recovered document closely matches your lost ${docType} report.`
    : `A recovered document may match your lost ${docType} report.`

  const text = `Hello ${lostReport.reporterName || 'there'},

${intro}

Document type: ${docType}
Document number (partial): ${docNum}
Found location: ${location}

Please sign in or visit Subizwa to review and verify whether this is your document:
${appUrl}

If you did not report a lost document with Subizwa, you can ignore this email.

— Subizwa`

  const html = `
    <p>Hello ${lostReport.reporterName || 'there'},</p>
    <p>${intro}</p>
    <ul>
      <li><strong>Document type:</strong> ${docType}</li>
      <li><strong>Document number (partial):</strong> ${docNum}</li>
      <li><strong>Found location:</strong> ${location}</li>
    </ul>
    <p><a href="${appUrl}">Open Subizwa</a> to review this match.</p>
    <p style="color:#666;font-size:12px;">If you did not report a lost document, you can ignore this message.</p>
    <p>— Subizwa</p>
  `

  return { subject, text, html }
}

async function sendOwnerMatchEmail(
  lostReport: LostReportDoc,
  foundReport: FoundReportDoc,
  isExact: boolean
) {
  if (!isEmailConfigured()) return false

  const contact = await resolveLostOwnerContact(lostReport)
  if (!contact?.email) return false

  const { subject, text, html } = buildOwnerEmail(
    { ...lostReport, reporterName: contact.name },
    foundReport,
    isExact
  )

  try {
    await sendEmail({ to: contact.email, subject, text, html })
    return true
  } catch (error) {
    console.error('Failed to send match alert email to', contact.email, error)
    return false
  }
}

async function sendAdminMatchEmail(
  lostReport: LostReportDoc,
  foundReport: FoundReportDoc,
  isExact: boolean
) {
  if (!isEmailConfigured()) return

  const adminTo = process.env.ADMIN_ALERT_EMAIL || process.env.SMTP_USER
  if (!adminTo) return

  const docType = formatDocType(foundReport.documentType)
  const docNum = maskDocumentNumber(foundReport.documentNumber)

  const subject = isExact
    ? 'Subizwa admin: exact document match'
    : 'Subizwa admin: potential document match'

  const text = `${isExact ? 'Exact' : 'Potential'} match detected.

Lost report: ${formatDocType(lostReport.documentType)}
Found report: ${docType}
Document number (partial): ${docNum}
Found location: ${foundReport.foundLocation || 'N/A'}

Review in the admin dashboard.`

  try {
    await sendEmail({ to: adminTo, subject, text })
  } catch (error) {
    console.error('Failed to send admin match alert email', error)
  }
}

async function notifyOneMatch(
  match: MatchAlertRow,
  lostReport: LostReportDoc,
  foundReport: FoundReportDoc,
  isExact: boolean,
  options?: { skipAdminInApp?: boolean }
) {
  const documentTypeLabel = formatDocType(foundReport.documentType)
  const documentNumberPartial = maskDocumentNumber(foundReport.documentNumber)

  if (!options?.skipAdminInApp) {
    await createAdminNotification(
      NotificationType.ADMIN_MATCH_ALERT,
      isExact ? 'Exact document match found' : 'Potential document match found',
      `Match for found ${documentTypeLabel}. Number: ${documentNumberPartial}. Location: ${foundReport.foundLocation || 'N/A'}.`,
      match._id,
      match.lostReportId,
      match.foundReportId
    )
  }

  if (lostReport.userId) {
    await createUserNotification(
      lostReport.userId,
      NotificationType.MATCH_FOUND,
      isExact ? 'Strong match found' : 'Possible match found',
      `A recovered ${documentTypeLabel} may match your lost report. Location: ${foundReport.foundLocation || 'N/A'}.`,
      match._id,
      match.lostReportId,
      match.foundReportId
    )
  }

  const sent = await sendOwnerMatchEmail(lostReport, foundReport, isExact)
  if (!options?.skipAdminInApp) {
    await sendAdminMatchEmail(lostReport, foundReport, isExact)
  }
  return sent
}

export async function notifyMatchesForFoundUpload(matches: MatchAlertRow[]) {
  if (!matches.length) return { emailsSent: 0 }

  let emailsSent = 0
  const exactMatches = matches.filter((m) => m.isExactMatch === true)

  if (exactMatches.length > 0) {
    for (const match of exactMatches) {
      const lostReport = (await collections.lostReports().findOne({
        _id: new ObjectId(match.lostReportId),
      })) as LostReportDoc | null
      const foundReport = (await collections.foundReports().findOne({
        _id: new ObjectId(match.foundReportId),
      })) as FoundReportDoc | null
      if (!lostReport || !foundReport) continue
      if (await notifyOneMatch(match, lostReport, foundReport, true)) emailsSent += 1
    }
    return { emailsSent }
  }

  for (const match of matches) {
    const lostReport = (await collections.lostReports().findOne({
      _id: new ObjectId(match.lostReportId),
    })) as LostReportDoc | null
    const foundReport = (await collections.foundReports().findOne({
      _id: new ObjectId(match.foundReportId),
    })) as FoundReportDoc | null
    if (!lostReport || !foundReport) continue
    if (
      await notifyOneMatch(match, lostReport, foundReport, false, {
        skipAdminInApp: true,
      })
    ) {
      emailsSent += 1
    }
  }

  const first = matches[0]
  const firstLost = (await collections.lostReports().findOne({
    _id: new ObjectId(first.lostReportId),
  })) as LostReportDoc | null
  const firstFound = (await collections.foundReports().findOne({
    _id: new ObjectId(first.foundReportId),
  })) as FoundReportDoc | null

  await createAdminNotification(
    NotificationType.ADMIN_MATCH_ALERT,
    'Potential matches for new found document',
    `${matches.length} potential match(es) need review.`,
    undefined,
    undefined,
    first.foundReportId
  )

  if (firstLost && firstFound) {
    await sendAdminMatchEmail(firstLost, firstFound, false)
  }

  return { emailsSent }
}

export async function notifyMatchesForLostUpload(matches: MatchAlertRow[]) {
  return notifyMatchesForFoundUpload(matches)
}
