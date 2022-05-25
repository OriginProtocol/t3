'use strict'

module.exports = {
  up: (queryInterface, Sequelize) => {
    // The transfer table already has a currency column from previous migrations
    queryInterface.addColumn('Grant', 'currency', {
      type: Sequelize.STRING,
      allowNull: false,
      default: 'OGN',
    })
    queryInterface.addColumn('Lockup', 'currency', {
      type: Sequelize.STRING,
      allowNull: false,
      default: 'OGN',
    })
  },

  down: (queryInterface, Sequelize) => {
    queryInterface.removeColumn('Grant', 'currency')
    queryInterface.removeColumn('Lockup', 'currency')
  },
}
