// P872 — the VA phone as a bottom-right pop-up, like a chat widget. This is the frame's side of it: is the panel open,
// is a call ringing, which rings were missed. The call itself (timer, mute, hold, hang up) lives in ./Phone and is never
// touched here: closing the panel only hides it. No imports on purpose: it runs under node --test.
//
//   open    the panel shows at the bottom right (a bottom sheet on a phone)
//   line    what Phone reports: 'live' (on a call), 'after' (call ended, result not saved), or null
//   ringId  the call ringing in now, or null
//   missed  [{ id, seen }] rings nobody answered (timed out or Not now); unseen ones badge the round button

export const RING_MS = 30000 // a sample ring gives up after 30 seconds and counts as missed

export const initialDock = { open: false, line: null, ringId: null, missed: [] }

export function dockReducer(s, a) {
  switch (a.type) {
    case 'open': return { ...s, open: true, missed: s.missed.map(m => ({ ...m, seen: true })) }
    // X, Esc, or another menu opening: hide the panel. Never ends a call; hanging up is only the red button in Phone.
    case 'close': return s.open ? { ...s, open: false } : s
    case 'ring': return { ...s, ringId: a.id, open: true }
    case 'answer': return { ...s, ringId: null }
    // Not now, or the ring timed out: it becomes a missed call (seen at once if the panel is open and it was declined).
    case 'miss': return s.ringId ? { ...s, ringId: null, open: a.declined ? false : s.open, missed: [{ id: s.ringId, seen: false, at: a.at || null }, ...s.missed] } : s
    case 'line': return s.line === a.line ? s : { ...s, line: a.line || null }
    default: return s
  }
}

// What shows at the bottom right: the open panel, the pill (a call is on, or its result is not saved yet), or the button.
export function dockView(s) {
  if (s.open) return 'panel'
  if (s.line === 'live' || s.line === 'after') return 'pill'
  return 'button'
}

// The round button's badge: a ring beats a missed count.
export function dockBadge(s) {
  if (s.ringId) return { kind: 'ringing', n: 1, label: 'A call is coming in' }
  const n = s.missed.filter(m => !m.seen).length
  return n ? { kind: 'missed', n, label: `${n} missed call${n === 1 ? '' : 's'}` } : null
}
