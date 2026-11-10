import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, usePlotArea, useXAxisScale, useYAxisScale } from 'recharts'
import { Seg } from '../template/kit'
import { CountUp, usd } from '../template/motion'
import { RANGES, rangeRows, headline, shortOf, fullOf, monthOf, dowOf, monoAt, monoSlopes } from './revTrend'
import '../template/chart936.css'
import './p943.css'

// P943 — Revenue like a stock line (Brayden picked Idea 1, Nov 10): the rolling 7-day revenue as one smooth blue line
// with a soft gradient under it, what Ohvara kept after costs as a dashed green line, and the gold gap between them is
// the costs. Header: the last 7 days' revenue, how it moved against the 7 days before, what was kept; range buttons
// 1W · 1M · 3M · 1Y · All. Hover any day for its 7 days: Revenue, Costs and Kept (P945: the hover glides).
//   roll: useAdmRevTrend().roll (adminshell/revTrend.js rolling rows)

const money = usd()
const kMoney = n => {
  const a = Math.abs(n)
  const s = a >= 1000 ? `$${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : `$${Math.round(a)}`
  return n < 0 ? `−${s}` : s
}
const signed = n => (n < 0 ? `−${money(-n)}` : money(n))

// P945 — the hover glides: the guide line and the tooltip follow the mouse (eased a little each frame), and the
// values are read off the same smooth curve the chart draws between days, so the numbers roll as you drag. The chart
// itself never re-renders on hover; this overlay does. Tooltip: Revenue · Costs (the gap) · Kept, nothing else.
function PlotProbe({ onArea, data }) {
  const a = usePlotArea()
  const xs = useXAxisScale()
  const ys = useYAxisScale()
  const ready = a && xs && ys
  const key = ready ? `${a.x}|${a.y}|${a.width}|${a.height}|${xs(data[0]?.date)}|${xs(data[data.length - 1]?.date)}|${ys(0)}|${ys(1000)}` : ''
  useEffect(() => {
    if (!ready) return
    onArea({ x: a.x, y: a.y, width: a.width, height: a.height, px: data.map(d => xs(d.date)), py: v => ys(v) })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

const EASE = 0.28 // share of the way to the mouse each frame: smooth, never laggy
function Glide({ data, area }) {
  const box = useRef(null)
  const goal = useRef(null)
  const cur = useRef(null)
  const raf = useRef(0)
  const [at, setAt] = useState(null) // fractional day index shown
  const n = data.length
  const rev = useMemo(() => data.map(d => d.revenue), [data])
  const kept = useMemo(() => data.map(d => d.kept), [data])
  const sRev = useMemo(() => monoSlopes(rev), [rev])
  const sKept = useMemo(() => monoSlopes(kept), [kept])
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const start = useRef(null)
  // One animation loop per chart: each frame eases the shown day toward the mouse, then stops once it's there.
  useEffect(() => {
    const loop = () => {
      raf.current = 0
      const g = goal.current
      if (g == null) return
      const c = cur.current
      const next = c == null || reduce ? g : c + (g - c) * EASE
      const done = Math.abs(g - next) <= 0.002
      cur.current = done ? g : next
      setAt(cur.current)
      if (!done) raf.current = requestAnimationFrame(loop)
    }
    start.current = () => { if (!raf.current) raf.current = requestAnimationFrame(loop) }
    return () => { cancelAnimationFrame(raf.current); raf.current = 0 }
  }, [reduce])
  if (!area || n < 2) return null
  const px = area.px
  const first = px[0]
  const span = (px[n - 1] - first) || 1
  // The days sit evenly on the axis (a point scale), so a pixel maps straight to a fractional day.
  const xOf = f => { const i = Math.min(n - 2, Math.floor(f)); return px[i] + (px[i + 1] - px[i]) * (f - i) }
  const yOf = area.py
  const move = e => {
    const r = box.current.getBoundingClientRect()
    goal.current = Math.max(0, Math.min(n - 1, ((e.clientX - r.left - first) / span) * (n - 1)))
    start.current?.()
  }
  const leave = () => { goal.current = null; cur.current = null; cancelAnimationFrame(raf.current); raf.current = 0; setAt(null) }
  const vRev = at == null ? 0 : monoAt(rev, at, sRev)
  const vKept = at == null ? 0 : monoAt(kept, at, sKept)
  const x = at == null ? 0 : xOf(at)
  const day = at == null ? null : data[Math.round(at)]
  const flip = at != null && x > area.x + area.width * 0.62
  return (
    <div ref={box} className="rs-glide" onPointerMove={move} onPointerDown={move} onPointerLeave={leave}>
      {at != null && <>
        <svg className="rs-glide-svg" aria-hidden="true">
          <line x1={x} x2={x} y1={area.y} y2={area.y + area.height} className="rs-guide" />
          <circle cx={x} cy={yOf(vKept)} r={4} className="rs-dot is-kept" />
          <circle cx={x} cy={yOf(vRev)} r={5.5} className="rs-dot is-rev" />
        </svg>
        <div className={`ox-tip rs-tip${flip ? ' is-left' : ''}`} role="status" style={{ '--x': `${x}px`, '--y': `${area.y + 6}px` }}>
          <b>{day ? fullOf(day.date) : ''} · last 7 days</b>
          <ul>
            <li><i className="is-rev" /><span>Revenue</span><b className="tp-money">{money(Math.round(vRev))}</b></li>
            <li><i className="is-gap" /><span>Costs (the gap)</span><b className="tp-money">{money(Math.round(vRev) - Math.round(vKept))}</b></li>
            <li><i className="is-kept" /><span>Kept</span><b className="tp-money">{signed(Math.round(vKept))}</b></li>
          </ul>
        </div>
      </>}
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
  const [area, setArea] = useState(null)

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
                <PlotProbe onArea={setArea} data={data} />
                <Area type="monotone" dataKey="revenue" stroke="none" fill={`url(#${uid}-rev)`} activeDot={false} isAnimationActive={anim} animationDuration={700} />
                <Area type="monotone" dataKey="gap" stroke="none" fill="var(--rs-gap)" fillOpacity={0.42} activeDot={false} isAnimationActive={anim} animationDuration={700} />
                <Line type="monotone" dataKey="kept" stroke="var(--rs-kept)" strokeWidth={2.2} strokeDasharray="5 4" dot={false}
                  activeDot={false} isAnimationActive={anim} animationDuration={700} />
                <Line type="monotone" dataKey="revenue" stroke="var(--rs-rev)" strokeWidth={3.25} strokeLinecap="round" isAnimationActive={anim} animationDuration={700}
                  dot={p => (p.index === last ? <circle key="end" cx={p.cx} cy={p.cy} r={4.5} fill="var(--rs-rev)" stroke="var(--ox-dot-ring)" strokeWidth={2} /> : <g key={p.index} />)}
                  activeDot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : null}
          {data.length ? <Glide key={range} data={data} area={area} /> : <p className="rs-empty">No revenue yet. The line starts with the first plan fee.</p>}
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
