import { useEffect, useState } from 'react'
import { zoneOf, findZone } from '../lib/callSlots'
import { resolveClientTimezone } from '../lib/timezones'

// P854 — the client's zone for a booking picker (SlotPick): from state + city, a strict lookup for a split-state city
// lib/callSlots doesn't know, else the booker picks it. Never a guess.
// The client's zone: { tz, auto, resolving, manual, pick }. tz is null until it is known or picked.
export function useClientZone(state, city) {
  const st = String(state || '').trim().toUpperCase()
  const c = String(city || '').trim()
  const key = `${st}|${c.toLowerCase()}`
  const auto = zoneOf(st, c)
  const [looked, setLooked] = useState({ key: '', tz: null })
  const [picked, setPicked] = useState({ key: '', tz: '' })
  const lookup = !auto && !!st && !!c
  useEffect(() => {
    if (!lookup) return undefined
    let live = true
    findZone(st, c, (city2, st2) => resolveClientTimezone(city2, st2, { strict: true })).then(tz => { if (live) setLooked({ key, tz }) })
    return () => { live = false }
  }, [lookup, st, c, key])
  const found = auto || (looked.key === key ? looked.tz : null)
  const manual = picked.key === key ? picked.tz : ''
  return { tz: found || manual || null, auto: !!found, resolving: lookup && looked.key !== key, manual, pick: tz => setPicked({ key, tz }) }
}

