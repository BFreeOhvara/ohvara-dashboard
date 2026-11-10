import { useId, useMemo, useState } from 'react'
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { Seg } from '../template/kit'
import { CountUp, usd } from '../template/motion'
import { PRICES } from '../lib/priceBook.js'
import { deskAdminLabel } from '../lib/bookingDesk'
import { RANGES, rangeRows, headline, shortOf, fullOf, monthOf, dowOf } from './revTrend'
import '../template/chart936.css'
import './p943.css'

// P943 — Revenue like a stock line (Brayden picked Idea 1, Nov 10): the rolling 7-day revenue as one smooth blue line
// with a soft gradient under it, what Ohvara kept after costs as a dashed green line, and the gold gap between them is
// the costs. Header: the last 7 days' revenue, how it moved against the 7 days before, what was kept; range buttons
// 1W · 1M · 3M · 1Y · All. Hover any day for its 7 days: Revenue, Kept, Costs and the fee breakdown.
//   roll: useAdmRevTrend().roll (adminshell/revTrend.js rolling rows)

const money = usd()
const kMoney = n => {
  const a = Math.abs(n)
  const s = a >= 1000 ? `$${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : `$${Math.round(a)}`
  return n < 0 ? `−${s}` : s
}
const signed = n => (n < 0 ? `−${money(-n)}` : money(n))

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return (
    <div className="ox-tip rs-tip" role="status">
      <b>{fullOf(r.date)} · last 7 days</b>
      <ul>
        <li><i className="is-rev" /><span>Revenue</span><b className="tp-money">{money(r.revenue)}</b></li>
        <li><i className="is-kept" /><span>Kept (profit)</span><b className="tp-money">{signed(r.kept)}</b></li>
        <li><i className="is-gap" /><span>Costs (the gap)</span><b className="tp-money">{money(r.costs)}</b></li>
      </ul>
      <ul className="rs-tip-sub" aria-label="Revenue by fee">
        <li><span>Plan fees</span><b className="tp-money">{money(r.plans)}</b></li>
        <li><span>{deskAdminLabel(PRICES.leadFee)}</span><b className="tp-money">{money(r.fee)}</b></li>
        <li><span>Setup fees</span><b className="tp-money">{money(r.setup)}</b></li>
      </ul>
    </div>
  )
}

// A round y-axis top a little above the highest point (and a bottom below 0 when a week ran at a loss).
function niceMax(v) {
  if (v <= 0) return 100
  const step = 10 ** Math.floor(Math.log10(v)) / 2
  return Math.ceil((v * 1.06) / step) * step
}

export default function RevenueStock({ roll }) {
  const [range, setRange] = useState('1m')
  const raw = useId()
  const uid = `rs${raw.replace(/[^a-zA-Z0-9]/g, '')}`
  const data = useMemo(() => rangeRows(roll, range), [roll, range])
  const h = headline(roll)
  const r = RANGES.find(x => x.key === range)
  const long = data.length > 120
  const tick = v => (range === '1w' ? `${dowOf(v)} ${shortOf(v).split(' ')[1]}` : long ? monthOf(v) : shortOf(v))
  // Axis dates like the picture: every day on 1W, every 7 days back from today on 1M, every 14 on 3M, the 1st of
  // each month (every 2nd or 3rd on a long All) beyond.
  const ticks = useMemo(() => {
    if (range === '1w') return data.map(d => d.date)
    if (!long) { const step = data.length > 40 ? 14 : 7; return data.filter((_, i) => (data.length - 1 - i) % step === 0).map(d => d.date) }
    const firsts = data.filter(d => d.date.endsWith('-01')).map(d => d.date)
    const every = firsts.length > 14 ? 3 : firsts.length > 7 ? 2 : 1
    return firsts.filter((_, i) => (firsts.length - 1 - i) % every === 0)
  }, [data, range, long])
  const top = niceMax(Math.max(0, ...data.map(d => d.revenue)))
  const low = Math.min(0, ...data.map(d => d.kept))
  const bottom = low < 0 ? -niceMax(-low) : 0
  const last = data.length - 1
  const up = h.pct == null || h.pct >= 0
  const anim = !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const end = data[last]

  return (
    <div className="rs">
      <div className="rs-head">
        <div className="rs-num">
          <b className="tp-money rs-big"><CountUp value={h.revenue} format={money} /></b>
          <span className="rs-side">
            {h.pct != null
              ? <i className={`rs-pill is-${up ? 'up' : 'down'}`}><span aria-hidden="true">{up ? '▲' : '▼'}</span> {Math.abs(h.pct)}% vs the 7 days before</i>
              : <i className="rs-pill is-flat">No 7 days before yet</i>}
            <small>last 7 days · <b className="tp-money">{signed(h.kept)}</b> kept after costs</small>
          </span>
        </div>
        <Seg label="Chart range" className="rs-range" value={range} onChange={setRange} options={RANGES.map(x => ({ key: x.key, label: x.label }))} />
      </div>
      <figure className="ox-chart is-plain rs-fig" role="img"
        aria-label={`Revenue over the last 7 days, day by day, ${r.text}${end ? `: ${money(end.revenue)} now, ${signed(end.kept)} kept, ${money(end.costs)} costs` : ''}`}>
        <div className="ox-plot rs-plot" aria-hidden="true">
          {data.length ? (
            <ResponsiveContainer width="100%" height="100%" minHeight={200} initialDimension={{ width: 720, height: 300 }}>
              <ComposedChart key={range} data={data} margin={{ top: 12, right: 10, bottom: 0, left: 0 }} accessibilityLayer={false}>
                <defs>
                  <linearGradient id={`${uid}-rev`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--rs-rev)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--rs-rev)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--ox-grid)" strokeDasharray="3 4" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tickMargin={10} ticks={ticks} interval={0} tickFormatter={tick} tick={{ className: 'ox-tick' }} />
                <YAxis width={48} axisLine={false} tickLine={false} tickCount={5} domain={[bottom, top]} tickFormatter={kMoney} tick={{ className: 'ox-ytick' }} />
                <Tooltip cursor={{ stroke: 'var(--ox-axis)', strokeOpacity: 0.55, strokeWidth: 1 }} wrapperStyle={{ outline: 'none', zIndex: 30 }}
                  isAnimationActive={false} content={p => <Tip {...p} />} />
                <Area type="monotone" dataKey="revenue" stroke="none" fill={`url(#${uid}-rev)`} activeDot={false} isAnimationActive={anim} animationDuration={700} />
                <Area type="monotone" dataKey="gap" stroke="none" fill="var(--rs-gap)" fillOpacity={0.34} activeDot={false} isAnimationActive={anim} animationDuration={700} />
                <Line type="monotone" dataKey="kept" stroke="var(--rs-kept)" strokeWidth={2} strokeDasharray="5 4" dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--ox-dot-ring)', fill: 'var(--rs-kept)' }} isAnimationActive={anim} animationDuration={700} />
                <Line type="monotone" dataKey="revenue" stroke="var(--rs-rev)" strokeWidth={2.6} isAnimationActive={anim} animationDuration={700}
                  dot={p => (p.index === last ? <circle key="end" cx={p.cx} cy={p.cy} r={4.5} fill="var(--rs-rev)" stroke="var(--ox-dot-ring)" strokeWidth={2} /> : <g key={p.index} />)}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--ox-dot-ring)', fill: 'var(--rs-rev)' }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <p className="rs-empty">No revenue yet. The line starts with the first plan fee.</p>}
        </div>
        <ul className="ox-key rs-key">
          <li><i className="is-rev" aria-hidden="true" />Revenue (last 7 days)</li>
          <li><i className="is-kept" aria-hidden="true" />Kept after costs</li>
          <li><i className="is-gap" aria-hidden="true" />Costs (the gap)</li>
        </ul>
      </figure>
    </div>
  )
}
