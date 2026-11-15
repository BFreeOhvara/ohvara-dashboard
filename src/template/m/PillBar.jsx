import { useEffect, useRef } from 'react'
import { useEdgeFade } from './useEdgeFade'
import './p1015.css'

// P1015 — the phone's ONE-ROW pill filter. One rounded bar, the options side by side, the chosen one filled. It never
// wraps: short labels first, and if they still don't fit the row scrolls sideways inside the bar with a soft fade at
// the edge that has more. Phone screens only (the desktop's own tabs are untouched).
// value = the chosen key, or null/'' for nothing chosen (= everything shown). With `clear` (the default) tapping the
// chosen pill again clears it, so no "All" pill is needed. Pass clear={false} for a switch that always has one chosen.
// options: [{ key, label, count?, title?, hue? }]; a hue (a phone tone: sky, apricot ...) adds that colour's dot. `kind`: 'filter' (a group of toggle buttons) or 'tabs' (a tablist).
export default function PillBar({ options, value = null, onChange, label, clear = true, kind = 'filter', className = '', style }) {
  const box = useRef(null)
  const { fade, onScroll } = useEdgeFade(box, [options.length, value])
  // The chosen pill scrolls into view (inside the bar only, the page doesn't move).
  useEffect(() => {
    const el = box.current, on = el?.querySelector('.is-on')
    if (!el || !on) return
    const to = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2
    if (typeof el.scrollTo === 'function') el.scrollTo({ left: Math.max(0, to), behavior: 'smooth' })
    else el.scrollLeft = Math.max(0, to)
  }, [value])
  const tabs = kind === 'tabs'
  return (
    <div
      ref={box} onScroll={onScroll} style={style}
      className={`pb-bar ma-rise${fade}${className ? ` ${className}` : ''}`}
      role={tabs ? 'tablist' : 'group'} aria-label={label}
    >
      {options.map(o => {
        const on = value === o.key
        return (
          <button
            key={o.key} type="button" title={o.title}
            {...(tabs ? { role: 'tab', 'aria-selected': on } : { 'aria-pressed': on })}
            className={`pb-pill${o.hue ? ` is-${o.hue}` : ''}${on ? ' is-on' : ''}`}
            onClick={() => onChange(on && clear ? null : o.key)}
          >
            {o.hue && <i className="pb-dot" aria-hidden="true" />}
            <span className="pb-w">{o.label}</span>
            {o.count != null && <span className="pb-n tp-num">{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
