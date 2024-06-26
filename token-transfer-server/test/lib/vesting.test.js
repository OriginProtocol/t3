const BigNumber = require('bignumber.js')
const chai = require('chai')
chai.use(require('chai-moment'))
chai.use(require('chai-bignumber')(BigNumber))
const expect = chai.expect
const moment = require('moment')
const sinon = require('sinon')

const { Grant, User, sequelize } = require('../../src/models')
const {
  momentizeGrant,
  vestedAmount,
  vestingSchedule,
} = require('../../src/lib/vesting')
const { getNextVest } = require('../../src/shared')

// Sets up clean database
async function setupDatabase() {
  expect(process.env.NODE_ENV).to.equal('test')
  await sequelize.sync({ force: true })
}

describe('Utility functions', () => {
  beforeEach(async () => {
    await setupDatabase()
    this.user = await User.create({
      email: 'user+employee@originprotocol.com',
      otpKey: '123',
      otpVerified: true,
    })
    this.grants = [
      await Grant.create({
        userId: this.user.id,
        start: moment.utc(),
        end: moment.utc().add(2, 'years'),
        currency: 'OGN',
        amount: 10000,
      }),
    ]
  })

  it('should get next vest', () => {
    const nextVest = getNextVest(
      this.grants.map((g) => g.get({ plain: true })),
      this.user
    )

    expect(nextVest.amount).to.be.bignumber.equal(1175)
    expect(nextVest.vested).to.be.equal(false)
    expect(nextVest.grantId).to.be.equal(this.grants[0].id)
  })

  it('should get next vest with multiple vests on the same day', async () => {
    // Add another grant the same as the existing one
    this.grants.push(
      await Grant.create({
        userId: this.user.id,
        start: moment.utc(),
        end: moment.utc().add(2, 'years'),
        currency: 'OGN',
        amount: 10000,
      })
    )

    const nextVest = getNextVest(
      this.grants.map((g) => g.get({ plain: true })),
      this.user
    )

    expect(nextVest.amount).to.be.bignumber.equal(1175 * 2)
    expect(nextVest.vested).to.be.equal(false)
    expect(nextVest.grantId).to.deep.equal([
      this.grants[0].id,
      this.grants[1].id,
    ])
  })
})

describe('Employee vesting', () => {
  describe('4 year grant with 1 year cliff', () => {
    let grant

    beforeEach(async () => {
      await setupDatabase()
      this.user = await User.create({
        email: 'user+employee@originprotocol.com',
        otpKey: '123',
        otpVerified: true,
        employee: true,
      })
      grant = new Grant({
        userId: this.user.id,
        start: '2014-01-01 00:00:00',
        end: '2018-01-01 00:00:00',
        cliff: '2015-01-01 00:00:00',
        amount: 4800,
      })
      await grant.save()
    })

    it('should not vest before cliff', () => {
      const clock = sinon.useFakeTimers(
        moment.utc(grant.cliff).subtract(1, 's').valueOf()
      )
      const amount = vestedAmount(this.user, momentizeGrant(grant))
      expect(amount).to.be.bignumber.equal(0)
      clock.restore()
    })

    it('should vest 12/48 at the cliff', () => {
      const clock = sinon.useFakeTimers(moment(grant.cliff).valueOf())
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(
        BigNumber(grant.amount).times(12).div(48)
      )
      clock.restore()
    })

    it('should vest 12/48 after the cliff', () => {
      const clock = sinon.useFakeTimers(
        moment(grant.cliff).add(1, 's').valueOf()
      )
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(
        BigNumber(grant.amount).times(12).div(48)
      )
      clock.restore()
    })

    it('should have vested the correct total at grant end', async () => {
      const clock = sinon.useFakeTimers(moment(grant.end).valueOf())
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(grant.amount)
      clock.restore()
    })

    it('should vest the 1/48 each month', () => {
      const clock = sinon.useFakeTimers(moment.utc(grant.end))
      const schedule = vestingSchedule(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      // Remove the first element of the array, which is the cliff vest
      schedule.shift()
      // Remove the last element in the array, which has any rounding errors
      // All subsequent vesting events should vest the correct proportion
      schedule.every((e) =>
        expect(e.amount).to.be.bignumber.equal(BigNumber(grant.amount).div(48))
      )
      clock.restore()
    })

    it('should not vest anything if cancelled before cliff', async () => {
      await grant.update({
        cancelled: moment.utc(grant.cliff).subtract(1, 'second'),
      })
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(0)
    })

    it('should vest 13/48 if cancelled one month after cliff', async () => {
      await grant.update({
        cancelled: moment.utc(grant.cliff).add(1, 'month'),
      })
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(
        BigNumber(grant.amount).times(13).div(48)
      )
    })
  })

  describe('4 year grant with 1 year cliff and rounding', () => {
    let grant

    beforeEach(async () => {
      await setupDatabase()
      this.user = await User.create({
        email: 'user+employee@originprotocol.com',
        otpKey: '123',
        otpVerified: true,
        employee: true,
      })
      grant = new Grant({
        userId: this.user.id,
        start: '2014-01-01 00:00:00',
        end: '2018-01-01 00:00:00',
        cliff: '2015-01-01 00:00:00',
        amount: 10000,
      })
      await grant.save()
    })

    it('should not vest before cliff', () => {
      const clock = sinon.useFakeTimers(
        moment.utc(grant.cliff).subtract(1, 's').valueOf()
      )
      const amount = vestedAmount(this.user, momentizeGrant(grant))
      expect(amount).to.be.bignumber.equal(0)
      clock.restore()
    })

    it('should vest 12/48 at the cliff', () => {
      const clock = sinon.useFakeTimers(moment(grant.cliff).valueOf())
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(
        BigNumber(grant.amount).times(12).div(48)
      )
      clock.restore()
    })

    it('should vest 12/48 rounded to floor after the cliff', () => {
      const clock = sinon.useFakeTimers(
        moment(grant.cliff).add(1, 's').valueOf()
      )
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(
        BigNumber(grant.amount)
          .times(12)
          .div(48)
          .integerValue(BigNumber.ROUND_FLOOR)
      )
      clock.restore()
    })

    it('should have vested the correct total at grant end', async () => {
      const clock = sinon.useFakeTimers(moment(grant.end).valueOf())
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(grant.amount)
      clock.restore()
    })

    it('should vest the 1/48 rounded to floor each month', () => {
      const clock = sinon.useFakeTimers(moment.utc(grant.end).valueOf())
      const schedule = vestingSchedule(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      // Remove the first element of the array, which is the cliff vest
      schedule.shift()
      // Remove the last element in the array, which has any rounding errors
      schedule.pop()
      // All subsequent vesting events should vest the correct proportion
      schedule.every((e) =>
        expect(e.amount).to.be.bignumber.equal(
          BigNumber(grant.amount).div(48).integerValue(BigNumber.ROUND_FLOOR)
        )
      )

      clock.restore()
    })

    it('should not vest anything if cancelled before cliff', async () => {
      await grant.update({
        cancelled: moment.utc(grant.cliff).subtract(1, 'second'),
      })
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(0)
    })

    it('should vest 13/48 rounded to floor if cancelled one month after cliff', async () => {
      await grant.update({
        cancelled: moment.utc(grant.cliff).add(1, 'month'),
      })
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(
        BigNumber(grant.amount)
          .times(12)
          .div(48)
          .plus(
            BigNumber(grant.amount).div(48).integerValue(BigNumber.ROUND_FLOOR)
          )
      )
    })
  })

  describe('vesting with no cliff', () => {
    let grant

    beforeEach(async () => {
      await setupDatabase()
      this.user = await User.create({
        email: 'user+employee@originprotocol.com',
        otpKey: '123',
        otpVerified: true,
        employee: true,
      })
      grant = new Grant({
        userId: this.user.id,
        start: '2022-05-05 00:00:00',
        end: '2024-05-05 00:00:00',
        cliff: '2022-05-05 00:00:00',
        amount: 24000,
      })
      await grant.save()
    })

    it('should vest even when there is no cliff', async () => {
      const clock = sinon.useFakeTimers(moment.utc('2023-05-05 00:00:00').valueOf())
      const schedule = vestingSchedule(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )

      // There should be exactly 24 vesting events 
      // and no cliff
      expect(schedule.length).to.equal(24)
      
      // All vesting events should vest the correct proportion
      schedule.every((e) =>
        expect(e.amount).to.be.bignumber.equal(BigNumber('1000'))
      )

      clock.restore()
    })
  })

  describe('Cancelled grant', () => {
    let grant1, grant2

    beforeEach(async () => {
      await setupDatabase()
      this.user = await User.create({
        email: 'user+employee@originprotocol.com',
        otpKey: '123',
        otpVerified: true,
        employee: true,
      })
      // 4 years vesting, 1 year cliff, cancelled after 2 years in.
      grant1 = new Grant({
        userId: this.user.id,
        start: '2022-05-05 00:00:00',
        end: '2026-05-05 00:00:00',
        cliff: '2023-05-05 00:00:00',
        cancelled: '2024-05-05 00:00:00',
        amount: 48000,
      })
      await grant1.save()

      //  years vesting, 1 year cliff, cancelled before the cliff.
      grant2 = new Grant({
        userId: this.user.id,
        start: '2022-05-05 00:00:00',
        end: '2026-05-05 00:00:00',
        cliff: '2023-05-05 00:00:00',
        cancelled: '2023-05-04 00:00:00',
        amount: 48000,
      })
      await grant2.save()
    })

    it('Cancelled grant after cliff', async () => {
      const clock = sinon.useFakeTimers(moment.utc('2027-01-01 00:00:00').valueOf())
      const schedule = vestingSchedule(
        this.user,
        momentizeGrant(grant1.get({ plain: true }))
      )

      // There should be exactly 37 vesting events (1 cliff vest and 36 monthly vests).
      // 24 of them should be cancelled
      // 13 of them should be vested (1 cliff vest event + 12 monthly vests)
      expect(schedule.length).to.equal(37)
      const cancelledCount = schedule.reduce((count, item) => item.cancelled ? ++count : count, 0);
      expect(cancelledCount).to.equal(24)
      const vestedCount = schedule.reduce((count, item) => item.vested ? ++count : count, 0);
      expect(vestedCount).to.equal(13)
      clock.restore()
    })

    it('Cancelled grant before cliff', async () => {
      const clock = sinon.useFakeTimers(moment.utc('2027-01-01 00:00:00').valueOf())
      const schedule = vestingSchedule(
        this.user,
        momentizeGrant(grant2.get({ plain: true }))
      )

      // There should be exactly 37 vesting events (1 cliff vest and 36 monthly vests).
      // All of them should be cancelled and unvested.
      expect(schedule.length).to.equal(37)
      const cancelledCount = schedule.reduce((count, item) => item.cancelled ? ++count : count, 0);
      expect(cancelledCount).to.equal(37)

      schedule.every((e) => expect(e.vested).to.be.false)
      schedule.every((e) => expect(e.cancelled).to.be.true)

      clock.restore()
    })
  })

})

describe('Investor vesting', () => {
  describe('2 year grant with inital 6% followed by quarterly vesting after 4 month delay', () => {
    let grant

    beforeEach(async () => {
      await setupDatabase()
      this.user = await User.create({
        email: 'user+investor@originprotocol.com',
        otpKey: '123',
        otpVerified: true,
      })
      grant = new Grant({
        userId: this.user.id,
        start: '2014-01-01 00:00:00',
        end: '2016-02-01 00:00:00',
        amount: 10000,
      })
      await grant.save()
    })

    it('should vest 6% at start of grant', async () => {
      const clock = sinon.useFakeTimers(moment.utc(grant.start).valueOf())
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      const expectedAmount = BigNumber(grant.amount).times(6).div(100)
      expect(amount).to.be.bignumber.equal(expectedAmount)
      clock.restore()
    })

    it('should not vest anything before start of grant', async () => {
      const clock = sinon.useFakeTimers(
        moment.utc(grant.start).subtract(1, 'second').valueOf()
      )
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(BigNumber(0))
      clock.restore()
    })

    it('should vest 11.75% each quarter after 4 months', async () => {
      const initialVestAmount = BigNumber(grant.amount).times(6).div(100)
      const quarterlyVestAmount = BigNumber(grant.amount).times(11.75).div(100)
      const clock = sinon.useFakeTimers(
        moment.utc(grant.start).add(4, 'months').valueOf()
      )
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(
        initialVestAmount.plus(quarterlyVestAmount)
      )
      clock.restore()
    })

    it('should have vested the correct total at grant end', async () => {
      const clock = sinon.useFakeTimers(moment.utc(grant.end).valueOf())
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(BigNumber(grant.amount))
      clock.restore()
    })

    it('should have vested the correct total years after grant end', async () => {
      const clock = sinon.useFakeTimers(
        moment.utc(grant.end).add(10, 'years').valueOf()
      )
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(BigNumber(grant.amount))
      clock.restore()
    })
  })

  describe('2 year grant with inital 6% followed by quarterly vesting after 4 month delay and rounding', () => {
    let grant

    beforeEach(async () => {
      await setupDatabase()
      this.user = await User.create({
        email: 'user+investor@originprotocol.com',
        otpKey: '123',
        otpVerified: true,
      })
      grant = new Grant({
        userId: this.user.id,
        start: '2014-01-01 00:00:00',
        end: '2016-02-01 00:00:00',
        amount: 11111,
      })
      await grant.save()
    })

    it('should vest 6% floored at start of grant', async () => {
      const clock = sinon.useFakeTimers(moment.utc(grant.start).valueOf())
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      const expectedAmount = BigNumber(grant.amount)
        .times(6)
        .div(100)
        .integerValue(BigNumber.ROUND_FLOOR)
      expect(amount).to.be.bignumber.equal(expectedAmount)
      clock.restore()
    })

    it('should not vest anything before start of grant', async () => {
      const clock = sinon.useFakeTimers(
        moment.utc(grant.start).subtract(1, 'second').valueOf()
      )
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(BigNumber(0))
      clock.restore()
    })

    it('should vest 11.75% floored each quarter after 4 months', async () => {
      const initialVestAmount = BigNumber(grant.amount)
        .times(6)
        .div(100)
        .integerValue(BigNumber.ROUND_FLOOR)
      const quarterlyVestAmount = BigNumber(grant.amount)
        .times(11.75)
        .div(100)
        .integerValue(BigNumber.ROUND_FLOOR)
      const clock = sinon.useFakeTimers(
        moment.utc(grant.start).add(4, 'months').valueOf()
      )
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(
        initialVestAmount.plus(quarterlyVestAmount)
      )
      clock.restore()
    })

    it('should have vested the correct total at grant end', async () => {
      const clock = sinon.useFakeTimers(moment.utc(grant.end).valueOf())
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(BigNumber(grant.amount))
      clock.restore()
    })

    it('should have vested the correct total years after grant end', async () => {
      const clock = sinon.useFakeTimers(
        moment.utc(grant.end).add(10, 'years').valueOf()
      )
      const amount = vestedAmount(
        this.user,
        momentizeGrant(grant.get({ plain: true }))
      )
      expect(amount).to.be.bignumber.equal(BigNumber(grant.amount))
      clock.restore()
    })
  })
})
