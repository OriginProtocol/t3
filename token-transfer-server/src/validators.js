const ethers = require('ethers')
const totp = require('notp').totp

const { Account } = require('./models')
const { decrypt } = require('./lib/crypto')
const { currencies } = require('./constants/currencies')

// Validator for validating an Ethereum address
const isEthereumAddress = (value) => {
  if (!ethers.utils.isAddress(value)) {
    throw new Error('Address is not a valid Ethereum address')
  }
  return true
}

// Validator for checking if an account address already exists for the user
const isExistingAddress = (value, { req }) => {
  return Account.findOne({
    where: {
      userId: req.user.id,
      address: value,
    },
  }).then((account) => {
    if (account) {
      throw new Error('Address already exists')
    }
    return true
  })
}

// Validator for checking if an account nickname already exists for the user
const isExistingNickname = (value, { req }) => {
  return Account.findOne({
    where: {
      userId: req.user.id,
      nickname: value,
    },
  }).then((account) => {
    if (account) {
      throw new Error('Nickname already exists')
    }
    return true
  })
}

// Validator for TOTP codes
const isValidTotp = (value, { req }) => {
  if (!req.user.otpKey) {
    throw new Error('No OTP key configured')
  }
  if (!totp.verify(value, decrypt(req.user.otpKey), { window: 1 })) {
    throw new Error('Invalid OTP code')
  }
  return true
}

// Validator for TOTP codes that is less strict, it has a window of 6 * 30s
// to allow time for resets
const isRecentlyValidTotp = (value, { req }) => {
  if (!req.user.otpKey) {
    throw new Error('No OTP key configured')
  }
  if (!totp.verify(value, decrypt(req.user.otpKey), { window: 6 })) {
    throw new Error('Invalid OTP code')
  }
  return true
}

// Validator for TOTP  code where the OTP key is included in the body, used for
// changes to OTP codes
const isValidNewTotp = (value, { req }) => {
  if (!req.body.otpKey) {
    throw new Error('No OTP key in request')
  }
  if (!totp.verify(value, req.body.otpKey, { window: 1 })) {
    throw new Error('Invalid OTP code')
  }
  return true
}

const isCurrency = (value, { req }) => {
  if (!Object.keys(currencies).includes(req.body.currency)) {
    throw new Error('Unsupported currency')
  }
  return true
}

module.exports = {
  isEthereumAddress,
  isExistingAddress,
  isExistingNickname,
  isValidTotp,
  isRecentlyValidTotp,
  isValidNewTotp,
  isCurrency,
}
