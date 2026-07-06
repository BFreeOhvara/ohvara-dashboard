import { useEffect, useState } from 'react'
import { formatInTimezone, timezoneAbbr, DEFAULT_TIMEZONE } from '../../lib/timezones'

// Actually-ticking clock (1s interval) tied to the viewing user's own
// Settings > Regional timezone — not a static timestamp that only updates
// on page refresh (Prompt 227). 24-hour, no seconds, plain text (Prompt 229).
export function LiveClock({ timezone }) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const tz = timezone || DEFAULT_TIMEZONE
  const time = formatInTimezone(new Date(nowMs).toISOString(), tz, {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })

  return (
    <span style={{
      fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {time} {timezoneAbbr(tz)}
    </span>
  )
}
