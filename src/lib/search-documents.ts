import { ObjectId } from 'mongodb'
import { collections } from './db'

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  ID_CARD: 'ID Card',
  PASSPORT: 'Passport',
  ATM_CARD: 'ATM Card',
  STUDENT_CARD: 'Student Card',
  DRIVERS_LICENSE: "Driver's License",
  OTHER: 'Other',
}

const DOCUMENT_TYPE_ALIASES: Record<string, string[]> = {
  ID_CARD: ['id card', 'id', 'national id', 'identity'],
  PASSPORT: ['passport'],
  ATM_CARD: ['atm card', 'atm', 'bank card', 'debit'],
  STUDENT_CARD: ['student card', 'student id', 'student'],
  DRIVERS_LICENSE: ['drivers license', "driver's license", 'driver license', 'license', 'driving'],
  OTHER: ['other'],
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[\s\-_./]/g, '')
}

function tokenizeQuery(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1)
}

function getDocumentTypesFromQuery(query: string): string[] {
  const lower = query.toLowerCase().trim()
  const tokens = tokenizeQuery(lower)
  const matched = new Set<string>()

  for (const [enumValue, aliases] of Object.entries(DOCUMENT_TYPE_ALIASES)) {
    for (const alias of aliases) {
      const aliasNorm = alias.toLowerCase()
      if (
        lower === aliasNorm ||
        tokens.some((t) => t === aliasNorm || (aliasNorm.includes(t) && t.length >= 3))
      ) {
        matched.add(enumValue)
      }
    }
  }

  const upper = query.toUpperCase().trim()
  if (Object.keys(DOCUMENT_TYPE_LABELS).includes(upper)) {
    matched.add(upper)
  }

  return Array.from(matched)
}

function buildFieldRegexConditions(token: string): Record<string, unknown>[] {
  const escaped = escapeRegex(token)
  const flexibleDocNum = escapeRegex(token).replace(/\s+/g, '\\s*')

  return [
    { description: { $regex: escaped, $options: 'i' } },
    { lostLocation: { $regex: escaped, $options: 'i' } },
    { foundLocation: { $regex: escaped, $options: 'i' } },
    { documentNumber: { $regex: flexibleDocNum, $options: 'i' } },
    { reporterName: { $regex: escaped, $options: 'i' } },
    { reporterEmail: { $regex: escaped, $options: 'i' } },
    { reporterPhone: { $regex: escaped, $options: 'i' } },
    { uploaderName: { $regex: escaped, $options: 'i' } },
    { uploaderEmail: { $regex: escaped, $options: 'i' } },
    { uploaderPhone: { $regex: escaped, $options: 'i' } },
    { status: { $regex: escaped, $options: 'i' } },
  ]
}

function buildMongoFilter(query: string, documentTypes: string[], matchingUserIds: ObjectId[]) {
  const tokens = tokenizeQuery(query)
  const branches: Record<string, unknown>[] = []

  if (tokens.length > 0) {
    branches.push({
      $and: tokens.map((token) => ({
        $or: buildFieldRegexConditions(token),
      })),
    })
  }

  if (documentTypes.length > 0) {
    branches.push({ documentType: { $in: documentTypes } })
  }
  if (matchingUserIds.length > 0) {
    branches.push({ userId: { $in: matchingUserIds } })
  }

  if (branches.length === 0) return {}
  if (branches.length === 1) return branches[0]
  return { $or: branches }
}

function scoreReport(
  query: string,
  report: {
    documentType?: string
    documentNumber?: string | null
    description?: string | null
    lostLocation?: string | null
    foundLocation?: string | null
    reporterName?: string | null
    reporterEmail?: string | null
    status?: string
    user?: { name?: string | null; email?: string | null } | null
  }
): number {
  const q = query.trim().toLowerCase()
  const qNorm = normalizeText(query)
  const tokens = tokenizeQuery(q)

  const fields = [
    report.documentNumber,
    report.description,
    report.lostLocation,
    report.foundLocation,
    report.reporterName,
    report.reporterEmail,
    report.user?.name,
    report.user?.email,
    report.documentType ? DOCUMENT_TYPE_LABELS[report.documentType] : null,
    report.documentType?.replace(/_/g, ' '),
    report.status,
  ].filter(Boolean) as string[]

  let score = 0

  for (const field of fields) {
    const lower = field.toLowerCase()
    const norm = normalizeText(field)
    if (lower === q || norm === qNorm) score += 100
    else if (lower.startsWith(q) || norm.startsWith(qNorm)) score += 80
    else if (lower.includes(q) || norm.includes(qNorm)) score += 50
  }

  for (const token of tokens) {
    const tNorm = normalizeText(token)
    let tokenHit = false
    for (const field of fields) {
      const lower = field.toLowerCase()
      const norm = normalizeText(field)
      if (lower === token || norm === tNorm) {
        score += 25
        tokenHit = true
      } else if (lower.includes(token) || norm.includes(tNorm)) {
        score += 12
        tokenHit = true
      }
    }
    if (!tokenHit) score -= 30
  }

  if (report.documentNumber && qNorm.length >= 4) {
    const docNorm = normalizeText(report.documentNumber)
    if (docNorm === qNorm) score += 120
    else if (docNorm.includes(qNorm)) score += 60
  }

  return score
}

export async function searchDocuments(query: string, limit = 40) {
  const trimmed = query.trim()
  if (!trimmed) {
    return { lostReports: [], foundReports: [], count: 0 }
  }

  const documentTypes = getDocumentTypesFromQuery(trimmed)
  const matchingUsers = await collections
    .users()
    .find({
      $or: [
        { name: { $regex: escapeRegex(trimmed), $options: 'i' } },
        { email: { $regex: escapeRegex(trimmed), $options: 'i' } },
      ],
    })
    .limit(20)
    .toArray()

  const matchingUserIds = matchingUsers.map((u) => u._id as ObjectId)
  const filter = buildMongoFilter(trimmed, documentTypes, matchingUserIds)
  const fetchLimit = Math.min(limit * 3, 120)
  const minScore = tokenizeQuery(trimmed).length > 1 ? 5 : 1

  const [lostRaw, foundRaw] = await Promise.all([
    collections.lostReports().find(filter).sort({ createdAt: -1 }).limit(fetchLimit).toArray(),
    collections.foundReports().find(filter).sort({ createdAt: -1 }).limit(fetchLimit).toArray(),
  ])

  const lostWithUsers = await Promise.all(
    lostRaw.map(async (report) => {
      let user = null
      if (report.userId) {
        user = await collections.users().findOne({ _id: report.userId as ObjectId })
      }
      const userInfo = user
        ? { name: user.name, email: user.email, phone: user.phone }
        : report.reporterName
          ? {
              name: report.reporterName,
              email: report.reporterEmail,
              phone: report.reporterPhone,
            }
          : null

      const row = {
        ...report,
        id: report._id!.toString(),
        userId: report.userId?.toString(),
        user: userInfo,
        lostDate: report.lostDate,
        reporterName: report.reporterName,
        reporterEmail: report.reporterEmail,
      }
      return { ...row, score: scoreReport(trimmed, { ...row, user: userInfo }) }
    })
  )

  const foundWithUsers = await Promise.all(
    foundRaw.map(async (report) => {
      let user = null
      if (report.userId) {
        user = await collections.users().findOne({ _id: report.userId as ObjectId })
      }
      const userInfo = user
        ? { name: user.name, email: user.email, phone: user.phone }
        : report.uploaderName
          ? {
              name: report.uploaderName,
              email: report.uploaderEmail,
              phone: report.uploaderPhone,
            }
          : null

      const row = {
        ...report,
        id: report._id!.toString(),
        userId: report.userId?.toString(),
        user: userInfo,
        foundDate: report.foundDate,
        image: report.image,
        reporterName: report.uploaderName || report.reporterName,
        reporterEmail: report.uploaderEmail || report.reporterEmail,
      }
      return { ...row, score: scoreReport(trimmed, { ...row, user: userInfo }) }
    })
  )

  const lostReports = lostWithUsers
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  const foundReports = foundWithUsers
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return {
    lostReports,
    foundReports,
    count: lostReports.length + foundReports.length,
  }
}
