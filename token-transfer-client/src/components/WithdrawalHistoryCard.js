import React, { useContext } from 'react'

import { DataContext } from '@/providers/data'
import BorderedCard from '@/components/BorderedCard'

const WithdrawalHistoryCard = () => {
  const data = useContext(DataContext)

  return Object.keys(data.totals).map(currency => {
    if (data.grants.find(g => g.currency === currency) === undefined)
      return null
    return (
      <BorderedCard shadowed={true} key={currency}>
        <div className="row">
          <div className="col mb-2" style={{ fontSize: '18px' }}>
            Available Balance{' '}
            <strong className="ml-1">
              {data.config.isLocked
                ? 0
                : Number(
                  data.totals.vested[currency].minus(
                    data.totals.withdrawn[currency]
                  )
                ).toLocaleString()}
            </strong>{' '}
            <span
              className="ogn"
              style={{ fontSize: '14px', color: '#007cff' }}
            >
              OGN
            </span>
          </div>
        </div>
        <div className="row">
          <div className="col-12 col-md-4">
            <span className="text-muted">
              Total Withdrawn:{' '}
              <span className="text-nowrap">
                {Number(data.totals.withdrawn[currency]).toLocaleString()}
              </span>
              {currency}
            </span>
          </div>
          <div className="col-12 col-md-4">
            <span className="text-muted">
              Unvested:{' '}
              <span className="text-nowrap">
                {Number(data.totals.unvested[currency]).toLocaleString()}{' '}
                {currency}
              </span>
            </span>
          </div>
          <div className="col-12 col-md-4">
            <span className="text-muted">
              Total Purchase:{' '}
              <span className="text-nowrap">
                {Number(data.totals.granted[currency]).toLocaleString()}{' '}
                {currency}
              </span>
            </span>
          </div>
        </div>
      </BorderedCard>
    )
  })
}

export default WithdrawalHistoryCard
