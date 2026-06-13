import type { SendEmailOptions } from './email'

const RESEND_API = 'https://api.resend.com/emails'

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim())
}

export function getResendFromAddress(): string {
  return (
    process.env.RESEND_FROM?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    'Subizwa <onboarding@resend.dev>'
  )
}

/** Resend uses HTTPS — works on Render where SMTP ports are blocked. */
export async function sendEmailViaResend(options: SendEmailOptions): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured')
  }

  const timeoutMs = Number(process.env.EMAIL_TIMEOUT_MS || 15_000)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(RESEND_API, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: getResendFromAddress(),
        to: [options.to.trim()],
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
    })

    const data = (await response.json().catch(() => ({}))) as {
      message?: string
      id?: string
    }

    if (!response.ok) {
      throw new Error(data.message || `Resend API error (${response.status})`)
    }

    console.log('[email] Sent via Resend', data.id ? `(id: ${data.id})` : '')
  } finally {
    clearTimeout(timer)
  }
}

export async function verifyResendTransport(): Promise<boolean> {
  if (!isResendConfigured()) return false
  console.log('[email] Resend API configured (HTTPS — Render compatible)')
  return true
}
