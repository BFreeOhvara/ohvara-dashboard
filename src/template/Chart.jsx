import { useId, useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceArea, ReferenceLine } from 'recharts'
import './chart936.css'

// P936 — the one chart for every role (admin Overview, Revenue, agent Delivered, VA Hours, Lines & pods).
// Built the shadcn/ui charts way: Recharts (already in the app) with colours as CSS tokens, a soft grid, a gradient
// fill in the brand colour, a clean tooltip on hover, bars that grow in, the legend as small chips. Future days stay
// on the axis as faint labels with no bar, and there are no grey empty tracks.
//
// data:   [{ name, later?, today?, [series.key]: number }]   (a `later` row draws no bar and a faint label)
// series: [{ key, label, color }]  color = a CSS colour, usually var(--ox-1..4); stacked bars stack in this order
// kind:   'bar' (default) or 'area' (one smooth line with a gradient under it; band = { lo, hi } draws a range)
// tone:   'plain' or 'fill' (on a coloured card: every colour is drawn from the card's own ink)
// tip:    row => [[label, text, color?]] to replace the tooltip lines; format formats numbers (axis and tooltip)
// overlay: extra Recharts elements drawn over an area chart (P991: this week's dashed "so far" line and projected point);
// reach:  the highest value the overlay draws, so the y-axis has room for it

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// A bar segment with rounded corners only where it is the top (or bottom) of its stack.
function segPath(x, y, w, h, top, bottom, r) {
  const rt = top ? Math.min(r, w / 2, h) : 0
  const rb = bottom ? Math.min(r, w / 2, h - rt) : 0
  return `M${x},${y + rt}` +
    (rt ? ` Q${x},${y} ${x + rt},${y}` : '') + ` L${x + w - rt},${y}` + (rt ? ` Q${x + w},${y} ${x + w},${y + rt}` : '') +
    ` L${x + w},${y + h - rb}` + (rb ? ` Q${x + w},${y + h} ${x + w - rb},${y + h}` : '') + ` L${x + rb},${y + h}` +
    (rb ? ` Q${x},${y + h} ${x},${y + h - rb}` : '') + ' Z'
}

function Tick({ x, y, payload, index, rows, compact }) {
  const row = rows[payload?.index ?? index] || rows.find(r => r.name === payload?.value) || {}
  const cls = `ox-tick${row.later ? ' is-later' : ''}${row.today ? ' is-today' : ''}`
  return (
    <g transform={`translate(${x},${y})`}>
      <text className={cls} textAnchor="middle" dy={compact ? 12 : 14}>{payload.value}</text>
      {row.today && <circle className="ox-today-dot" cx="0" cy={compact ? 19 : 22} r="2" />}
    </g>
  )
}

function TipBox({ active, payload, label, series, format, tip }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  if (row.later) return null
  const lines = tip ? tip(row) : series.map(s => [s.label, format(row[s.key] || 0), s.color])
  return (
    <div className="ox-tip" role="status">
      <b>{row.full || label}</b>
      <ul>{lines.map(([k, v, c]) => <li key={k}>{c ? <i style={{ background: c }} /> : <i className="is-none" />}<span>{k}</span><b className="tp-num">{v}</b></li>)}</ul>
    </div>
  )
}

export function ChartKey({ series, className = '' }) {
  return (
    <ul className={`ox-key ${className}`.trim()}>
      {series.map(s => <li key={s.key}><i style={{ background: s.color }} aria-hidden="true" />{s.label}</li>)}
    </ul>
  )
}

export default function Chart({ data, series, kind = 'bar', stacked = false, tone = 'plain', height = 160, label, format = n => String(n),
  yAxis = true, legend = true, band = null, tip = null, compact = false, className = '', overlay = null, reach = 0 }) {
  const raw = useId()
  const uid = `ox${raw.replace(/[^a-zA-Z0-9]/g, '')}`
  const anim = !reduced()
  const rows = useMemo(() => data.map(d => (d.later ? { ...d, ...Object.fromEntries(series.map(s => [s.key, null])) } : d)), [data, series])
  const top = useMemo(() => {
    const sums = rows.filter(r => !r.later).map(r => (stacked ? series.reduce((t, s) => t + (r[s.key] || 0), 0) : Math.max(0, ...series.map(s => r[s.key] || 0))))
    return Math.max(band?.hi || 0, reach || 0, ...sums, 0)
  }, [rows, series, stacked, band, reach])
  const domainTop = top > 0 ? top * 1.12 : 1
  const axisFmt = n => (n === 0 ? '0' : format(n))
  const cats = rows.length
  const barSize = Math.max(10, Math.min(compact ? 22 : 34, Math.round(420 / Math.max(cats, 1))))

  // Which series is the top / bottom drawn segment of each row (so only the outer corners round).
  const edge = row => {
    const on = series.filter(s => (row[s.key] || 0) > 0).map(s => s.key)
    return { first: on[0], last: on[on.length - 1] }
  }
  const shapeFor = key => props => {
    const { x, y, width, height: h, payload } = props
    if (!h || h <= 0 || payload?.later) return null
    const e = stacked ? edge(payload) : { first: key, last: key }
    return <path d={segPath(x, y, width, h, e.last === key, e.first === key, compact ? 5 : 7)} fill={`url(#${uid}-${key})`} className="ox-seg" />
  }

  const common = { data: rows, margin: { top: 8, right: 4, bottom: 0, left: 0 }, accessibilityLayer: false }
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--ox-grid)" strokeDasharray="0" />
      <XAxis dataKey="name" axisLine={false} tickLine={false} interval={0} height={compact ? 24 : 30} tick={p => <Tick {...p} rows={rows} compact={compact} />} />
      <YAxis hide={!yAxis} width={yAxis ? 44 : 0} axisLine={false} tickLine={false} tickCount={3} domain={[0, domainTop]} tickFormatter={axisFmt} tick={{ className: 'ox-ytick' }} allowDecimals={false} />
      <Tooltip cursor={{ fill: 'var(--ox-cursor)', radius: 8 }} wrapperStyle={{ outline: 'none', zIndex: 30 }} isAnimationActive={false}
        content={p => <TipBox {...p} series={series} format={format} tip={tip} />} />
    </>
  )
  const defs = (
    <defs>
      {series.map(s => (
        // Bars: one light fade over the whole plot height (userSpaceOnUse), so a stack reads as one bar, not stripes.
        <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1={kind === 'area' ? '0' : '0%'} x2="0" y2={kind === 'area' ? '1' : '100%'}
          gradientUnits={kind === 'area' ? 'objectBoundingBox' : 'userSpaceOnUse'}>
          <stop offset="0" stopColor={s.color} stopOpacity={kind === 'area' ? 0.42 : 1} />
          <stop offset="1" stopColor={s.color} stopOpacity={kind === 'area' ? 0.02 : 0.72} />
        </linearGradient>
      ))}
    </defs>
  )

  return (
    <figure className={`ox-chart is-${tone}${compact ? ' is-compact' : ''} ${className}`.trim()} style={{ '--ox-h': typeof height === 'number' ? `${height}px` : height }}
      role="img" aria-label={label}>
      <div className="ox-plot" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%" minHeight={60} initialDimension={{ width: 320, height: typeof height === 'number' ? height : 160 }}>
          {kind === 'area' ? (
            <AreaChart {...common}>
              {defs}
              {axes}
              {band && <ReferenceArea y1={band.lo} y2={band.hi} fill="var(--ox-band)" stroke="none" ifOverflow="extendDomain" />}
              {band && <ReferenceLine y={band.hi} stroke="var(--ox-band-edge)" strokeDasharray="4 4" />}
              {band && <ReferenceLine y={band.lo} stroke="var(--ox-band-edge)" strokeDasharray="4 4" />}
              {series.map(s => (
                <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2.5} fill={`url(#${uid}-${s.key})`} connectNulls={false}
                  dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--ox-dot-ring)', fill: s.color }} isAnimationActive={anim} animationDuration={900} animationEasing="ease-out" />
              ))}
              {overlay}
            </AreaChart>
          ) : (
            <BarChart {...common} barCategoryGap="28%">
              {defs}
              {axes}
              {series.map(s => (
                <Bar key={s.key} dataKey={s.key} stackId={stacked ? 'a' : undefined} maxBarSize={barSize} fill={s.color} shape={shapeFor(s.key)}
                  isAnimationActive={anim} animationBegin={80} animationDuration={760} animationEasing="ease-out" />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {legend && series.length > 1 && <ChartKey series={series} />}
    </figure>
  )
}
