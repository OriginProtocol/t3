const moment = require('moment')
const Sequelize = require('sequelize')

const {
  largeTransferThreshold,
  largeTransferDelayMinutes,
} = require('../config')
const { Transfer, TransferTask, sequelize } = require('../models')
const { checkBlockConfirmation, executeTransfer } = require('../lib/transfer')
const logger = require('../logger')
const enums = require('../enums')

// Shared by the pre-insert count and the lookup after the task row is created.
// The lookup remains the check that chooses which withdrawal is sent.
const eligibleTransferWhere = cutoffTime => ({
  [Sequelize.Op.or]: [
    {
      status: enums.TransferStatuses.Enqueued,
      amount: { [Sequelize.Op.gte]: largeTransferThreshold },
      createdAt: { [Sequelize.Op.lte]: cutoffTime },
    },
    {
      status: enums.TransferStatuses.Enqueued,
      amount: { [Sequelize.Op.lt]: largeTransferThreshold },
    },
  ],
})

const executeTransfers = async () => {
  logger.info('Running execute transfers job...')

  const confirmingTransfers = await Transfer.findAll({
    where: {
      status: enums.TransferStatuses.WaitingConfirmation,
    },
    order: [['updated_at', 'ASC']],
  })

  if (confirmingTransfers && confirmingTransfers.length > 0) {
    logger.info(
      `Found ${confirmingTransfers.length} transfer(s) waiting for block confirmation`
    )
    for (const transfer of confirmingTransfers) {
      const isConfirmed = await checkBlockConfirmation(transfer)
      if (!isConfirmed) {
        logger.info(
          `Transfer ${transfer.id} with hash ${transfer.txHash} not confirmed, exiting`
        )
        return
      }
    }
  }

  // Read the overlap guard before deciding there is nothing to send, so a
  // stuck task still warns on an idle run. The transaction below repeats it
  // and is what stops two overlapping runs from both creating a task.
  const outstandingTasks = await TransferTask.findAll({
    where: {
      end: null,
    },
  })
  if (outstandingTasks.length > 0) {
    logger.warn(`Found incomplete transfer task(s), unable to proceed.`)
    return
  }

  const processingTransfers = await Transfer.findAll({
    where: {
      status: enums.TransferStatuses.Processing,
    },
  })
  if (processingTransfers.length > 0) {
    logger.warn(`Found processing transfers, unable to proceed`)
    return
  }

  // This job runs every 10s. Insert a task row only when a withdrawal is
  // eligible; otherwise an idle process writes a row on every tick.
  const eligibleCount = await Transfer.count({
    where: eligibleTransferWhere(
      moment.utc().subtract(largeTransferDelayMinutes, 'minutes')
    ),
  })
  if (eligibleCount === 0) {
    return
  }

  const transferTask = await sequelize.transaction(
    { isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.SERIALIZABLE },
    async (txn) => {
      const outstandingTasks = await TransferTask.findAll(
        {
          where: {
            end: null,
          },
        },
        { transaction: txn }
      )
      if (outstandingTasks.length > 0) {
        logger.warn(`Found incomplete transfer task(s), unable to proceed.`)
        return false
      }

      const processingTransfers = await Transfer.findAll(
        {
          where: {
            status: enums.TransferStatuses.Processing,
          },
        },
        { transaction: txn }
      )
      if (processingTransfers.length > 0) {
        logger.warn(`Found processing transfers, unable to proceed`)
        return false
      }

      const now = moment.utc()
      return await TransferTask.create(
        {
          start: now,
          created_at: now,
          updated_at: now,
        },
        { transaction: txn }
      )
    }
  )

  if (!transferTask) return

  const cutoffTime = moment.utc().subtract(largeTransferDelayMinutes, 'minutes')
  const transfer = await Transfer.findOne({
    where: eligibleTransferWhere(cutoffTime),
    order: [['updated_at', 'ASC']],
  })

  if (transfer) {
    logger.info(`Processing transfer ${transfer.id}`)
    await executeTransfer(transfer, transferTask.id)
  }

  await transferTask.update({
    end: moment.utc(),
  })
}

module.exports = {
  executeTransfers,
}
