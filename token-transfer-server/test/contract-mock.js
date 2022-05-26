const ethers = require('ethers')
const chai = require('chai')
const expect = chai.expect

class ContractMock {
  constructor() {
    this.balance = ethers.BigNumber.from('1000000000000000000000000000')
  }

  setBalance(amount) {
    this.balance = amount
  }

  async balanceOf(account) {
    return this.balance
  }

  connect() {
    // Allow chaining
    return this
  }

  async transfer(to, amount) {
    // Fake receipt
    return {
      hash: '0x0',
    }
  }
}

module.exports = ContractMock
