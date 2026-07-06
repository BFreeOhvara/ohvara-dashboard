import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { formatInTimezone, timezoneAbbr, DEFAULT_TIMEZONE } from '../../lib/timezones'

// Actually-ticking clock (1s interval) tied to the viewing user's own
// Settings > Regional timezone — not a static timestamp that only updates
// on page refresh (Prompt 227).
export function LiveClock({ timezone }) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const tz = timezone || DEFAULT_TIMEZONE
  const time = formatInTimezone(new Date(nowMs).toISOString(), tz, {
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  })

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
      fontVariantNumeric: 'tabular-nums',
    }}>
      <Clock size={12} />
      {time} {timezoneAbbr(tz)}
    </span>
  )
}
