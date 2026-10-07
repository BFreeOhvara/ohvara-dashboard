import { useEffect, useState } from 'react'
import { formatInTimezone, DEFAULT_TIMEZONE } from '../../lib/timezones'

// Prompt 714 — the Overview hero's big clock. Ticks like LiveClock (1s,
// viewer's Settings > Regional timezone) but bare: no filled chip, and AM/PM
// is its own span so it can be sized and coloured apart from the digits.
// Sizes come from the caller's classes (they change at the phone breakpoint).
export function DayClock({ timezone, className, style, periodClassName, periodStyle }) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const text = formatInTimezone(new Date(nowMs).toISOString(), timezone || DEFAULT_TIMEZONE, {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
  // "10:47 PM" (the gap may be a narrow no-break space, which \s matches).
  const [time, period] = text.split(/\s+/)

  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', ...style }}>
      {time}
      {period && <span className={periodClassName} style={{ letterSpacing: 0, ...periodStyle }}>{period}</span>}
    </span>
  )
}
