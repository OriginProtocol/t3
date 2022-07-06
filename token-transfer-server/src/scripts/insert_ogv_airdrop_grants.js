'use strict'

const BigNumber = require('bignumber.js')
const Logger = require('logplease')
const moment = require('moment')

const db = require('../models')

const { getBalance } = require('../lib/balance')

Logger.setLogLevel(process.env.LOG_LEVEL || 'INFO')
const logger = Logger.create('insert_ogv_airdrop_grants', {
  showTimestamp: false
})

const GRANT_START = moment()
const GRANT_END = GRANT_START.add('1', 'days')
const CLIFF = GRANT_END

async function run() {
  const users = await db.User.findAll()
  let hasBalanceCounter = 0
  let balanceTotals = BigNumber(0)

  for (const user of users) {
    const balance = await getBalance(user.id, 'OGN')
    if (balance.gt(BigNumber(0))) {
      hasBalanceCounter++
      balanceTotals = balanceTotals.plus(balance)
      const sql = db.Grant.QueryGenerator.insertQuery(
        db.Grant.getTableName(),
        {
          user_id: user.id,
          start: GRANT_START.toISOString(),
          end: GRANT_END.toISOString(),
          cliff: CLIFF.toISOString(),
          currency: 'OGV',
          amount: balance.toString(),
          updated_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        },
        {},
        { bindParam: false }
      )
      console.log(sql.query)
    }
  }

  logger.info(
    `${hasBalanceCounter} users with a balance, ${users.length -
      hasBalanceCounter} users without a balance`
  )
  logger.info(`${balanceTotals.toString()} OGN balances total`)
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
