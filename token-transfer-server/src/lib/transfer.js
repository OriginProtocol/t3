const BigNumber = require('bignumber.js')
const get = require('lodash.get')
const jwt = require('jsonwebtoken')
const ethers = require('ethers')

const {
  discordWebhookUrl,
  provider,
  signer,
  createTokenContract,
} = require('../config')
const { sendEmail } = require('../lib/email')
const { postToWebhook } = require('./webhook')
const {
  TRANSFER_DONE,
  TRANSFER_FAILED,
  TRANSFER_REQUEST,
  TRANSFER_CONFIRMED,
} = require('../constants/events')
const { currencies } = require('../constants/currencies')
const { Event, Transfer, User, sequelize } = require('../models')
const { getBalance } = require('./balance')
const { transferHasExpired } = require('../shared')
const {
  clientUrl,
  encryptionSecret,
  gasPriceMultiplier,
  transferConfirmationTimeout,
} = require('../config')
const enums = require('../enums')
const logger = require('../logger')

// Number of block confirmations required for a transfer to be consider completed.
const NumBlockConfirmation = 3

/**
 * Enqueues a request to transfer tokens.
 *
 * @param {BigInt} userId: id of the user transferring
 * @param {String} address: ethereum address to transfer to
 * @param {BigNumber} amount: amount to transfer
 * @param {Object} data: additional data to be recorded with the transfer request
 * @returns {Promise<Transfer>} Transfer object.
 */
async function addTransfer(userId, address, amount, currency, data = {}) {
  if (!Object.keys(currencies).includes(currency)) {
    throw new Error(`${currency} is not a supported currency`)
  }
  const balance = await getBalance(userId, currency)
  // @ts-ignore
  if (BigNumber(amount).gt(balance)) {
    throw new RangeError(
      `Amount of ${amount} ${currency} exceeds the ${balance} available for transfer for user ${userId}`
    )
  }

  // Enqueue the request by inserting a row in the transfer table.
  // It will get picked up asynchronously by the offline job that processes transfers.
  // Record new state in the database.
  let transfer
  const txn = await sequelize.transaction()
  try {
    transfer = await Transfer.create({
      userId: userId,
      // @ts-ignore
      status: enums.TransferStatuses.WaitingEmailConfirm,
      toAddress: address.toLowerCase(),
      amount,
      currency,
      data,
    })
    await Event.create({
      userId: userId,
      action: TRANSFER_REQUEST,
      data: JSON.stringify({
        transferId: transfer.id,
      }),
    })
    await txn.commit()
  } catch (e) {
    await txn.rollback()
    logger.error(`Failed to add transfer for address ${address}: ${e}`)
    throw e
  }

  await sendTransferConfirmationEmail(transfer, userId)

  return transfer
}

/**
 * Sends an email with a token that can be used for confirming a transfer.
 * @param transfer
 * @param userId
 */
async function sendTransferConfirmationEmail(transfer, userId) {
  const user = await User.findByPk(userId)

  const confirmationToken = jwt.sign(
    {
      transferId: transfer.id,
    },
    encryptionSecret,
    { expiresIn: `${transferConfirmationTimeout}m` }
  )

  const vars = {
    url: `${clientUrl}/withdrawal/${transfer.id}/${confirmationToken}`,
    employee: user.employee,
  }
  await sendEmail(user.email, 'transfer', vars)

  logger.info(
    `Sent email transfer confirmation token to ${user.email} for transfer ${transfer.id}`
  )
}

/** Moves a transfer from waiting for email confirmation to enqueued.
 * Throws an exception if the request is invalid.
 *
 * @param {Transfer} transfer: DB transfer object
 * @param {User} user: DB user object
 */
async function confirmTransfer(transfer, user) {
  // @ts-ignore
  if (transfer.status !== enums.TransferStatuses.WaitingEmailConfirm) {
    throw new Error('Transfer is not waiting for confirmation')
  }

  if (transferHasExpired(transfer)) {
    await transfer.update({
      // @ts-ignore
      status: enums.TransferStatuses.Expired,
    })
    throw new Error('Transfer was not confirmed in the required time')
  }

  const txn = await sequelize.transaction()
  // Change state of transfer and add event
  try {
    await transfer.update({
      // @ts-ignore
      status: enums.TransferStatuses.Enqueued,
    })
    const event = {
      userId: user.id,
      action: TRANSFER_CONFIRMED,
      data: JSON.stringify({
        transferId: transfer.id,
      }),
    }
    await Event.create(event)
    await txn.commit()
  } catch (e) {
    await txn.rollback()
    logger.error(
      `Failed writing confirmation data for transfer ${transfer.id}: ${e}`
    )
    throw e
  }

  try {
    if (discordWebhookUrl) {
      const countryDisplay = get(
        transfer.data.location,
        'countryName',
        'Unknown'
      )
      const webhookData = {
        embeds: [
          {
            title: `A transfer of \`${transfer.amount}\` OGN was queued by \`${user.email}\``,
            description: [
              `**ID:** \`${transfer.id}\``,
              `**Address:** \`${transfer.toAddress}\``,
              `**Country:** ${countryDisplay}`,
            ].join('\n'),
          },
        ],
      }
      await postToWebhook(discordWebhookUrl, JSON.stringify(webhookData))
    }
  } catch (e) {
    logger.error(
      `Failed sending Discord webhook for token transfer confirmation:`,
      e
    )
  }

  logger.info(
    `Transfer ${transfer.id} was confirmed by email token for ${user.email}`
  )

  return true
}

/**
 * Sends a blockchain transaction to transfer tokens.
 *
 * @param {Transfer} transfer: Db model transfer object
 * @param {BigInt} transferTaskId: Id of the calling transfer task
 * @returns {Promise<String|Boolean>} Hash of the transaction
 */
async function executeTransfer(transfer, transferTaskId) {
  const balance = await getBalance(transfer.userId, transfer.currency)

  // Add the current transfer to the balance because it is the one we are processing
  const balanceExcludingTransfer = balance.plus(transfer.amount)

  if (balanceExcludingTransfer.lt(0)) {
    throw new RangeError(
      `Amount of ${transfer.amount} ${transfer.currency} exceeds the ${balanceExcludingTransfer} available for executing transfer for user ${transfer.userId}`
    )
  }

  await transfer.update({
    // @ts-ignore
    status: enums.TransferStatuses.Processing,
    transferTaskId,
  })

  // Send transaction to transfer the tokens and record txHash in the DB.
  const amount = ethers.utils.parseUnits(transfer.amount)
  const supplier = await signer.getAddress()

  // Check the balance
  // TODO handle opts
  const opts = {}
  if (gasPriceMultiplier) {
    opts.gasPriceMultiplier = gasPriceMultiplier
  }

  const contract = createTokenContract(transfer.currency)

  let receipt
  try {
    const supplierBalance = await contract.balanceOf(supplier)
    if (amount.gt(supplierBalance)) {
      throw new Error(`Supplier balance is too low`)
    }

    receipt = await contract
      .connect(signer)
      .transfer(transfer.toAddress, amount)
  } catch (error) {
    logger.error('Error crediting tokens', error.message)
    await updateTransferStatus(
      transfer,
      // @ts-ignore
      enums.TransferStatuses.Failed,
      TRANSFER_FAILED,
      error.message
    )
    return false
  }

  logger.info(`Transfer ${transfer.id} processed with hash ${receipt.hash}`)

  await transfer.update({
    // @ts-ignore
    status: enums.TransferStatuses.WaitingConfirmation,
    fromAddress: supplier.toLowerCase(),
    txHash: receipt.hash,
  })

  return receipt.hash
}

/**
 * Sends a blockchain transaction to transfer tokens.
 *
 * @param {Transfer} transfer: DB model Transfer object
 * @returns {Promise<String>}
 */
async function checkBlockConfirmation(transfer) {
  // Wait for the transaction to get confirmed.
  const result = await isConfirmed(transfer.txHash, {
    numBlocks: NumBlockConfirmation,
  })

  let transferStatus, eventAction, failureReason
  if (!result) {
    return null
  } else {
    switch (result.status) {
      case 'confirmed':
        // @ts-ignore
        transferStatus = enums.TransferStatuses.Success
        eventAction = TRANSFER_DONE
        break
      case 'failed':
        // @ts-ignore
        transferStatus = enums.TransferStatuses.Failed
        eventAction = TRANSFER_FAILED
        break
      default:
        throw new Error(
          `Unexpected status ${result.status} for txHash ${transfer.txHash}`
        )
    }
  }

  logger.info(
    `Received status ${result.status} for transaction ${transfer.txHash}`
  )

  await updateTransferStatus(
    transfer,
    transferStatus,
    eventAction,
    failureReason
  )

  return result.status
}

/**
 * Update transfer status and add an event with the result of the transfer.
 *
 * @param {Transfer} transfer: Db model transfer object
 * @param {String} transferStatus: string representing status of the transfer
 * @param {String} eventAction:
 * @param {String} failureReason: reason for the failure
 * @returns {Promise<void>}
 */
async function updateTransferStatus(
  transfer,
  transferStatus,
  eventAction,
  failureReason
) {
  // Update the status in the transfer table.
  const txn = await sequelize.transaction()
  try {
    await transfer.update({
      status: transferStatus,
    })
    const event = {
      userId: transfer.userId,
      action: eventAction,
      data: {
        transferId: transfer.id,
      },
    }
    if (failureReason) {
      event.data.failureReason = failureReason
    }
    await Event.create(event)
    await txn.commit()
  } catch (e) {
    await txn.rollback()
    logger.error(
      `Failed writing confirmation data for transfer ${transfer.id}: ${e}`
    )
    throw e
  }
}

async function isConfirmed(transactionHash, { numBlocks = 8 }) {
  let receipt
  try {
    receipt = await provider.getTransactionReceipt(transactionHash)
  } catch (e) {
    logger.error(
      `getTransactionReceipt failure for transaction hash ${transactionHash}`,
      e
    )
  }

  // Note: we check on the presence of both receipt and receipt.blockNumber
  // to account for the difference between Geth and Parity:
  //  - Geth does not return a receipt until the transaction is mined
  //  - Parity returns a receipt with no blockNumber until the transaction is mined.
  if (receipt && receipt.blockNumber) {
    if (!receipt.status) {
      // Transaction was reverted by the EVM.
      return { status: 'failed', receipt }
    } else {
      // Calculate the number of block confirmations.
      try {
        const blockNumber = await provider.getBlockNumber()
        const numConfirmations = blockNumber - receipt.blockNumber
        if (numConfirmations >= numBlocks) {
          // Transaction confirmed.
          return { status: 'confirmed', receipt }
        }
      } catch (e) {
        logger.error('getBlockNumber failure', e)
      }
    }
  }
}

module.exports = {
  addTransfer,
  confirmTransfer,
  executeTransfer,
  checkBlockConfirmation,
}
