const BigNumber = require('bignumber.js')
const chai = require('chai')
chai.use(require('chai-as-promised'))
chai.use(require('chai-bignumber')(BigNumber))
chai.use(require('chai-moment'))
const expect = chai.expect
const moment = require('moment')
const sinon = require('sinon')
const sendgridMail = require('@sendgrid/mail')

const enums = require('../../src/enums')
const {
  addTransfer,
  confirmTransfer,
  executeTransfer,
} = require('../../src/lib/transfer')
const { Grant, Transfer, User, sequelize } = require('../../src/models')
const { transferConfirmationTimeout } = require('../../src/config')

const toAddress = '0xf17f52151ebef6c7334fad080c5704d77216b732'

describe('Token transfer library', () => {
  beforeEach(async () => {
    expect(process.env.NODE_ENV).to.equal('test')
    // Wipe database before each test
    await sequelize.sync({ force: true })

    this.user = await User.create({
      email: 'user@originprotocol.com',
      name: 'User 1',
      otpKey: '123',
      otpVerified: true,
    })

    this.grant = await Grant.create({
      userId: this.user.id,
      start: new Date('2014-10-10'),
      end: new Date('2018-10-10'),
      cliff: new Date('2015-10-10'),
      currency: 'OGN',
      amount: 100000,
    })
  })

  it('should add a transfer', async () => {
    const sendStub = sinon.stub(sendgridMail, 'send')

    const amount = 1000
    const transfer = await addTransfer(this.user.id, toAddress, amount, 'OGN')

    // Check a transfer row was created and populated as expected.
    expect(transfer).to.be.an('object')
    expect(transfer.userId).to.equal(this.user.id)
    expect(transfer.toAddress).to.equal(toAddress.toLowerCase())
    expect(transfer.fromAddress).to.be.null
    expect(parseInt(transfer.amount)).to.equal(amount)
    expect(transfer.currency).to.equal('OGN')
    expect(transfer.txHash).to.be.null
    expect(transfer.data).to.be.an('object')

    // Check an email was sent with the confirmation token
    expect(sendStub.called).to.equal(true)
    sendStub.restore()
  })

  it('should add a transfer where required amount spans multiple grants', async () => {
    const sendStub = sinon.stub(sendgridMail, 'send')

    const currency = 'OGN'

    await Grant.create({
      userId: this.user.id,
      start: new Date('2014-10-10'),
      end: new Date('2018-10-10'),
      cliff: new Date('2015-10-10'),
      currency,
      amount: 1,
    })
    const amount = 100001
    const transfer = await addTransfer(
      this.user.id,
      toAddress,
      amount,
      currency
    )
    // Check a transfer row was created and populated as expected.
    expect(transfer).to.be.an('object')
    expect(transfer.userId).to.equal(this.user.id)
    expect(transfer.toAddress).to.equal(toAddress.toLowerCase())
    expect(transfer.fromAddress).to.be.null
    expect(parseInt(transfer.amount)).to.equal(amount)
    expect(transfer.currency).to.equal(currency)
    expect(transfer.txHash).to.be.null
    expect(transfer.data).to.be.an('object')

    // Check an email was sent with the confirmation token
    expect(sendStub.called).to.equal(true)
    sendStub.restore()
  })

  it('should add ignoring failed transfer amounts', async () => {
    const sendStub = sinon.stub(sendgridMail, 'send')

    const currency = 'OGN'

    await Transfer.create({
      userId: this.user.id,
      status: enums.TransferStatuses.Failed,
      toAddress: toAddress,
      amount: 2,
      currency,
    })

    const amount = 99999
    await addTransfer(this.user.id, toAddress, amount, currency)

    // Check an email was sent with the confirmation token
    expect(sendStub.called).to.equal(true)
    sendStub.restore()
  })

  it('should add ignoring cancelled transfer amounts', async () => {
    const sendStub = sinon.stub(sendgridMail, 'send')

    const currency = 'OGN'

    await Transfer.create({
      userId: this.user.id,
      status: enums.TransferStatuses.Cancelled,
      toAddress: toAddress,
      amount: 2,
      currency,
    })

    const amount = 99999
    await addTransfer(this.user.id, toAddress, amount, currency)

    // Check an email was sent with the confirmation token
    expect(sendStub.called).to.equal(true)
    sendStub.restore()
  })

  it('should add ignoring expired transfer amounts', async () => {
    const sendStub = sinon.stub(sendgridMail, 'send')

    const currency = 'OGN'

    await Transfer.create({
      userId: this.user.id,
      status: enums.TransferStatuses.Expired,
      toAddress: toAddress,
      amount: 2,
      currency,
    })

    const amount = 99999
    await addTransfer(this.user.id, toAddress, amount, currency)

    // Check an email was sent with the confirmation token
    expect(sendStub.called).to.equal(true)
    sendStub.restore()
  })

  it('should add ignoring transfers waiting for email confirmation that have expired tokens', async () => {
    const sendStub = sinon.stub(sendgridMail, 'send')

    const currency = 'OGN'

    await Transfer.create({
      userId: this.user.id,
      status: enums.TransferStatuses.WaitingEmailConfirm,
      toAddress: toAddress,
      amount: 2,
      currency,
    })

    // Go forward in time to expire the transfer
    const clock = sinon.useFakeTimers(
      moment.utc().add(transferConfirmationTimeout, 'm').valueOf()
    )

    const amount = 99999
    await addTransfer(this.user.id, toAddress, amount, currency)

    // Check an email was sent with the confirmation token
    expect(sendStub.called).to.equal(true)
    sendStub.restore()

    clock.restore()
  })

  it('should not add a transfer if not enough tokens (vested)', async () => {
    const amount = 100001
    await expect(
      addTransfer(this.user.id, toAddress, amount, 'OGN')
    ).to.eventually.be.rejectedWith(/exceeds/)
  })

  it('should not add a transfer if not enough tokens (vested minus waiting email confirmation)', async () => {
    const currency = 'OGN'

    await Transfer.create({
      userId: this.user.id,
      status: enums.TransferStatuses.WaitingEmailConfirm,
      toAddress: toAddress,
      amount: 2,
      currency,
    })

    const amount = 99999
    await expect(
      addTransfer(this.user.id, toAddress, amount, currency)
    ).to.eventually.be.rejectedWith(/exceeds/)
  })

  it('should not add a transfer if not enough tokens (vested minus enqueued)', async () => {
    const currency = 'OGN'

    await Transfer.create({
      userId: this.user.id,
      status: enums.TransferStatuses.Enqueued,
      toAddress: toAddress,
      amount: 2,
      currency,
    })

    const amount = 99999
    await expect(
      addTransfer(this.user.id, toAddress, amount, currency)
    ).to.eventually.be.rejectedWith(/exceeds/)
  })

  it('should not add a transfer if not enough tokens (vested minus paused)', async () => {
    const currency = 'OGN'

    await Transfer.create({
      userId: this.user.id,
      status: enums.TransferStatuses.Paused,
      toAddress: toAddress,
      amount: 2,
      currency,
    })

    const amount = 99999
    await expect(
      addTransfer(this.user.id, toAddress, amount, currency)
    ).to.eventually.be.rejectedWith(/exceeds/)
  })

  it('should not add a transfer if not enough tokens (vested minus waiting confirmation)', async () => {
    const currency = 'OGN'

    await Transfer.create({
      userId: this.user.id,
      status: enums.TransferStatuses.WaitingConfirmation,
      toAddress: toAddress,
      amount: 2,
      currency,
    })

    const amount = 99999
    await expect(
      addTransfer(this.user.id, toAddress, amount, currency)
    ).to.eventually.be.rejectedWith(/exceeds/)
  })

  it('should not add a transfer if not enough tokens (vested minus success)', async () => {
    const currency = 'OGN'

    await Transfer.create({
      userId: this.user.id,
      status: enums.TransferStatuses.Success,
      toAddress: toAddress,
      amount: 2,
      currency,
    })

    const amount = 99999
    await expect(
      addTransfer(this.user.id, toAddress, amount, currency)
    ).to.eventually.be.rejectedWith(/exceeds/)
  })

  it('should not add a transfer if not enough tokens (multiple states)', async () => {
    const currency = 'OGN'

    const promises = [
      enums.TransferStatuses.WaitingEmailConfirm,
      enums.TransferStatuses.Enqueued,
      enums.TransferStatuses.Paused,
      enums.TransferStatuses.WaitingConfirmation,
      enums.TransferStatuses.Success,
    ].map((status) => {
      return Transfer.create({
        userId: this.user.id,
        status: status,
        toAddress: toAddress,
        amount: 2,
        currency,
      })
    })

    await Promise.all(promises)

    const amount = 99991
    await expect(
      addTransfer(this.user.id, toAddress, amount, currency)
    ).to.eventually.be.rejectedWith(/exceeds/)
  })

  it('should execute a transfer', async () => {
    // Stub SendGrid so it doesn't return an error
    const sendStub = sinon.stub(sendgridMail, 'send')

    // Enqueue and execute a transfer
    const amount = 1000
    const currency = 'OGN'
    const transfer = await addTransfer(
      this.user.id,
      toAddress,
      amount,
      currency
    )
    const txHash = await executeTransfer(transfer)
    expect(txHash).to.equal('0x0')

    // Check the transfer row was updated as expected.
    transfer.reload()
    expect(transfer.status).to.equal(enums.TransferStatuses.WaitingConfirmation)

    sendStub.restore()
  })

  it('should confirm a transfer', async () => {
    const currency = 'OGN'

    const transfer = await Transfer.create({
      userId: this.user.id,
      status: enums.TransferStatuses.WaitingEmailConfirm,
      toAddress: toAddress,
      amount: 2,
      currency,
    })

    await confirmTransfer(transfer, this.user)
    expect(transfer.status).to.equal(enums.TransferStatuses.Enqueued)
  })

  it('should not confirm a transfer in any state except waiting for email confirmation', async () => {
    const currency = 'OGN'

    const transfers = await Promise.all(
      [
        enums.TransferStatuses.Enqueued,
        enums.TransferStatuses.Paused,
        enums.TransferStatuses.WaitingConfirmation,
        enums.TransferStatuses.Success,
        enums.TransferStatuses.Failed,
        enums.TransferStatuses.Cancelled,
        enums.TransferStatuses.Expired,
      ].map((status) => {
        return Transfer.create({
          userId: this.user.id,
          status: status,
          toAddress: toAddress,
          amount: 2,
          currency,
        })
      })
    )

    await Promise.all(
      transfers.map(async (transfer) => {
        await expect(confirmTransfer(transfer)).to.eventually.be.rejectedWith(
          /is not waiting for confirmation/
        )
      })
    )
  })

  it('should not confirm a transfer that passed the timeout', async () => {
    const currency = 'OGN'

    const transfer = await Transfer.create({
      userId: this.user.id,
      status: enums.TransferStatuses.WaitingEmailConfirm,
      toAddress: toAddress,
      amount: 1,
      currency,
      createdAt: moment().subtract(10, 'minutes'),
    })
    await expect(
      confirmTransfer(transfer, this.user)
    ).to.eventually.be.rejectedWith(/required time/)
  })
})
