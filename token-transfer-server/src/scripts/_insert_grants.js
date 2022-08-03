'use strict'

const BigNumber = require('bignumber.js')
const moment = require('moment')

const db = require('../models')

const { vestingSchedule } = require('../lib/vesting')

const SNAPSHOT_DATE = moment('2022-07-12')

async function run() {
  const grants = await db.Grant.findAll({
    include: [
      {
        model: db.User
      }
    ]
  })

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

    // Calculate the end date for the new grant (last vest of all unvested)
    const grantStartDate = moment.min(...filteredVesting.map(v => v.date))
    let grantEndDate = moment.max(...filteredVesting.map(v => v.date))
    const grantCliffDate = moment.max(grantStartDate, moment(grant.cliff))

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
      currency: 'OGV'
    }

    await db.Grant.create(newGrant)
  }
}

module.exports = run
