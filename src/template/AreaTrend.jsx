import { useId, useMemo, useState } from 'react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { Select } from './Select'
import { TREND_RANGES, trendRows } from './leadTrend'
import './chart936.css'
import './areatrend942.css'

// P942 — the Overview leads chart for every role, built as shadcn/ui's "Area Chart - Interactive" (Brayden picked it,
// Nov 10): layered smooth areas with a soft gradient (the first series is the light one behind, the last the dark one
// in front), a range dropdown top right (This week · Last 30 days · Last 3 months), a dated axis, a hover tooltip with
// every series, and legend chips with the range's totals. It takes all the height its box has left (flex), so the box
// never has an empty bottom half.
//   rows:   dailyCounts()/sampleTrend() rows (src/template/leadTrend.js), 91 days ending today
//   series: [{ key, label, color }] back to front; color = a CSS colour, usually var(--ox-*)
//   head:   what sits left of the dropdown (the numbers)

function TipBox({ active, payload, series }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  if (row.later) return null
  return (
    <div className="ox-tip" role="status">
      <b>{row.full}</b>
      <ul>{series.slice().reverse().map(s => <li key={s.key}><i style={{ background: s.color }} /><span>{s.label}</span><b className="tp-num">{row[s.key] ?? 0}</b></li>)}</ul>
    </div>
  )
}

export default function AreaTrend({ rows, series, todayIso, head = null, label = 'Leads', initial = 'week', className = '' }) {
  const [range, setRange] = useState(initial)
  const raw = useId()
  const uid = `at${raw.replace(/[^a-zA-Z0-9]/g, '')}`
  const keyList = series.map(s => s.key).join()
  const keys = useMemo(() => keyList.split(','), [keyList])
  const data = useMemo(() => trendRows(rows, range, todayIso, keys), [rows, range, todayIso, keys])
  const totals = Object.fromEntries(keys.map(k => [k, data.reduce((t, r) => t + (r[k] || 0), 0)]))
  const top = Math.max(1, ...data.map(r => Math.max(...keys.map(k => r[k] || 0))))
  const week = range === 'week'
  const rangeText = TREND_RANGES.find(r => r.value === range)?.label || ''
  const anim = !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

  return (
    <div className={`ox-trend ${className}`.trim()}>
      <div className="ox-trend-bar">
        <div className="ox-trend-head">{head}</div>
        <Select className="ox-trend-range" label={`${label}: range`} value={range} onChange={setRange} options={TREND_RANGES} />
      </div>
      <figure className="ox-chart is-plain ox-trend-fig" role="img"
        aria-label={`${label}, ${rangeText.toLowerCase()}: ${series.map(s => `${totals[s.key]} ${s.label.toLowerCase()}`).join(', ')}`}>
        <div className="ox-plot ox-trend-plot" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%" minHeight={120} initialDimension={{ width: 480, height: 220 }}>
            <AreaChart key={range} data={data} margin={{ top: 10, right: 6, bottom: 0, left: 0 }} accessibilityLayer={false}>
              <defs>
                {series.map((s, i) => (
                  <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={s.color} stopOpacity={i === series.length - 1 ? 0.6 : 0.34} />
                    <stop offset="95%" stopColor={s.color} stopOpacity={0.04} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke="var(--ox-grid)" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tickMargin={8} minTickGap={week ? 4 : 28} interval={week ? 0 : 'preserveStartEnd'}
                tickFormatter={v => data.find(r => r.date === v)?.name || v} tick={{ className: 'ox-tick' }} />
              <YAxis width={34} axisLine={false} tickLine={false} tickCount={4} allowDecimals={false} domain={[0, Math.ceil(top * 1.15)]} tick={{ className: 'ox-ytick' }} />
              <Tooltip cursor={{ stroke: 'var(--ox-axis)', strokeOpacity: 0.35, strokeDasharray: '3 3' }} wrapperStyle={{ outline: 'none', zIndex: 30 }}
                isAnimationActive={false} content={p => <TipBox {...p} series={series} />} />
              {series.map((s, i) => (
                <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={i === series.length - 1 ? 2.4 : 1.8}
                  fill={`url(#${uid}-${s.key})`} connectNulls={false} dot={week ? { r: 2.5, strokeWidth: 0, fill: s.color } : false}
                  activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'var(--ox-dot-ring)', fill: s.color }} isAnimationActive={anim} animationDuration={700} animationEasing="ease-out" />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <ul className="ox-key ox-trend-key">
          {series.slice().reverse().map(s => <li key={s.key}><i style={{ background: s.color }} aria-hidden="true" />{s.label}<b className="tp-num">{totals[s.key]}</b></li>)}
          <li className="is-range">{rangeText}</li>
        </ul>
      </figure>
    </div>
  )
}
