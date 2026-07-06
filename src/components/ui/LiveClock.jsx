import { useEffect, useState } from 'react'
import { formatInTimezone, DEFAULT_TIMEZONE } from '../../lib/timezones'

// Actually-ticking clock (1s interval) tied to the viewing user's own
// Settings > Regional timezone — not a static timestamp that only updates
// on page refresh (Prompt 227). 12-hour + AM/PM, no seconds, bordered box
// around the time only — no TZ abbreviation since this always shows the
// viewer's own local time by construction (Prompt 231 item F).
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
      fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
      fontVariantNumeric: 'tabular-nums',
      border: '0.5px solid var(--border)', borderRadius: 6,
      padding: '4px 10px',
    }}>
      {time}
    </span>
  )
}
