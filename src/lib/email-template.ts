/** Subizwa brand tokens (RNP-aligned) */
const BRAND = {
  navy: '#0C2340',
  gold: '#F5C518',
  sky: '#4BA3D9',
  text: '#1e293b',
  muted: '#64748b',
  border: '#e2e8f0',
  bg: '#f8fafc',
}

export function getAppUrl(): string {
  return (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://subizwa.vercel.app'
  ).replace(/\/$/, '')
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export type EmailDetailRow = { label: string; value: string }
export type EmailSection = { title: string; rows: EmailDetailRow[] }

export type SubizwaEmailContent = {
  subject: string
  preheader?: string
  recipientName: string
  headline: string
  bodyParagraphs: string[]
  sections?: EmailSection[]
  cta?: { label: string; url: string }
  footerNote?: string
}

export function buildSubizwaEmail(content: SubizwaEmailContent): {
  subject: string
  text: string
  html: string
} {
  const name = content.recipientName.trim() || 'there'
  const preheader = content.preheader || content.headline
  const appUrl = getAppUrl()

  const textSections =
    content.sections
      ?.map((section) => {
        const rows = section.rows.map((r) => `  ${r.label}: ${r.value}`).join('\n')
        return `${section.title}\n${rows}`
      })
      .join('\n\n') ?? ''

  const textParagraphs = content.bodyParagraphs.join('\n\n')
  const textCta = content.cta ? `\n\n${content.cta.label}: ${content.cta.url}` : ''
  const textFooter = content.footerNote
    ? `\n\n${content.footerNote}`
    : '\n\nIf you did not use Subizwa, you can safely ignore this message.'

  const text = `Subizwa — Found documents recovery

Hello ${name},

${content.headline}

${textParagraphs}
${textSections ? `\n\n${textSections}` : ''}${textCta}${textFooter}

— Subizwa
${appUrl}`

  const bodyHtml = content.bodyParagraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${BRAND.text};">${escapeHtml(p)}</p>`)
    .join('')

  const sectionsHtml =
    content.sections
      ?.map((section) => {
        const rows = section.rows
          .map(
            (row) => `
          <tr>
            <td style="padding:8px 12px;font-size:13px;color:${BRAND.muted};width:38%;vertical-align:top;border-bottom:1px solid ${BRAND.border};">${escapeHtml(row.label)}</td>
            <td style="padding:8px 12px;font-size:14px;color:${BRAND.text};font-weight:500;border-bottom:1px solid ${BRAND.border};">${escapeHtml(row.value)}</td>
          </tr>`
          )
          .join('')
        return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 8px;border:1px solid ${BRAND.border};border-radius:8px;overflow:hidden;background:#ffffff;">
          <tr>
            <td colspan="2" style="padding:10px 12px;background:${BRAND.bg};font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND.navy};">${escapeHtml(section.title)}</td>
          </tr>
          ${rows}
        </table>`
      })
      .join('') ?? ''

  const ctaHtml = content.cta
    ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
      <tr>
        <td style="border-radius:9999px;background:${BRAND.gold};">
          <a href="${escapeHtml(content.cta.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:700;color:${BRAND.navy};text-decoration:none;">${escapeHtml(content.cta.label)}</a>
        </td>
      </tr>
    </table>`
    : ''

  const footerHtml = content.footerNote
    ? `<p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:${BRAND.muted};">${escapeHtml(content.footerNote)}</p>`
    : `<p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:${BRAND.muted};">If you did not use Subizwa, you can safely ignore this message.</p>`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(content.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BRAND.border};box-shadow:0 4px 24px rgba(12,35,64,0.08);">
          <tr>
            <td style="background:${BRAND.navy};padding:20px 28px;border-bottom:4px solid ${BRAND.gold};">
              <p style="margin:0;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">Subizwa</p>
              <p style="margin:6px 0 0;font-size:11px;font-weight:600;color:${BRAND.gold};letter-spacing:0.12em;text-transform:uppercase;">Found documents recovery</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <p style="margin:0 0 8px;font-size:13px;color:${BRAND.muted};">Hello ${escapeHtml(name)},</p>
              <h1 style="margin:0 0 16px;font-size:20px;line-height:1.35;font-weight:700;color:${BRAND.navy};">${escapeHtml(content.headline)}</h1>
              ${bodyHtml}
              ${sectionsHtml}
              ${ctaHtml}
              ${footerHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px;background:${BRAND.bg};border-top:1px solid ${BRAND.border};">
              <p style="margin:0;font-size:11px;line-height:1.5;color:${BRAND.muted};text-align:center;">
                © ${new Date().getFullYear()} Subizwa · Rwanda National Police document recovery platform<br />
                <a href="${escapeHtml(appUrl)}" style="color:${BRAND.sky};text-decoration:none;">${escapeHtml(appUrl.replace(/^https?:\/\//, ''))}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject: content.subject, text, html }
}
