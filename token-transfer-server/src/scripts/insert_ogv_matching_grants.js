'use strict'

const BigNumber = require('bignumber.js')
const Logger = require('logplease')
const moment = require('moment')

const db = require('../models')

const { vestingSchedule } = require('../lib/vesting')

Logger.setLogLevel(process.env.LOG_LEVEL || 'INFO')
const logger = Logger.create('insert_ogv_airdrop_grants', {
  showTimestamp: false
})

const SNAPSHOT_DATE = '2022-7-12'

async function run() {
  const users = await db.User.findAll({ where: { id: 693 } })
  for (const user of users) {
    const grants = await db.Grant.findAll({ where: { userId: user.id } })
    for (const grant of grants) {
      const schedule = vestingSchedule(user, grant.get({ plain: true }))
      // Filter for all vests after snapshot date. Existing balances already airdropped.
      const filteredVesting = schedule.filter(
        v => v.date > moment(SNAPSHOT_DATE).toDate()
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
      const grantEndDate = moment.max(...filteredVesting.map(v => v.date))

      const newGrant = {
        userId: user.id,
        start: grantStartDate,
        cliff: grantStartDate,
        end: grantEndDate,
        amount: totalGrantAmount.toString(),
        // TODO: Not sure if T3 will correctly handle cliff that is the same as grant start date
        // - It looks like it'll create a 0 vest and the first vest on the same day
        // - Could be cleaned up by handling it in the vestingSchedule import
        currency: 'OGV'
      }

      await db.Grant.create(newGrant)
    }
  }
}

run()
  .then(() => {
    logger.info('Finished')
    process.exit()
  })
  .catch(err => {
    logger.error('Job failed: ', err)
    logger.error('Exiting')
    process.exit(-1)
  })
