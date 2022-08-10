const BigNumber = require('bignumber.js')
const chai = require('chai')
const { vestingSchedule } = require('../../src/lib/vesting')
chai.use(require('chai-moment'))
chai.use(require('chai-bignumber')(BigNumber))
const expect = chai.expect

const { Grant, User, sequelize } = require('../../src/models')

const grantMatchingOGV = require('../../src/scripts/_insert_grants')

// Sets up clean database
async function setupDatabase() {
  expect(process.env.NODE_ENV).to.equal('test')
  await sequelize.sync({ force: true })
}

async function createUser() {
  return await User.create({
    email: `randuser${Math.random().toString(32)}@originprotocol.com`,
    otpKey: '123',
    otpVerified: true,
    employee: true
  })
}

describe('Matching OGV Grants', () => {
  beforeEach(async () => {
    await setupDatabase()
  })

  it('should grant OGV only to eligible vests', async () => {
    // User 1 has all vests before the snapshot date
    const user1 = await createUser()
    await Grant.create({
      userId: user1.id,
      start: new Date('2016-05-05'),
      end: new Date('2020-05-05'),
      cliff: new Date('2017-05-05'),
      amount: 10000000,
      interval: 'days',
      currency: 'OGN'
    })

    // User 2 has some vests before the snapshot date
    const user2 = await createUser()
    await Grant.create({
      userId: user2.id,
      start: new Date('2020-05-05'),
      end: new Date('2024-05-05'),
      cliff: new Date('2021-05-05'),
      amount: 10000000,
      interval: 'days',
      currency: 'OGN'
    })

    // User 3 has all vests after the snapshot date.
    // They joined the company after the snapshot and won't get a matching OGV grant.
    const user3 = await createUser()
    await Grant.create({
      userId: user3.id,
      start: new Date('2022-07-13'),
      end: new Date('2026-07-13'),
      cliff: new Date('2023-07-13'),
      amount: 10000000,
      interval: 'days',
      currency: 'OGN'
    })

    // Run the script
    await grantMatchingOGV()

    // Make sure user1 has no new grants
    const user1OGVGrants = await Grant.findAll({
      where: {
        userId: user1.id,
        currency: 'OGV'
      }
    })
    expect(user1OGVGrants.length).to.equal(0)

    // Make sure user2 has OGV grants for only unvested OGN
    const user2OGVGrants = await Grant.findAll({
      where: {
        userId: user2.id,
        currency: 'OGV'
      }
    })
    expect(user2OGVGrants.length).to.equal(1)
    expect(user2OGVGrants[0].start.toISOString()).to.equal(
      new Date('2022-08-05').toISOString()
    )
    expect(user2OGVGrants[0].cliff.toISOString()).to.equal(
      new Date('2022-08-05').toISOString()
    )
    expect(user2OGVGrants[0].end.toISOString()).to.equal(
      new Date('2024-06-05').toISOString()
    )
    expect(user2OGVGrants[0].amount).to.equal(4583338)

    // Make sure user3 has OGV no grant.
    const user3OGVGrants = await Grant.findAll({
      where: {
        userId: user3.id,
        currency: 'OGV'
      }
    })
    expect(user3OGVGrants.length).to.equal(0)
  })

  it('should grant OGV when start is same as snapshot date', async () => {
    // User 1 has some vests before the snapshot date
    const user1 = await createUser()
    await Grant.create({
      userId: user1.id,
      start: new Date('2020-07-12'),
      end: new Date('2024-07-12'),
      cliff: new Date('2021-07-12'),
      amount: 10000000,
      interval: 'days',
      currency: 'OGN'
    })

    // User 2 has all vests after the snapshot date
    const user2 = await createUser()
    await Grant.create({
      userId: user2.id,
      start: new Date('2022-07-12'),
      end: new Date('2026-07-12'),
      cliff: new Date('2023-07-12'),
      amount: 10000000,
      interval: 'days',
      currency: 'OGN'
    })

    // Run the script
    await grantMatchingOGV()

    // Make sure user1 has OGV grants for only unvested OGN
    const user1OGVGrants = await Grant.findAll({
      where: {
        userId: user1.id,
        currency: 'OGV'
      }
    })
    expect(user1OGVGrants.length).to.equal(1)
    expect(user1OGVGrants[0].start.toISOString()).to.equal(
      new Date('2022-08-12').toISOString()
    )
    expect(user1OGVGrants[0].cliff.toISOString()).to.equal(
      new Date('2022-08-12').toISOString()
    )
    expect(user1OGVGrants[0].end.toISOString()).to.equal(
      new Date('2024-08-12').toISOString()
    )
    expect(user1OGVGrants[0].amount).to.equal(5000004)

    // Make sure user2 has OGV grants for all his unvested OGN
    const user2OGVGrants = await Grant.findAll({
      where: {
        userId: user2.id,
        currency: 'OGV'
      }
    })
    expect(user2OGVGrants.length).to.equal(1)
    expect(user2OGVGrants[0].start.toISOString()).to.equal(
      new Date('2022-07-12').toISOString()
    )
    expect(user2OGVGrants[0].cliff.toISOString()).to.equal(
      new Date('2023-07-12').toISOString()
    )
    expect(user2OGVGrants[0].end.toISOString()).to.equal(
      new Date('2026-07-12').toISOString()
    )
    expect(user2OGVGrants[0].amount).to.equal(10000000)
  })

  it('should handle cliffs after snapshot correctly', async () => {
    // User 1 has some vests before the snapshot date
    const user1 = await createUser()
    const ognGrant = await Grant.create({
      userId: user1.id,
      start: new Date('2021-12-10'),
      end: new Date('2025-12-10'),
      cliff: new Date('2022-12-10'),
      amount: 10000000,
      interval: 'days',
      currency: 'OGN'
    })

    // Run the script
    await grantMatchingOGV()

    // Make sure user1 has OGV grants for only unvested OGN
    const user1OGVGrants = await Grant.findAll({
      where: {
        userId: user1.id,
        currency: 'OGV'
      }
    })
    expect(user1OGVGrants.length).to.equal(1)
    expect(user1OGVGrants[0].start.toISOString()).to.equal(
      new Date('2021-12-10').toISOString()
    )
    expect(user1OGVGrants[0].cliff.toISOString()).to.equal(
      new Date('2022-12-10').toISOString()
    )
    expect(user1OGVGrants[0].end.toISOString()).to.equal(
      new Date('2025-12-10').toISOString()
    )
    expect(user1OGVGrants[0].amount).to.equal(10000000)

    const [cliffVest, ...vests] = vestingSchedule(user1, user1OGVGrants[0].get({ plain: true }))

    expect(cliffVest.amount.toString()).to.equal('2500000')
    for (const vest of vests.slice(0, -1)) {
      expect(vest.amount.toString()).to.equal('208333')
    }

    expect(vests[vests.length - 1].amount.toString()).to.equal('208345')
  })
})
