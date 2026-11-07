// P872 → P876 — the frame's side of the VA phone: is the call screen slid in, is a call ringing, which rings were
// missed, and what the left rail's phone icon shows. The call itself (timer, mute, hold, merge, transfer) lives in
// ./Phone and ./callLine and is never touched here: sliding the screen away only hides it. P876: there is no floating
// phone button any more. The phone opens only from the rail's phone icon (the top bar's on a phone), which shows a
// ringing call and, while the screen is slid away mid-call, a green pulse and the call's timer.
// No imports on purpose: it runs under node --test.
//
//   open    the call screen is slid in over the page (it never changes the page's layout)
//   line    what Phone reports: 'live' (on a call), 'after' (call ended, result not saved), or null
//   since   when the live call started (the rail's timer), or null
//   ringId  the call ringing in now, or null
//   missed  [{ id, seen }] rings nobody answered (timed out or Not now); unseen ones badge the rail icon

export const RING_MS = 15000 // P882: a ring gives up after 15 seconds and counts as a missed ring (routing then tries the next VA)

export const initialDock = { open: false, line: null, since: null, ringId: null, missed: [] }

export function dockReducer(s, a) {
  switch (a.type) {
    case 'open': return { ...s, open: true, missed: s.missed.map(m => ({ ...m, seen: true })) }
    // The tab on the screen's left edge, Esc, or another menu opening: slide it away. Never ends a call.
    case 'close': return s.open ? { ...s, open: false } : s
    case 'toggle': return dockReducer(s, { type: s.open ? 'close' : 'open' })
    case 'ring': return { ...s, ringId: a.id, open: true }
    case 'answer': return { ...s, ringId: null }
    // Not now, or the ring timed out: it becomes a missed call (seen at once if the screen is open and it was declined).
    case 'miss': return s.ringId ? { ...s, ringId: null, open: a.declined ? false : s.open, missed: [{ id: s.ringId, seen: false, at: a.at || null }, ...s.missed] } : s
    case 'line': {
      const line = a.line || null
      const since = line === 'live' ? (s.line === 'live' && s.since ? s.since : a.since ?? null) : null
      return s.line === line && s.since === since ? s : { ...s, line, since }
    }
    default: return s
  }
}

// What the rail's phone icon shows: a ring beats a live call; 'after' = the call ended and its result isn't saved.
export function railState(s) {
  if (s.ringId) return 'ringing'
  if (s.line === 'live') return 'live'
  if (s.line === 'after') return 'after'
  return null
}

// The rail icon's badge when nothing is ringing or live: unseen missed calls.
export function dockBadge(s) {
  if (s.ringId) return { kind: 'ringing', n: 1, label: 'A call is coming in' }
  const n = s.missed.filter(m => !m.seen).length
  return n ? { kind: 'missed', n, label: `${n} missed call${n === 1 ? '' : 's'}` } : null
}
