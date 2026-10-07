'use strict'

/**
 * Send one real login email through the configured provider.
 *
 * Uses the same template and mail layer as production, with a dummy link
 * that is not a valid login token. Run it with the server's environment
 * (MAIL_PROVIDER and that provider's credentials) before flipping production.
 *
 *   node src/scripts/send_test_email.js recipient@example.com
 */

const { clientUrl } = require('../config')
const { sendEmail } = require('../lib/email')

async function main() {
  const to = process.argv[2]
  if (!to) {
    console.error('Usage: node src/scripts/send_test_email.js <recipient>')
    process.exit(1)
  }

  await sendEmail(to, 'login', {
    url: `${clientUrl}/login_handler/test-token`,
    employee: false
  })
  console.log(`Sent login test email to ${to}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
