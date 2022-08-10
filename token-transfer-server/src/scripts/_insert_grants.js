'use strict'

const BigNumber = require('bignumber.js')
const moment = require('moment')

const db = require('../models')

const { vestingSchedule } = require('../lib/vesting')

const SNAPSHOT_DATE = moment('2022-07-12')

const csv = process.env.CSV

async function run() {
  // Look for all OGN grants that haven't been cancelled
  // and that have a start date prior to the snapshot
  const grants = await db.Grant.findAll({
    where: {
      currency: 'OGN',
      cancelled: null,
      start: { [db.Sequelize.Op.lt]: SNAPSHOT_DATE }
    },
    include: [
      {
        model: db.User
      }
    ]
  })

  if (csv) {
    console.log(['email', 'start', 'cliff', 'end', 'amount', 'currency', 'grantType', 'ogn_grant_id'].join(','))
  }
  for (const grant of grants) {
    const schedule = vestingSchedule(grant.User, grant.get({ plain: true }))
    // Filter for all vests after snapshot date. Existing balances already airdropped.
    const filteredVesting = schedule.filter(
      v => v.date > SNAPSHOT_DATE.toDate()
    )
    // No vests remaining on grant, no matching grant needed
    if (filteredVesting.length === 0) continue

    // Calculate the total amount for the new grant
    const totalGrantAmount = filteredVesting.reduce(
      (total, vest) => total.plus(vest.amount),
      new BigNumber(0)
    )

    const ognCliff = moment(grant.cliff)

    // Calculate the end date for the new grant (last vest of all unvested)
    let grantStartDate = moment.min(...filteredVesting.map(v => v.date))
    let grantEndDate = moment.max(...filteredVesting.map(v => v.date))
    const grantCliffDate = moment.max(grantStartDate, ognCliff)

    if (ognCliff.isAfter(SNAPSHOT_DATE)) {
      // If the user hadn't reached their cliff at snapshot date, they hadn't vested anything yet.
      // Set the OGV grant start date to the OGN grant start date, so that they'll vest the
      // same amount of OGV as OGN when reaching the common cliff.
      grantStartDate = moment(grant.start)
    }

    if (grantStartDate.isAfter(SNAPSHOT_DATE)) {
      // Start is inclusive and end is exclusive
      // So, when start date is not same as snapshot date,
      // it cuts short 1 month in overall calculations.
      grantEndDate = grantEndDate.add(1, 'month')
    }

    const newGrant = {
      userId: grant.User.id,
      start: grantStartDate,
      cliff: grantCliffDate,
      end: grantEndDate,
      amount: totalGrantAmount.toString(),
      currency: 'OGV',
      grantType: `OGV grant for unvested OGN from grant: ${grant.grantType || 'ID ' + grant.id}`
    }

    const row = await db.Grant.create(newGrant)
    if (csv) {
      console.log([
        grant.User.email,
        moment(row.start).format('YYYY-MM-DD'),
        moment(row.cliff).format('YYYY-MM-DD'),
        moment(row.end).format('YYYY-MM-DD'),
        row.amount,
        row.currency,
        row.grantType,
        grant.id
      ].join(','))
    }
  }
}

module.exports = run
