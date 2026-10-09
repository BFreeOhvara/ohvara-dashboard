import { useEffect, useState } from 'react'
import { needsCityLookup, inferTimezoneFromState, resolveClientTimezone } from '../lib/timezones'

// Prompt 724 — the client's IANA zone from city + state. A single-zone state is
// instant; a split one is looked up ~400 ms after the last keystroke (a newer
// request aborts the older). `resolving` is true while that lookup is out.
// Shared by Book a call and Change a booking (Prompt 730).
export function useClientTimezone(city, state) {
  const c = city.trim()
  const ready = !!c && !!state
  const split = ready && needsCityLookup(state)
  const key = `${c.toLowerCase()}|${state}`
  const [found, setFound] = useState({ key: '', tz: null })
  useEffect(() => {
    if (!split) return
    const ctl = new AbortController()
    const t = setTimeout(() => {
      resolveClientTimezone(c, state, { signal: ctl.signal }).then(tz => {
        if (!ctl.signal.aborted) setFound({ key, tz })
      })
    }, 400)
    return () => { clearTimeout(t); ctl.abort() }
  }, [split, c, state, key])
  if (!ready) return { tz: null, resolving: false }
  if (!split) return { tz: inferTimezoneFromState(state), resolving: false }
  return found.key === key ? { tz: found.tz, resolving: false } : { tz: null, resolving: true }
}
