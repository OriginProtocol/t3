'use strict'

module.exports = {
  up: (queryInterface, Sequelize) => {
    // The transfer table already has a currency column from previous migrations
    return Promise.all([
      queryInterface.addColumn('t3_grant', 'currency', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'OGN',
      }),
      queryInterface.addColumn('t3_lockup', 'currency', {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'OGN',
      })
    ])
  },

  down: (queryInterface, Sequelize) => {
    return Promise.all([
      queryInterface.removeColumn('t3_grant', 'currency'),
      queryInterface.removeColumn('t3_lockup', 'currency')
    ])
  },
}
