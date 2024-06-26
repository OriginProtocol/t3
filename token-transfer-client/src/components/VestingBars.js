import React, { useContext, useState } from 'react'
import moment from 'moment'
import numeral from 'numeral'
import BigNumber from 'bignumber.js'

import { DataContext } from '@/providers/data'

const VestingBars = ({ user }) => {
  const data = useContext(DataContext)

  const [displayPopover, setDisplayPopover] = useState({})

  if (!data.grants || data.grants.length === 0) {
    return null
  }

  const now = moment()

  // Momentize all the dates
  const grants = data.grants.map(grant => {
    return {
      ...grant,
      start: moment(grant.start),
      end: moment(grant.end),
      cancelled: grant.cancelled ? moment(grant.cancelled) : grant.cancelled
    }
  })

  const firstStartDate = moment(Math.min(...grants.map(g => g.start)))
  const lastEndDate = moment(Math.max(...grants.map(g => g.end)))
  const totalDuration = lastEndDate - firstStartDate

  const generateMarkers = () => {
    const maxMarkers = 4
    if (grants.length > 1 || user.employee) {
      return generateMonthMarkers(maxMarkers)
    } else {
      return generateAmountMarkers(maxMarkers)
    }
  }

  const generateMonthMarkers = maxMarkers => {
    // Extract x points (months) across the duration to display between first
    // start date and last end date to display
    const interim = firstStartDate.clone()
    const intermediateMonths = []
    while (
      lastEndDate > interim ||
      interim.format('M') === lastEndDate.format('M')
    ) {
      intermediateMonths.push(interim.format('YYYY-MM'))
      interim.add(1, 'month')
    }
    const months = intermediateMonths.filter((e, i, arr) => {
      return (
        i !== 0 &&
        i !== arr.length - 1 &&
        i % Math.floor(arr.length / maxMarkers) === 0
      )
    })

    return months.map(month => {
      return {
        label: moment(month).format('MMM YYYY'),
        left: ((moment(month) - firstStartDate) / totalDuration) * 100
      }
    })
  }

  const generateAmountMarkers = maxMarkers => {
    return [...Array(maxMarkers + 1).keys()].map(i => {
      return {
        label: numeral((grants[0].amount / maxMarkers) * i).format('0.0a'),
        left: (100 / maxMarkers) * i
      }
    })
  }

  const handleTogglePopover = (event, grantId) => {
    // Calculate a left offset to make the popover display at the point of the
    // mouse click
    const leftOffset =
      document.getElementById('main').offsetLeft +
      document.getElementById('vestingBars').offsetLeft +
      50
    setDisplayPopover({
      ...displayPopover,
      [grantId]: displayPopover[grantId] ? false : event.clientX - leftOffset
    })
  }

  return (
    <div className="mb-5">
      <h2 style={{ marginBottom: '2.5rem' }}>Vesting Progress</h2>
      {Object.keys(data.totals.granted).map(currency => {
        const total = BigNumber(data.totals.vested[currency]).plus(
          BigNumber(data.totals.unvested[currency])
        )
        const currencyGrants = grants.filter(g => g.currency === currency)
        if (currencyGrants.length === 0) return null
        return (
          <div key={currency}>
            <div id="vestingBars" style={{ position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  right: '20px',
                  marginTop: '-1.5rem'
                }}
              >
                <strong>{Number(total).toLocaleString()}</strong>{' '}
                <span className="ogn">{currency}</span>
              </div>
              {currencyGrants.map(grant => {
                // Calculate the percentage of the grant that is complete with a
                // upper bound of 100. If the grant is cancelled, the completion stops once
                // the current time is past the concellation date.
                const t = grant.cancelled && grant.cancelled < now ? grant.cancelled : now
                const complete = Math.min(
                  ((t - grant.start) / (grant.end - grant.start)) * 100,
                  100
                )
                // Calculate the width of the grant relative to the width of the
                // total component
                const width = ((grant.end - grant.start) / totalDuration) * 100
                // Calculate the left indentation from the left side of the component
                const left =
                  ((grant.start - firstStartDate) / totalDuration) * 100

                return (
                  <div
                    className="progress mt-3 pointer"
                    key={grant.id}
                    style={{ width: `${width}%`, marginLeft: `${left}%` }}
                    onClick={event => handleTogglePopover(event, grant.id)}
                  >
                    <div
                      className="progress-bar bg-green"
                      role="progressbar"
                      style={{ width: `${complete}%`, zIndex: 10 }}
                    />
                    {displayPopover[grant.id] && (
                      <div
                        className="popover"
                        style={{
                          left: `${displayPopover[grant.id]}px`,
                          top: '10px'
                        }}
                      >
                        <div
                          className="cover"
                          onClick={event =>
                            handleTogglePopover(event, grant.id)
                          }
                        />
                        <div>
                          <strong>Start</strong> {grant.start.format('L')}
                        </div>
                        {grant.cliff && (
                          <div>
                            <strong>Cliff</strong> {grant.cliff.format('L')}
                          </div>
                        )}
                        <div>
                          <strong>End</strong> {grant.end.format('L')}
                        </div>
                        <div>
                          <strong>Grant</strong>{' '}
                          {Number(grant.amount).toLocaleString()}{' '}
                          <span className="ogn">{grant.currency}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              {generateMarkers().map(marker => {
                const style = {
                  position: 'absolute',
                  left: `${marker.left}%`,
                  top: 0,
                  height: `${1 + 2 * grants.length}rem`,
                  marginTop: '-1rem',
                  pointerEvents: 'none' // Stop absolute positioning from stealing clicks
                }
                return (
                  <div key={marker.label} style={style}>
                    <div
                      style={{
                        borderLeft: '1px solid #dbe6eb',
                        height: '100%',
                        width: 0
                      }}
                    ></div>
                    <div style={{ marginLeft: '-50%' }}>
                      <small className="text-muted">{marker.label}</small>
                    </div>
                  </div>
                )
              })}
            </div>
            <div
              className="row"
              style={{
                marginTop: `${4 + 0.5 * grants.length}rem`,
                marginBottom: `4rem`
              }}
            >
              <div className="col-12 col-sm-6">
                <div className="status-circle bg-green mr-2"></div>
                <span className=" text-muted">
                  {Number(data.totals.vested[currency]).toLocaleString()}{' '}
                  {currency} vested
                </span>
              </div>
              <div className="col-12 col-sm-6">
                <div className="status-circle mr-2"></div>
                <span className=" text-muted">
                  {Number(data.totals.unvested[currency]).toLocaleString()}{' '}
                  {currency} unvested or cancelled
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default VestingBars
