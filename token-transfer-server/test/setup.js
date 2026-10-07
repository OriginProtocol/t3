'use strict'

// Hermetic mail config. Loaded by mocha before any test file. Tests stub the
// mailer and do not send. Force SendGrid so a shell with MAIL_PROVIDER=cloudflare
// does not make startup validation demand Cloudflare credentials.
process.env.MAIL_PROVIDER = 'sendgrid'
if (!process.env.SENDGRID_FROM_EMAIL) {
  process.env.SENDGRID_FROM_EMAIL = 'test@test.com'
}
if (!process.env.SENDGRID_API_KEY) {
  process.env.SENDGRID_API_KEY = 'test'
}
if (!process.env.ENCRYPTION_SECRET) {
  process.env.ENCRYPTION_SECRET = 'test'
}
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'test'
}
