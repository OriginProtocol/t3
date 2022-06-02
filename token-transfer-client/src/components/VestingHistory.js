import React, { useContext } from 'react'
import moment from 'moment'

import { vestingSchedule } from '@origin/token-transfer-server/src/lib/vesting'

import { DataContext } from '@/providers/data'

const VestingHistory = props => {
  const data = useContext(DataContext)

  const schedule = {}
  data.grants.forEach(grant => {
    vestingSchedule(props.user, grant).forEach(vest => {
      const dateKey = vest.date.format()
      if (schedule[dateKey] === undefined) schedule[dateKey] = {}
      schedule[dateKey][grant.currency] = schedule[dateKey][grant.currency]
        ? schedule[dateKey][grant.currency].plus(vest.amount)
        : vest.amount
    })
  })

  const tableRows = []
  for (const date of Object.keys(schedule).sort()) {
    const momentDate = moment(date)
    for (const currency of Object.keys(schedule[date])) {
      tableRows.push(
        <tr key={date}>
          <td className="pl-0" width="10px">
            <div
              className={`status-circle ${momentDate < moment.now() ? `bg-green` : ''
                }`}
            ></div>
          </td>
          <td className="text-nowrap" width="130px">
            {Number(schedule[date][currency]).toLocaleString()} {currency}
          </td>
          <td className="d-none d-sm-block">
            <span className="text-muted">
              {momentDate < moment.now() ? 'vested' : 'unvested'}
            </span>
          </td>
          <td className="text-right">{momentDate.format('L')}</td>
        </tr>
      )
    }
  }

  return (
    <>
      <h2 className="mb-4">Vesting Schedule</h2>
      <hr />
      <div className="table-card">
        <div className="scrolling-table">
          <table className="table mb-0">
            <tbody>{tableRows}</tbody>
          </table>
        </div>
      </div>
    </>
  )
}

export default VestingHistory
