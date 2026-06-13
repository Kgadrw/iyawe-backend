import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import {
  isResendConfigured,
  sendEmailViaResend,
  verifyResendTransport,
} from './email-resend'

let transporter: Transporter | null = null
let smtpVerified = false
let activeProvider: 'resend' | 'smtp' | null = null

/** Render (and similar hosts) block outbound SMTP — use Resend HTTPS API instead. */
function isRenderHosted(): boolean {
  return Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID)
}

function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim())
}

export function getEmailProvider(): 'resend' | 'smtp' | null {
  if (isResendConfigured()) return 'resend'
  if (isRenderHosted()) return null
  if (isSmtpConfigured()) return 'smtp'
  return null
}

/** True when Resend API or SMTP credentials are set. */
export function isEmailConfigured(): boolean {
  return getEmailProvider() !== null
}

function getTransporter(): Transporter {
  if (!isSmtpConfigured()) {
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

async function verifySmtpTransport(): Promise<boolean> {
  if (!isSmtpConfigured()) return false
  if (smtpVerified) return true

  try {
    await getTransporter().verify()
    smtpVerified = true
    console.log('[email] SMTP connection verified')
    return true
  } catch (error) {
    console.error('[email] SMTP verification failed (local dev only):', error)
    return false
  }
}

/** Verify email transport at startup — prefers Resend on cloud hosts. */
export async function verifyEmailTransport(): Promise<boolean> {
  if (isRenderHosted() && !isResendConfigured()) {
    console.warn(
      '[email] Render blocks Gmail/SMTP. Add RESEND_API_KEY and RESEND_FROM in Render env vars to enable claim emails.'
    )
    return false
  }

  if (!isEmailConfigured()) {
    console.warn('[email] No email provider configured — outbound emails disabled')
    console.warn('[email] Set RESEND_API_KEY (Render) or SMTP_USER/SMTP_PASS (local dev)')
    return false
  }

  const provider = getEmailProvider()!
  activeProvider = provider

  if (provider === 'resend') {
    return verifyResendTransport()
  }

  return verifySmtpTransport()
}

export type SendEmailOptions = {
  to: string
  subject: string
  text: string
  html: string
}

async function sendEmailViaSmtp(options: SendEmailOptions): Promise<void> {
  const from =
    process.env.SMTP_FROM?.trim() ||
    `Subizwa <${process.env.SMTP_USER!.trim()}>`

  const timeoutMs = Number(process.env.EMAIL_TIMEOUT_MS || process.env.SMTP_TIMEOUT_MS || 15_000)

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

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const provider = activeProvider ?? getEmailProvider()
  if (!provider) {
    throw new Error('Email is not configured')
  }

  if (provider === 'resend') {
    await sendEmailViaResend(options)
    return
  }

  await sendEmailViaSmtp(options)
}
