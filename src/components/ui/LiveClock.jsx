import { useEffect, useState } from 'react'
import { formatInTimezone, DEFAULT_TIMEZONE } from '../../lib/timezones'

// Actually-ticking clock (1s interval) tied to the viewing user's own
// Settings > Regional timezone — not a static timestamp that only updates
// on page refresh (Prompt 227). 12-hour + AM/PM, no seconds, filled box
// (same accent as the Call Now button) around the time only — no TZ
// abbreviation since this always shows the viewer's own local time by
// construction (Prompt 231 item F, filled per Prompt 232 item A).
export function LiveClock({ timezone, large = false }) {
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
    // Prompt 669 — Restorix's clock chip (rounded-lg accent fill, mono).
    <span style={{
      display: 'inline-block',
      fontSize: large ? 44 : 15, fontWeight: large ? 600 : 500, fontFamily: 'var(--font-mono)', color: '#fff',
      fontVariantNumeric: 'tabular-nums', lineHeight: large ? 1 : undefined, letterSpacing: large ? '-0.02em' : undefined,
      background: 'var(--accent)', borderRadius: large ? 14 : 8,
      padding: large ? '12px 22px' : '5px 12px',
    }}>
      {time}
    </span>
  )
}
