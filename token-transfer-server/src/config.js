const fs = require('fs')
const ethers = require('ethers')

require('dotenv').config()

const moment = require('moment')

const logger = require('./logger')
const {
  transferConfirmationTimeout,
  lockupConfirmationTimeout,
} = require('./shared')
const { ContractMock } = require('../test/contract-mock')
const { currencies } = require('./constants/currencies')

const MAINNET_NETWORK_ID = 1
const ROPSTEN_NETWORK_ID = 3
const RINKEBY_NETWORK_ID = 4
const LOCAL_NETWORK_ID = 31337
const TEST_NETWORK_ID = 999

const DEFAULT_MNEMONIC =
  'replace hover unaware super where filter stone fine garlic address matrix basic'

const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL || null

const encryptionSecret = process.env.ENCRYPTION_SECRET
if (!encryptionSecret) {
  console.log('ENCRYPTION_SECRET must be set through EnvKey or manually')
  process.exit(1)
}

const networkId =
  process.env.NODE_ENV === 'test'
    ? TEST_NETWORK_ID
    : parseInt(process.env.NETWORK_ID)

const port = process.env.PORT || 5000

const clientUrl =
  process.env.CLIENT_URL || 'https://investor.originprotocol.com/#'

// Sendgrid configuration
const sendgridFromEmail = process.env.SENDGRID_FROM_EMAIL
if (!sendgridFromEmail) {
  logger.error('SENDGRID_FROM_EMAIL must be set through EnvKey or manually')
  process.exit(1)
}

const sendgridApiKey = process.env.SENDGRID_API_KEY
if (!sendgridFromEmail) {
  logger.error('SENDGRID_API_KEY must be set through EnvKey or manually')
  process.exit(1)
}

const sessionSecret = process.env.SESSION_SECRET
if (!sessionSecret) {
  logger.error('SESSION_SECRET must be set through EnvKey or manually')
  process.exit(1)
}

const largeTransferThreshold =
  Number(process.env.LARGE_TRANSFER_THRESHOLD) || 100000

const largeTransferDelayMinutes = process.env.LARGE_TRANSFER_DELAY_MINUTES || 60

const otcPartnerEmails = (
  process.env.OTC_PARTNER_EMAIL || 'investor-relations@originprotocol.com'
).split(',')

const gasPriceMultiplier = process.env.GAS_PRICE_MULTIPLIER

// Unlock date, if undefined assume tokens are locked with an unknown unlock
// date
const unlockDate = moment(process.env.UNLOCK_DATE, 'YYYY-MM-DD').isValid()
  ? moment.utc(process.env.UNLOCK_DATE)
  : undefined

// Lockup bonus rate as a percentage
const lockupBonusRate = Number(process.env.LOCKUP_BONUS_RATE) || 17.5

// Early lockup bons rate as a percentage
const earlyLockupBonusRate = Number(process.env.EARLY_LOCKUP_BONUS_RATE) || 35

// Date early lockups are enabled until
const earlyLockupsEnabledUntil = process.env.EARLY_LOCKUPS_ENABLED_UNTIL

// Whether early lockups are enabled, derived from the date lockups are enakjbled until
const earlyLockupsEnabled = moment(
  earlyLockupsEnabledUntil,
  'YYYY-MM-DD'
).isValid()
  ? moment.utc(earlyLockupsEnabledUntil) > moment.utc()
  : false

// Lockup duration in months
const lockupDuration = Number(process.env.LOCKUP_DURATION) || 12

// Whether lockups are enabled
const lockupsEnabled = process.env.LOCKUPS_ENABLED || true

// Whether OTC requests are enabled
const otcRequestEnabled = process.env.OTC_REQUEST_ENABLED || false

const createProviderAndSigner = () => {
  let providerUrl, signer, mnemonic, privateKey

  switch (networkId) {
    case MAINNET_NETWORK_ID:
      privateKey = process.env.MAINNET_PRIVATE_KEY
      mnemonic = process.env.MAINNET_MNEMONIC
      if (!privateKey && !mnemonic) {
        throw 'Must have either MAINNET_PRIVATE_KEY or MAINNET_MNEMONIC env var'
      }
      if (!process.env.MAINNET_PROVIDER_URL) {
        throw 'Missing MAINNET_PROVIDER_URL env var'
      }
      providerUrl = process.env.MAINNET_PROVIDER_URL
      break
    case ROPSTEN_NETWORK_ID:
      privateKey = process.env.ROPSTEN_PRIVATE_KEY
      mnemonic = process.env.ROPSTEN_MNEMONIC
      if (!privateKey && !mnemonic) {
        throw 'Must have either ROPSTEN_PRIVATE_KEY or ROPSTEN_MNEMONIC env var'
      }
      if (!process.env.ROPSTEN_PROVIDER_URL) {
        throw 'Missing ROPSTEN_PROVIDER_URL env var'
      }
      providerUrl = process.env.ROPSTEN_PROVIDER_URL
      break
    case RINKEBY_NETWORK_ID:
      privateKey = process.env.RINKEBY_PRIVATE_KEY
      mnemonic = process.env.RINKEBY_MNEMONIC
      if (!privateKey && !mnemonic) {
        throw 'Must have either RINKEBY_PRIVATE_KEY or RINKEBY_MNEMONIC env var'
      }
      if (!process.env.RINKEBY_PROVIDER_URL) {
        throw 'Missing RINKEBY_PROVIDER_URL env var'
      }
      providerUrl = process.env.RINKEBY_PROVIDER_URL
      break
    case LOCAL_NETWORK_ID:
      privateKey = process.env.LOCAL_PRIVATE_KEY
      mnemonic = process.env.LOCAL_MNEMONIC || DEFAULT_MNEMONIC
      providerUrl = 'http://localhost:8545'
      break
    case TEST_NETWORK_ID:
      privateKey = process.env.LOCAL_PRIVATE_KEY
      mnemonic = DEFAULT_MNEMONIC
      providerUrl = 'http://localhost:8545'
      break
    default:
      throw `Unsupported network id ${process.env.NETWORK_ID}`
  }

  const provider = new ethers.providers.JsonRpcProvider(providerUrl)

  if (privateKey) {
    signer = new ethers.Wallet(privateKey)
  } else {
    signer = new ethers.Wallet.fromMnemonic(mnemonic)
  }

  signer = signer.connect(provider)

  return { provider, signer }
}

const { provider, signer } = createProviderAndSigner()

const ERC20_ABI = [
  // Read-Only Functions
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  // Authenticated Functions
  'function transfer(address to, uint amount) returns (bool)',
  // Events
  'event Transfer(address indexed from, address indexed to, uint amount)',
]

const createTokenContract = (currency) => {
  let contract

  if (!Object.keys(currencies).includes(currency)) {
    throw new Error(`${currency} is not a supported currency`)
  }

  const addresses = currencies[currency]

  switch (networkId) {
    case MAINNET_NETWORK_ID:
      if (!addresses.mainnet) {
        throw new Error(`${currency} is not configured for mainnet`)
      }
      contract = new ethers.Contract(addresses.mainnet, ERC20_ABI, provider)
      break
    case RINKEBY_NETWORK_ID:
      if (!addresses.rinkeby) {
        throw new Error(`${currency} is not configured for rinkeby`)
      }
      contract = new ethers.Contract(addresses.rinkeby, ERC20_ABI, provider)
      break
    case LOCAL_NETWORK_ID:
      const definitions = JSON.parse(
        fs.readFileSync('contracts.localhost.json')
      )
      contract = new ethers.Contract(definitions.address, ERC20_ABI, provider)
    case TEST_NETWORK_ID:
      contract = new ContractMock()
      break
    default:
      throw `Unsupported network ID: ${process.env.NETWORK_ID}`
  }

  return contract
}

module.exports = {
  discordWebhookUrl,
  encryptionSecret,
  earlyLockupBonusRate,
  earlyLockupsEnabledUntil,
  earlyLockupsEnabled,
  lockupsEnabled,
  lockupBonusRate,
  lockupConfirmationTimeout,
  lockupDuration,
  networkId,
  otcPartnerEmails,
  port,
  clientUrl,
  sendgridFromEmail,
  sendgridApiKey,
  sessionSecret,
  unlockDate,
  largeTransferThreshold,
  largeTransferDelayMinutes,
  gasPriceMultiplier,
  transferConfirmationTimeout,
  otcRequestEnabled,
  provider,
  signer,
  createTokenContract,
}
