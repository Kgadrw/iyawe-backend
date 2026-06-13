import dotenv from 'dotenv'
import { getEmailProvider, isEmailConfigured, sendEmail, verifyEmailTransport } from '../src/lib/email'
import { buildSubizwaEmail, getAppUrl } from '../src/lib/email-template'

dotenv.config()

async function main() {
  const to = process.argv[2] || process.env.ADMIN_ALERT_EMAIL || process.env.SMTP_USER
  if (!to) {
    console.error('Usage: npm run test:email -- your@email.com')
    process.exit(1)
  }

  if (!isEmailConfigured()) {
    console.error('Set RESEND_API_KEY (Render) or SMTP_USER/SMTP_PASS (local) in backend/.env')
    process.exit(1)
  }

  const provider = getEmailProvider()
  console.log(`Verifying ${provider} email transport…`)
  const verified = await verifyEmailTransport()
  if (!verified) {
    console.error('Email verification failed — check credentials')
    process.exit(1)
  }

  const { subject, text, html } = buildSubizwaEmail({
    subject: 'Subizwa — Email test',
    preheader: 'Your Subizwa email configuration is working.',
    recipientName: 'Team',
    headline: 'Email delivery is working',
    bodyParagraphs: [
      'This is a test message from the Subizwa backend.',
      `Provider: ${provider}. If you received this email, claim notifications will be sent.`,
    ],
    sections: [
      {
        title: 'Configuration',
        rows: [
          { label: 'App URL', value: getAppUrl() },
          { label: 'Provider', value: provider ?? 'none' },
        ],
      },
    ],
    cta: { label: 'Open Subizwa', url: getAppUrl() },
    footerNote: 'This is an automated test email from Subizwa.',
  })

  console.log(`Sending test email to ${to}…`)
  await sendEmail({ to, subject, text, html })
  console.log('✓ Test email sent successfully')
}

main().catch((error) => {
  console.error('Test email failed:', error)
  process.exit(1)
})
