import { useEffect, useState } from 'react'
import { formatInTimezone, DEFAULT_TIMEZONE } from '../../lib/timezones'

// Actually-ticking clock (1s interval) tied to the viewing user's own
// Settings > Regional timezone — not a static timestamp that only updates
// on page refresh (Prompt 227). 12-hour + AM/PM, no seconds, filled box
// (same accent as the Call Now button) around the time only — no TZ
// abbreviation since this always shows the viewer's own local time by
// construction (Prompt 231 item F, filled per Prompt 232 item A).
export function LiveClock({ timezone }) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const tz = timezone || DEFAULT_TIMEZONE
  const time = formatInTimezone(new Date(nowMs).toISOString(), tz, {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })

  return (
    <span style={{
      display: 'inline-block',
      fontSize: 12, fontFamily: 'var(--font-mono)', color: '#fff',
      fontVariantNumeric: 'tabular-nums',
      background: 'var(--accent)', borderRadius: 6,
      padding: '4px 10px',
    }}>
      {time}
    </span>
  )
}
