const chai = require('chai')
const expect = chai.expect
const http = require('http')
const sinon = require('sinon')

const mailer = require('../../src/lib/mailer')
const {
  cloudflareAccountId,
  cloudflareEmailApiToken,
  mailFromEmail
} = require('../../src/config')

describe('mailer', () => {
  describe('buildFromAddress', () => {
    it('sends a bare address when no display name is configured', () => {
      expect(mailer.buildFromAddress('welcome@yourdomain.com', '')).to.equal(
        'welcome@yourdomain.com'
      )
    })

    it('uses MAIL_FROM_NAME as the display name', () => {
      expect(
        mailer.buildFromAddress('welcome@yourdomain.com', 'Origin')
      ).to.deep.equal({
        address: 'welcome@yourdomain.com',
        name: 'Origin'
      })
    })

    it('parses a display name embedded in the from address', () => {
      expect(
        mailer.buildFromAddress(
          'Origin Protocol <support@shoporigin.com>',
          ''
        )
      ).to.deep.equal({
        address: 'support@shoporigin.com',
        name: 'Origin Protocol'
      })
    })

    it('lets MAIL_FROM_NAME override an embedded display name', () => {
      expect(
        mailer.buildFromAddress(
          '"Origin Protocol" <support@shoporigin.com>',
          'Origin'
        )
      ).to.deep.equal({
        address: 'support@shoporigin.com',
        name: 'Origin'
      })
    })
  })

  describe('interpretCloudflareResponse', () => {
    const recipient = 'user@example.com'

    function body(result, success = true) {
      return { success, errors: [], messages: [], result }
    }

    it('accepts a delivered recipient', () => {
      expect(() =>
        mailer.interpretCloudflareResponse(
          200,
          body({
            delivered: [recipient],
            permanent_bounces: [],
            queued: []
          }),
          recipient
        )
      ).to.not.throw()
    })

    it('accepts a queued recipient', () => {
      expect(() =>
        mailer.interpretCloudflareResponse(
          200,
          body({
            delivered: [],
            permanent_bounces: [],
            queued: [recipient]
          }),
          recipient
        )
      ).to.not.throw()
    })

    it('rejects success:false', () => {
      expect(() =>
        mailer.interpretCloudflareResponse(
          400,
          {
            success: false,
            errors: [
              {
                code: 10001,
                message: 'email.sending.error.invalid_request_schema'
              }
            ],
            result: null
          },
          recipient
        )
      ).to.throw(/10001 email.sending.error.invalid_request_schema/)
    })

    it('rejects a permanent bounce', () => {
      expect(() =>
        mailer.interpretCloudflareResponse(
          200,
          body({
            delivered: [],
            permanent_bounces: [recipient],
            queued: []
          }),
          recipient
        )
      ).to.throw(/permanently bounced/)
    })

    it('rejects a suppressed recipient', () => {
      expect(() =>
        mailer.interpretCloudflareResponse(
          200,
          body({
            delivered: [],
            permanent_bounces: [],
            queued: [],
            suppressed_recipients: [recipient]
          }),
          recipient
        )
      ).to.throw(/suppressed/)
    })

    it('rejects a success response that did not accept the recipient', () => {
      expect(() =>
        mailer.interpretCloudflareResponse(
          200,
          body({
            delivered: [],
            permanent_bounces: [],
            queued: []
          }),
          recipient
        )
      ).to.throw(/not delivered or queued/)
    })
  })

  describe('Cloudflare HTTP', () => {
    let server
    let port

    beforeEach(done => {
      server = http.createServer((req, res) => {
        const chunks = []
        req.on('data', chunk => chunks.push(chunk))
        req.on('end', () => {
          server.lastRequest = {
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
          }
          const status = server.nextStatus || 200
          const payload = server.nextBody || {
            success: true,
            errors: [],
            result: {
              delivered: ['user@example.com'],
              permanent_bounces: [],
              queued: []
            }
          }
          res.writeHead(status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(payload))
        })
      })
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port
        done()
      })
    })

    afterEach(done => {
      server.close(done)
    })

    it('posts the Email Sending payload and accepts delivery', async () => {
      const response = await mailer.postJson(
        `http://127.0.0.1:${port}/client/v4/accounts/acct/email/sending/send`,
        {
          headers: { Authorization: 'Bearer token' },
          body: {
            to: 'user@example.com',
            from: { address: 'welcome@yourdomain.com', name: 'Origin' },
            subject: 'Welcome to the Origin Investor Portal',
            text: 'hello',
            html: '<p>hello</p>'
          }
        }
      )

      expect(server.lastRequest.method).to.equal('POST')
      expect(server.lastRequest.url).to.equal(
        '/client/v4/accounts/acct/email/sending/send'
      )
      expect(server.lastRequest.headers.authorization).to.equal('Bearer token')
      expect(server.lastRequest.body.from).to.deep.equal({
        address: 'welcome@yourdomain.com',
        name: 'Origin'
      })
      mailer.interpretCloudflareResponse(
        response.statusCode,
        response.body,
        'user@example.com'
      )
    })

    it('surfaces an HTTP error body as a failed send', async () => {
      server.nextStatus = 401
      server.nextBody = {
        success: false,
        errors: [
          {
            code: 10101,
            message: 'email.sending.error.authentication.unauthorized'
          }
        ],
        result: null
      }
      const response = await mailer.postJson(
        `http://127.0.0.1:${port}/client/v4/accounts/acct/email/sending/send`,
        {
          headers: { Authorization: 'Bearer token' },
          body: {
            to: 'user@example.com',
            from: 'a@b.c',
            subject: 's',
            text: 't'
          }
        }
      )
      expect(() =>
        mailer.interpretCloudflareResponse(
          response.statusCode,
          response.body,
          'user@example.com'
        )
      ).to.throw(/10101/)
    })
  })

  describe('sendViaCloudflare', () => {
    afterEach(() => {
      if (mailer.postJson.restore) mailer.postJson.restore()
    })

    it('posts to the Email Sending endpoint with a bearer token', async () => {
      const postStub = sinon.stub(mailer, 'postJson').resolves({
        statusCode: 200,
        body: {
          success: true,
          errors: [],
          result: {
            delivered: ['user@example.com'],
            permanent_bounces: [],
            queued: []
          }
        }
      })

      await mailer.sendViaCloudflare({
        to: 'user@example.com',
        from: { address: 'welcome@yourdomain.com', name: 'Origin' },
        subject: 'Hello',
        text: 'text',
        html: '<p>html</p>'
      })

      expect(postStub.calledOnce).to.equal(true)
      const [url, options] = postStub.firstCall.args
      expect(url).to.equal(mailer.cloudflareSendUrl(cloudflareAccountId))
      expect(url).to.include('/client/v4/accounts/')
      expect(url).to.include('/email/sending/send')
      expect(options.headers.Authorization).to.equal(
        `Bearer ${cloudflareEmailApiToken}`
      )
      expect(options.body).to.deep.equal({
        to: 'user@example.com',
        from: { address: 'welcome@yourdomain.com', name: 'Origin' },
        subject: 'Hello',
        text: 'text',
        html: '<p>html</p>'
      })
    })

    it('rejects when Cloudflare reports success:false', async () => {
      sinon.stub(mailer, 'postJson').resolves({
        statusCode: 200,
        body: {
          success: false,
          errors: [
            { code: 10002, message: 'email.sending.error.internal_server' }
          ],
          result: null
        }
      })

      let caught
      try {
        await mailer.sendViaCloudflare({
          to: 'user@example.com',
          from: 'welcome@yourdomain.com',
          subject: 'Hello',
          text: 'text',
          html: '<p>html</p>'
        })
      } catch (err) {
        caught = err
      }
      expect(caught).to.be.an('error')
      expect(caught.message).to.match(/10002/)
    })
  })

  describe('sendMail', () => {
    afterEach(() => {
      if (mailer.postJson.restore) mailer.postJson.restore()
    })

    it('sends through Cloudflare Email Sending', async () => {
      const postStub = sinon.stub(mailer, 'postJson').resolves({
        statusCode: 200,
        body: {
          success: true,
          errors: [],
          result: {
            delivered: ['user@example.com'],
            permanent_bounces: [],
            queued: []
          }
        }
      })
      await mailer.sendMail({
        to: 'user@example.com',
        subject: 'Hello',
        text: 'text',
        html: '<p>html</p>'
      })
      expect(postStub.calledOnce).to.equal(true)
      const [url, options] = postStub.firstCall.args
      expect(url).to.equal(mailer.cloudflareSendUrl(cloudflareAccountId))
      expect(options.headers.Authorization).to.equal(
        `Bearer ${cloudflareEmailApiToken}`
      )
      expect(options.body.to).to.equal('user@example.com')
      expect(options.body.subject).to.equal('Hello')
      expect(options.body.text).to.equal('text')
      expect(options.body.html).to.equal('<p>html</p>')
      expect(options.body.from).to.equal(mailFromEmail)
    })
  })
})
