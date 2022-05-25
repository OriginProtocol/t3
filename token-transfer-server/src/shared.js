// Code shared between token-transfer-client and token-transfer-server
// The imports in here should be kept minimal o avoid issues
// with webpack building and node

const BigNumber = require('bignumber.js')
const moment = require('moment')

const {
  vestingSchedule,
  vestedAmount,
  toMoment,
  momentizeGrant,
} = require('./lib/vesting')
const { currencies } = require('./constants/currencies')
const enums = require('./enums')

const currencyAmounts = Object.keys(currencies).reduce(
  (o, key) => ({ ...o, [key]: BigNumber(0) }),
  {}
)

/**
 * @typedef {import('./models/user')} User
 * @typedef {import('./models/grant')} Grant
 * @typedef {import('./models/lockup')} Lockup
 */

// Length of time in minutes user has to confirm a transfer by clicking the email
// link
const transferConfirmationTimeout =
  process.env.TRANSFER_CONFIRMATION_TIMEOUT || 5

// Length of time in minutes user has to confirm a lockup by clicking the email
// link
const lockupConfirmationTimeout = process.env.LOCKUP_CONFIRMATION_TIMEOUT || 10

/** Convert the dates of a lockup object to moments.
 * @param {Object} lockup: lockup object
 */
function momentizeLockup(lockup) {
  return {
    ...lockup,
    start: toMoment(lockup.start),
    end: toMoment(lockup.end),
  }
}

/** Calculate the amount of tokens for an array of grants
 * @param {[Object]} grants: grant object
 */
function calculateGranted(grants) {
  return grants.reduce((totals, grant) => {
    return {
      ...totals,
      [grant.currency]: totals[grant.currency].plus(grant.amount),
    }
    // @ts-ignore
  }, currencyAmounts)
}

/** Calculate the amount of vested tokens for an array of grants
 * @param {User|Object} user: user to calculate grants for
 * @param {[Object]} grants: grant object
 */
function calculateVested(user, grants) {
  return grants.reduce((totals, grant) => {
    if (grant.dataValues) {
      // Convert if instance of sequelize model
      grant = grant.get({ plain: true })
    }
    return {
      ...totals,
      [grant.currency]: totals[grant.currency].plus(vestedAmount(user, grant)),
    }
    // @ts-ignore
  }, currencyAmounts)
}

/** Calculate the unlocked earnings from an array of lockups. Tokens earned
 * through lockups are earned immediately but they remain locked until the
 * end of the lockup period.
 * @param {[Object]} lockups: array of lockups
 */
function calculateUnlockedEarnings(lockups) {
  return lockups.reduce((totals, lockup) => {
    if (lockup.confirmed && lockup.end <= moment.utc()) {
      // @ts-ignore
      const earnings = BigNumber(lockup.amount)
        .times(lockup.bonusRate)
        // @ts-ignore
        .div(BigNumber(100))
        // @ts-ignore
        .toFixed(0, BigNumber.ROUND_HALF_UP)
      return totals[lockup.currency].plus(earnings)
    }
    return totals
    // @ts-ignore
  }, currencyAmounts)
}

/** Calculate the total earnings from an array of lockups. This includes both
 * tokens that are available with withdrawal and tokens that the user has but
 * are still locked by the lockup period.
 * @param {[Object]} lockups: array of lockups
 */
function calculateEarnings(lockups) {
  return lockups.reduce((totals, lockup) => {
    if (lockup.confirmed) {
      // @ts-ignore
      const earnings = BigNumber(lockup.amount)
        .times(lockup.bonusRate)
        // @ts-ignore
        .div(BigNumber(100))
        // @ts-ignore
        .toFixed(0, BigNumber.ROUND_HALF_UP)
      return totals[lockup.currency].plus(earnings)
    }
    return totals
    // @ts-ignore
  }, currencyAmounts)
}

/** Calculate tokens that are locked by lockups.
 * @param {[Object]} lockups: array of lockups
 */
function calculateLocked(lockups) {
  return lockups.reduce((totals, lockup) => {
    if (isEarlyLockup(lockup)) {
      if (moment.utc(lockup.data.vest.date) > moment.utc()) {
        // The early lockup vest has not vested, so the balance is these tokens
        // are not counted here, but in calculateNextVestLocked
        // @ts-ignore
        return totals
      }
    }
    if (
      moment.utc(lockup.start).isBefore(moment.utc()) && // Lockup has started
      moment.utc(lockup.end).isAfter(moment.utc()) // Lockup has not yet ended
    ) {
      // @ts-ignore
      return totals[lockup.currency].plus(BigNumber(lockup.amount))
    }
    return totals
    // @ts-ignore
  }, currencyAmounts)
}

/** Determine if a lockup is an arly lockup based
 * @param {Object} lockup: lockup object.
 */
const isEarlyLockup = (lockup) => {
  return !!(lockup.data && lockup.data.vest && lockup.data.vest.grantId)
}

/** Calculate tokens from the next vest that are locked due to early lockups.
 * @param {[Object]} lockups: array of lockups.
 */
function calculateNextVestLocked(lockups) {
  return lockups.reduce((total, lockup) => {
    // Assume every early lockup with a recorded vest date in the future is
    // attributable to the next vest
    if (
      isEarlyLockup(lockup) &&
      moment.utc(lockup.data.vest.date) > moment.utc()
    ) {
      // @ts-ignore
      return total.plus(BigNumber(lockup.amount))
    }
    return total
    // @ts-ignore
  }, BigNumber(0))
}

function getNextVest(grants, user) {
  // Flat map implementation, can remove in node >11
  const flatMap = (a, cb) => [].concat(...a.map(cb))
  const allGrantVestingSchedule = flatMap(grants, (grant) => {
    return vestingSchedule(user, grant)
  })
  const sortedUnvested = allGrantVestingSchedule
    .filter((v) => !v.vested)
    .sort((a, b) => a.date - b.date)

  // No next vest
  if (sortedUnvested.length === 0) return null

  // Check if there a multiple vests happening on the same day to handle the
  // case where users have multiple grants starting at the same time.
  // Note that the client displays vests on the same day as the sum of those
  // vests in the vesting history card
  const sameDay = sortedUnvested.filter((v) =>
    v.date.isSame(sortedUnvested[0].date, 'day')
  )

  // Only one vest happening on the day of the next vest
  if (sameDay.length === 1) return sameDay[0]

  // Multiple vests, combine them into one so they can all be locked up
  return {
    // Dates are the same
    date: sortedUnvested[0].date,
    // List of grant ids
    grantId: sameDay.map((s) => s.grantId),
    // Sum the vest amounts
    amount: sameDay.reduce((total, vest) => {
      return total.plus(BigNumber(vest.amount))
    }, BigNumber(0)),
    vested: false,
  }
}

/** Calculate the amount of tokens that have been withdrawn or are in flight in
 * a withdrawal.
 * @param {Object} transfers: transfer object
 */
function calculateWithdrawn(transfers) {
  // Sum the amount from transfers that are in a pending or success state
  const pendingOrCompleteTransfers = [
    // @ts-ignore
    enums.TransferStatuses.WaitingEmailConfirm,
    // @ts-ignore
    enums.TransferStatuses.Enqueued,
    // @ts-ignore
    enums.TransferStatuses.Paused,
    // @ts-ignore
    enums.TransferStatuses.WaitingConfirmation,
    // @ts-ignore
    enums.TransferStatuses.Success,
    // @ts-ignore
    enums.TransferStatuses.Processing,
  ]

  return transfers.reduce((totals, transfer) => {
    if (pendingOrCompleteTransfers.includes(transfer.status)) {
      if (
        // Handle the case where a transfer is still awaiting email confirmation
        // but has expired
        // @ts-ignore
        transfer.status === enums.TransferStatuses.WaitingEmailConfirm &&
        transferHasExpired(transfer)
      ) {
        return totals
      } else {
        // @ts-ignore
        return {
          ...totals,
          [transfer.currency]: totals[transfer.currency].plus(
            BigNumber(transfer.amount)
          ),
        }
      }
    }
    return totals
    // @ts-ignore
  }, currencyAmounts)
}

/** Helper function to determine if a transfer has expired, i.e. the user did
 * not click the email link within the configured timeout.
 * @param {Object} transfer
 */
function transferHasExpired(transfer) {
  return (
    moment().diff(moment(transfer.createdAt), 'minutes') >=
    transferConfirmationTimeout
  )
}

/** Helper function to determine if a transfer has expired, i.e. the user did
 * not click the email link within the configured timeout
 * @param {Object} lockup
 */
function lockupHasExpired(lockup) {
  return (
    moment().diff(moment(lockup.createdAt), 'minutes') >=
    lockupConfirmationTimeout
  )
}

module.exports = {
  calculateGranted,
  calculateVested,
  calculateUnlockedEarnings,
  calculateEarnings,
  calculateLocked,
  calculateNextVestLocked,
  calculateWithdrawn,
  getNextVest,
  toMoment,
  momentizeLockup,
  momentizeGrant,
  lockupHasExpired,
  transferHasExpired,
  lockupConfirmationTimeout,
  transferConfirmationTimeout,
}
