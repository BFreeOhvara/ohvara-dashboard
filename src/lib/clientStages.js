// P911 — the stage checklist for a Working client (Brayden, Nov 8: "it shows the stages for everything we do… because
// I always forget… a checklist"). No React, no network: the agent's Clients card and drawer, the VA's client view, the
// sample stores and the tests share these rules.
//
// Every Working client is on one journey, and each journey ends back at Protected:
//   New policy        Sold and submitted → Hand-off call with our team → Policy approved by the carrier → Old policy
//                     cancelled (replacements only, timed before the old draft) → First payment cleared.
//   Saving a policy   Problem found → Save call booked → Client reached → Fixed with the carrier → Payment cleared.
//                     If it can't be saved it ends Closed, with the reason.
//   Change request    Requested → Call booked → Done with the carrier → Confirmed.
//   Client you added  Added → Welcome call → Details confirmed.
//
// One rule for Protected: nothing pending AND the latest draft cleared. So an immediate-draft sale stays Working until
// its hand-off call is done and that first payment clears.
//
// A client's progress lives in `c.track` = { kind, done: { stepKey: 'Oct 27' }, skip: [stepKey], next: 'Fri, Nov 6,
// 2:00 PM', closed: 'reason' }. Where a client has no track yet (older rows, the VA sample, real rows before the
// backend writes one) it is worked out from the fields the client already has (stage, missed, fixing, request, added).

export const JOURNEYS = {
  new_policy: {
    key: 'new_policy', label: 'New policy',
    steps: [
      { key: 'sold', label: 'Sold and submitted' },
      { key: 'handoff', label: 'Hand-off call with our team', sub: 'We go over the details with the client' },
      { key: 'approved', label: 'Policy approved by the carrier' },
      { key: 'old_cancel', label: 'Old policy cancelled', sub: 'Replacements only, timed before the old draft' },
      { key: 'first_payment', label: 'First payment cleared' },
    ],
  },
  save: {
    key: 'save', label: 'Saving the policy',
    steps: [
      { key: 'found', label: 'Problem found' },
      { key: 'booked', label: 'Save call booked' },
      { key: 'reached', label: 'Client reached' },
      { key: 'fixed', label: 'Fixed with the carrier', sub: 'Redraft, new bank or new draft date' },
      { key: 'cleared', label: 'Payment cleared' },
    ],
  },
  change: {
    key: 'change', label: 'Change request',
    steps: [
      { key: 'requested', label: 'Requested' },
      { key: 'booked', label: 'Call booked' },
      { key: 'carrier', label: 'Done with the carrier' },
      { key: 'confirmed', label: 'Confirmed' },
    ],
  },
  added: {
    key: 'added', label: 'Client you added',
    steps: [
      { key: 'added', label: 'Added' },
      { key: 'welcome', label: 'Welcome call' },
      { key: 'confirmed', label: 'Details confirmed' },
    ],
  },
}
export const JOURNEY_ORDER = ['new_policy', 'save', 'change', 'added']

// P923: a replacement = the agent answered Yes (c.replacing), or the client's brief names the old policy, or the old
// policy was already cancelled. Anything else (No, or never asked) leaves "Old policy cancelled" n/a.
export const replacingOf = c => c?.replacing === true || !!c?.brief?.replaces || !!c?.track?.done?.old_cancel
const day = s => (s ? String(s).replace(/^[A-Z][a-z]{2},\s*/, '') : null) // 'Tue, Oct 27' → 'Oct 27'
const SAVE_WHY = /miss|lapse|draft|payment|declin|return|bank/i

// Which journey a client is on: the track's kind, else worked out from the client's fields.
export function journeyOf(c) {
  if (!c) return 'new_policy'
  if (c.track?.kind && JOURNEYS[c.track.kind]) return c.track.kind
  if (c.fixing || (c.missed && !c.missed.done)) return 'save'
  if (c.stage === 'needs_attention' && SAVE_WHY.test(`${c.attention || ''} ${c.note || ''} ${c.next_step || ''}`)) return 'save'
  if (c.request || c.stage === 'requests') return 'change'
  if (c.added && c.book !== 'welcomed' && c.book !== 'serviced') return 'added'
  return 'new_policy'
}

// The track for a client without one: what the fields already say. Only the first step(s) can be known to be done.
export function derivedTrack(c) {
  const kind = journeyOf(c)
  const next = c?.next_step || null
  if (kind === 'save') {
    const since = c.missed?.due ? c.missed.due : c.fixing?.since ? dateWord(c.fixing.since) : null
    return { kind, done: { found: since || true }, next }
  }
  if (kind === 'change') return { kind, done: { requested: true }, next }
  if (kind === 'added') return { kind, done: { added: day(c.submitted) || true }, next }
  // New policy. A Sold lead not submitted yet is still on step 1. P923: "Old policy cancelled" is a real step only when
  // the agent said Yes to "Replacing an old policy?" on Submit (else n/a).
  const done = c.fromLead ? {} : { sold: day(c.submitted) || true }
  return { kind, done, skip: replacingOf(c) ? [] : ['old_cancel'], next }
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// 'YYYY-MM-DD' → 'Nov 3'; anything else as written (weekday dropped).
export const dateWord = d => (/^\d{4}-\d{2}-\d{2}/.test(String(d)) ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}` : day(d))

// A save starts the moment a problem is found (a No on the monthly check, Lapsed, a carrier email, a missed payment).
export const saveTrack = since => ({ kind: 'save', done: { found: since ? dateWord(since) : true }, next: null })

export const trackOf = c => (c?.track?.kind ? c.track : derivedTrack(c || {}))

// The checklist: every step with its state (done | current | upcoming | skipped), the date it was done, and the next
// booked call on the current step. { kind, label, steps, at (1-based current), of (steps that apply), complete, closed }.
export function stagesOf(c) {
  const tr = trackOf(c)
  const j = JOURNEYS[tr.kind] || JOURNEYS.new_policy
  const done = tr.done || {}
  const skip = new Set(tr.skip || [])
  if (j.key === 'new_policy' && !replacingOf(c)) skip.add('old_cancel')
  let current = null
  const steps = j.steps.map(s => {
    if (skip.has(s.key)) return { ...s, state: 'skipped' }
    if (done[s.key]) return { ...s, state: 'done', at: typeof done[s.key] === 'string' ? done[s.key] : null }
    if (!current && !tr.closed) { current = s.key; return { ...s, state: 'current', next: tr.next || null } }
    return { ...s, state: 'upcoming' }
  })
  const live = steps.filter(s => s.state !== 'skipped')
  const at = current ? live.findIndex(s => s.key === current) + 1 : live.length
  return { kind: j.key, label: j.label, steps, at, of: live.length, current: steps.find(s => s.state === 'current') || null, complete: !current && !tr.closed, closed: tr.closed || null }
}

// The card's one line for a Working client: "Stage 2 of 5 · Hand-off call with our team".
export function stageLine(c) {
  const s = stagesOf(c)
  if (s.closed) return s.closed
  return s.current ? `Stage ${s.at} of ${s.of} · ${s.current.label}` : 'All steps done'
}

// True while a track is still running (any step left), so the client stays Working (the one Protected rule).
export const trackOpen = c => !!c?.track?.kind && !c.track.closed && !stagesOf(c).complete
export const trackClosed = c => !!c?.track?.closed

// Move a client one step on (the VA's calls do this): marks `key` done on `at`, clears the booked call. When the last
// step is done the track is complete and the client goes back to Protected.
export function completeStep(c, key, at) {
  const tr = trackOf(c)
  const out = { ...c, track: { ...tr, done: { ...(tr.done || {}), [key]: at || true }, next: null } }
  // The last step of a save also ends the save itself.
  if (stagesOf(out).complete && tr.kind === 'save') return { ...out, fixing: null, missed: c.missed ? { ...c.missed, done: true } : c.missed }
  return out
}
