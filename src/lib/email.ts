import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

let transporter: Transporter | null = null

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS)
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
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    })
  }

  return transporter
}

export type SendEmailOptions = {
  to: string
  subject: string
  text: string
  html?: string
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const from =
    process.env.SMTP_FROM ||
    `Subizwa <${process.env.SMTP_USER}>`

  const timeoutMs = Number(process.env.SMTP_TIMEOUT_MS || 12_000)
  const sendMail = getTransporter().sendMail({
    from,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html ?? options.text.replace(/\n/g, '<br>'),
  })

  await Promise.race([
    sendMail,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`SMTP send timed out after ${timeoutMs}ms`)), timeoutMs)
    }),
  ])
}
