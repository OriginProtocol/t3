'use strict'

const Logger = require('logplease')
const grantMatchingOGV = require('./_insert_grants')

Logger.setLogLevel(process.env.LOG_LEVEL || 'INFO')

const logger = Logger.create('insert_ogv_airdrop_grants', {
  showTimestamp: false
})

grantMatchingOGV()
  .then(() => {
    logger.info('Finished')
    process.exit()
  })
  .catch(err => {
    logger.error('Job failed: ', err)
    logger.error('Exiting')
    process.exit(-1)
  })
