'use strict'

const BigNumber = require('bignumber.js')
const Logger = require('logplease')
const moment = require('moment')

const db = require('../models')

const { getBalance } = require('../lib/balance')

Logger.setLogLevel(process.env.LOG_LEVEL || 'INFO')
const logger = Logger.create('enqueue', { showTimestamp: false })

const GRANT_START = moment('2022-07-05', 'YYYY-MM-DD')
const GRANT_END = GRANT_START.add('1', 'days')
const CLIFF = GRANT_END

function parseArgv() {
  const args = {}
  for (const arg of process.argv) {
    const elems = arg.split('=')
    const key = elems[0]
    const val = elems.length > 1 ? elems[1] : true
    args[key] = val
  }
  return args
}

async function run(config) {
  const users = await db.User.findAll()
  let hasBalanceCounter = 0
  let balanceTotals = BigNumber(0);

  for (const user of users) {
    const balance = await getBalance(user.id, 'OGN')
    if (balance.gt(BigNumber(0))) {
      hasBalanceCounter++;
      balanceTotals = balanceTotals.plus(balance)
      if (config.doIt) {
        const ogvGrant = await db.Grant.findOne({ where: { userId: user.id, currency: 'OGV' } });
        if (!ogvGrant) {
          await db.Grant.create({
            userId: user.id,
            start: GRANT_START,
            end: GRANT_END,
            cliff: CLIFF,
            currency: 'OGV',
            amount: balance,
          })
        } else {
          console.log(`User ${user.email} already had an OGV grant`)
        }
      } else {
        console.log(`Would insert grant OGV for ${balance.toString()} for ${user.email}`)
      }
    }
  }

  console.log(`${hasBalanceCounter} users with a balance, ${users.length - hasBalanceCounter} users without a balance`);
  console.log(`${balanceTotals.toString()} OGN balances total`)
}

const args = parseArgv()
const config = {
  // By default run in dry-run mode.
  doIt: args['--doIt'] === 'true' || false,
}
logger.info('Config:')
logger.info(config)

run(config)
  .then(() => {
    logger.info('Finished')
    process.exit()
  })
  .catch(err => {
    logger.error('Job failed: ', err)
    logger.error('Exiting')
    process.exit(-1)
  })
