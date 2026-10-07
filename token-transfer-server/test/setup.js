'use strict'

// Hermetic mail config. Loaded by mocha before any test file. Tests stub the
// mailer and do not send, and these values override any real credentials in
// the environment.
process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account'
process.env.CLOUDFLARE_EMAIL_API_TOKEN = 'test-token'
process.env.MAIL_FROM_EMAIL = 'test@test.com'
delete process.env.MAIL_FROM_NAME
if (!process.env.ENCRYPTION_SECRET) {
  process.env.ENCRYPTION_SECRET = 'test'
}
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'test'
}
