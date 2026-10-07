const chai = require('chai')
const expect = chai.expect
const sinon = require('sinon')

const mailer = require('../../src/lib/mailer')
const logger = require('../../src/logger')
const { User, sequelize } = require('../../src/models')
const { sendEmail, sendLoginTokenInBackground } = require('../../src/lib/email')

describe('email library', () => {
  beforeEach(async () => {
    expect(process.env.NODE_ENV).to.equal('test')
    await sequelize.sync({ force: true })
    this.user = await User.create({
      email: 'user@originprotocol.com',
      name: 'User 1',
      employee: false
    })
  })

  afterEach(() => {
    if (mailer.sendMail.restore) mailer.sendMail.restore()
    if (logger.error.restore) logger.error.restore()
  })

  const cases = [
    ['welcome', 'Welcome to the Origin Investor Portal'],
    ['login', 'Welcome to the Origin Investor Portal'],
    ['transfer', 'Confirm Your Origin Token Withdrawal'],
    ['lockup', 'Confirm Your Origin Token Lockup'],
    ['otc', 'New OTC Request']
  ]

  cases.forEach(([emailType, subject]) => {
    it(`sends a ${emailType} email through the mail layer`, async () => {
      const sendStub = sinon.stub(mailer, 'sendMail').resolves()
      await sendEmail('person@example.com', emailType, {
        url: 'https://example.com/dummy',
        employee: false,
        action: 'buy',
        amount: 250000,
        name: 'User 1',
        email: 'user@originprotocol.com',
        phone: '555'
      })
      expect(sendStub.calledOnce).to.equal(true)
      const message = sendStub.firstCall.args[0]
      expect(message.to).to.equal('person@example.com')
      expect(message.subject).to.equal(subject)
      expect(message.text).to.be.a('string')
      expect(message.text.length).to.be.above(0)
      expect(message.html).to.be.a('string')
      expect(message.html.length).to.be.above(0)
    })
  })

  it('logs a failed login email instead of rejecting', async () => {
    const sendStub = sinon
      .stub(mailer, 'sendMail')
      .rejects(new Error('smtp down'))
    const logStub = sinon.stub(logger, 'error')
    const unhandled = []
    const onUnhandled = reason => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      await sendLoginTokenInBackground(this.user.email)
      await new Promise(resolve => setImmediate(resolve))
      expect(sendStub.calledOnce).to.equal(true)
      expect(logStub.called).to.equal(true)
      expect(unhandled).to.have.length(0)
    } finally {
      process.removeListener('unhandledRejection', onUnhandled)
    }
  })
})
