import dotenv from 'dotenv'
import { isEmailConfigured, sendEmail, verifyEmailTransport } from '../src/lib/email'
import { buildSubizwaEmail, getAppUrl } from '../src/lib/email-template'

dotenv.config()

async function main() {
  const to = process.argv[2] || process.env.SMTP_USER
  if (!to) {
    console.error('Usage: npm run test:email -- your@email.com')
    process.exit(1)
  }

  if (!isEmailConfigured()) {
    console.error('Set SMTP_USER and SMTP_PASS in backend/.env first')
    process.exit(1)
  }

  console.log('Verifying SMTP connection…')
  const verified = await verifyEmailTransport()
  if (!verified) {
    console.error('SMTP verification failed — check credentials and network')
    process.exit(1)
  }

  const { subject, text, html } = buildSubizwaEmail({
    subject: 'Subizwa — Email test',
    preheader: 'Your Subizwa email configuration is working.',
    recipientName: 'Team',
    headline: 'Email delivery is working',
    bodyParagraphs: [
      'This is a test message from the Subizwa backend.',
      'If you received this email, SMTP is configured correctly and claim notifications will be sent.',
    ],
    sections: [
      {
        title: 'Configuration',
        rows: [
          { label: 'App URL', value: getAppUrl() },
          { label: 'SMTP host', value: process.env.SMTP_HOST || 'smtp.gmail.com' },
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
