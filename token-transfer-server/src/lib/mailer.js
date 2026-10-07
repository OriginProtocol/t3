'use strict'

const http = require('http')
const https = require('https')
const { URL } = require('url')

const {
  mailFromEmail,
  mailFromName,
  cloudflareAccountId,
  cloudflareEmailApiToken
} = require('../config')

// Cloudflare's Node SDK requires Node 18+. This server runs on Node 16, so
// Email Sending is called over HTTP with the built-in client.
const CLOUDFLARE_API_ORIGIN = 'https://api.cloudflare.com'
const CLOUDFLARE_SEND_TIMEOUT_MS = 20000

/**
 * Split "Name <addr@host>" into parts. A bare address is returned with an
 * empty name. MAIL_FROM_NAME overrides an embedded display name.
 */
function parseFrom(raw) {
  const trimmed = (raw || '').trim()
  if (!trimmed) {
    return { address: '', name: '' }
  }
  const match = trimmed.match(/^(.*)<([^>]+)>\s*$/)
  if (!match) {
    return { address: trimmed, name: '' }
  }
  let name = match[1].trim()
  if (
    (name.startsWith('"') && name.endsWith('"')) ||
    (name.startsWith("'") && name.endsWith("'"))
  ) {
    name = name.slice(1, -1).trim()
  }
  return { address: match[2].trim(), name }
}

/**
 * Cloudflare `from`: a bare address, or {address, name} when a display name
 * is set via MAIL_FROM_NAME or embedded in MAIL_FROM_EMAIL.
 */
function buildFromAddress(fromEmail, fromName) {
  const parsed = parseFrom(fromEmail)
  const name = (fromName || '').trim() || parsed.name
  if (!parsed.address) {
    throw new Error('Missing from address')
  }
  if (!name) {
    return parsed.address
  }
  return { address: parsed.address, name }
}

function formatCloudflareErrors(body) {
  if (!body || typeof body !== 'object') {
    return 'empty response'
  }
  const errors = Array.isArray(body.errors) ? body.errors : []
  if (!errors.length) {
    if (typeof body.raw === 'string' && body.raw) {
      return body.raw.slice(0, 500)
    }
    return 'request rejected'
  }
  return errors
    .map(error => {
      if (!error) return ''
      if (error.code && error.message) return `${error.code} ${error.message}`
      return error.message || String(error.code || '')
    })
    .filter(Boolean)
    .join('; ')
}

function listHasAddress(list, address) {
  const target = address.toLowerCase()
  return (list || []).some(item => String(item).toLowerCase() === target)
}

/**
 * Treat success:false, a permanent bounce, a suppression, or a recipient
 * that was neither delivered nor queued as a failed send. Queued delivery
 * is success: Cloudflare accepted the message and will retry it.
 */
function interpretCloudflareResponse(statusCode, body, recipient) {
  const payload = body && typeof body === 'object' ? body : {}
  if (statusCode < 200 || statusCode >= 300 || payload.success !== true) {
    throw new Error(
      `Cloudflare email send failed (${statusCode}): ${formatCloudflareErrors(
        payload
      )}`
    )
  }

  const result = payload.result || {}
  const address = String(recipient || '').toLowerCase()
  if (listHasAddress(result.permanent_bounces, address)) {
    throw new Error(`Cloudflare email permanently bounced for ${address}`)
  }
  if (listHasAddress(result.suppressed_recipients, address)) {
    throw new Error(`Cloudflare email suppressed for ${address}`)
  }
  const accepted =
    listHasAddress(result.delivered, address) ||
    listHasAddress(result.queued, address)
  if (!accepted) {
    throw new Error(
      `Cloudflare email was not delivered or queued for ${address}`
    )
  }
}

function cloudflareSendUrl(accountId) {
  return `${CLOUDFLARE_API_ORIGIN}/client/v4/accounts/${encodeURIComponent(
    accountId
  )}/email/sending/send`
}

function postJson(urlString, { headers, body, timeoutMs }) {
  const url = new URL(urlString)
  const payload = Buffer.from(JSON.stringify(body))
  const client = url.protocol === 'http:' ? http : https
  const options = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'http:' ? 80 : 443),
    path: `${url.pathname}${url.search}`,
    method: 'POST',
    headers: Object.assign({}, headers, {
      'Content-Type': 'application/json',
      'Content-Length': payload.length
    })
  }

  return new Promise((resolve, reject) => {
    const req = client.request(options, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let parsed = null
        if (raw) {
          try {
            parsed = JSON.parse(raw)
          } catch (err) {
            parsed = { raw }
          }
        }
        resolve({ statusCode: res.statusCode, body: parsed })
      })
    })
    req.setTimeout(timeoutMs || CLOUDFLARE_SEND_TIMEOUT_MS, () => {
      req.destroy(new Error('Cloudflare email send timed out'))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function sendViaCloudflare({ to, from, subject, text, html }) {
  const url = cloudflareSendUrl(cloudflareAccountId)
  let response
  try {
    // Call through module.exports so tests can stub the HTTP helper.
    response = await module.exports.postJson(url, {
      headers: {
        Authorization: `Bearer ${cloudflareEmailApiToken}`
      },
      body: { to, from, subject, text, html }
    })
  } catch (err) {
    throw new Error(`Cloudflare email send failed: ${err.message}`)
  }
  interpretCloudflareResponse(response.statusCode, response.body, to)
}

async function sendMail({ to, subject, text, html }) {
  const from = buildFromAddress(mailFromEmail, mailFromName)
  await sendViaCloudflare({ to, from, subject, text, html })
}

module.exports = {
  sendMail,
  sendViaCloudflare,
  buildFromAddress,
  interpretCloudflareResponse,
  postJson,
  cloudflareSendUrl
}
