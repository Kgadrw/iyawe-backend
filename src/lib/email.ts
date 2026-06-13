import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

let transporter: Transporter | null = null
let verified = false

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim())
}

function getTransporter(): Transporter {
  if (!isEmailConfigured()) {
    throw new Error('SMTP is not configured (SMTP_USER and SMTP_PASS required)')
  }

  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587)
    const secure = process.env.SMTP_SECURE === 'true' || port === 465

    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure,
      auth: {
        user: process.env.SMTP_USER!.trim(),
        pass: process.env.SMTP_PASS!.trim(),
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    })
  }

  return transporter
}

/** Verify SMTP once at startup or first send — logs result, does not crash the server. */
export async function verifyEmailTransport(): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn('[email] SMTP not configured — outbound emails disabled')
    return false
  }
  if (verified) return true

  try {
    await getTransporter().verify()
    verified = true
    console.log('[email] SMTP connection verified')
    return true
  } catch (error) {
    console.error('[email] SMTP verification failed:', error)
    return false
  }
}

export type SendEmailOptions = {
  to: string
  subject: string
  text: string
  html: string
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  if (!isEmailConfigured()) {
    throw new Error('SMTP is not configured')
  }

  const from =
    process.env.SMTP_FROM?.trim() ||
    `Subizwa <${process.env.SMTP_USER!.trim()}>`

  const timeoutMs = Number(process.env.SMTP_TIMEOUT_MS || 15_000)

  const sendMail = getTransporter().sendMail({
    from,
    to: options.to.trim(),
    subject: options.subject,
    text: options.text,
    html: options.html,
  })

  await Promise.race([
    sendMail,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`SMTP send timed out after ${timeoutMs}ms`)), timeoutMs)
    }),
  ])
}
