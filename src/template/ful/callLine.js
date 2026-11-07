// P876 — the VA's call, as plain data: who is on the line, hold (with a held-time counter), mute, speaker, the
// keypad's tones, the recording notice, notes, Add caller / Merge / Drop, and the live transfer (Check agent → push
// Sent → Seen → Yes / No / No answer, then a cold transfer that bounces back to the VA if the agent doesn't pick up).
// Phone.jsx draws it; nothing here touches React, so it runs under node --test. Sample timings; the backend (P852)
// swaps the timers for real call events.
//
// A party: { id, name, role: 'client' | 'lead' | 'carrier' | 'agent', number, state }
//   state 'ringing'  being called, not on the line yet
//         'waiting'  answered on a separate line; the main call is on hold until the VA merges
//         'line'     on the merged call (everyone with state 'line' hears each other)

export const CHECK_MS = 30000   // the agent has 30 seconds to answer the push
export const BOUNCE_MS = 20000  // a cold transfer comes back to the VA if the agent doesn't pick up in about 20 s

export function newCall(who, now = Date.now()) {
  return {
    who, start: now, end: null, outcome: null,
    muted: false, speaker: false, pad: false, tones: '',
    held: false, heldSince: null, heldMs: 0,
    rec: true, notes: who.notes || '',
    parties: [{ id: who.key, name: who.name, role: who.role || 'client', number: who.number, state: 'line' }],
    xfer: null,
  }
}

const hold = (c, on, now) => {
  if (on === c.held) return c
  return on ? { ...c, held: true, heldSince: now } : { ...c, held: false, heldSince: null, heldMs: c.heldMs + (now - (c.heldSince || now)) }
}

export function callReducer(c, a) {
  if (!c) return c
  const now = a.now ?? Date.now()
  switch (a.type) {
    case 'mute': return { ...c, muted: !c.muted }
    case 'speaker': return { ...c, speaker: !c.speaker }
    case 'pad': return { ...c, pad: !c.pad }
    case 'tone': return { ...c, tones: (c.tones + a.key).slice(-24) }
    case 'hold': return hold(c, !c.held, now)
    case 'rec': return { ...c, rec: !c.rec }
    case 'notes': return { ...c, notes: a.text }
    // Add caller: they ring on a separate line; the people already on the call wait on hold meanwhile.
    case 'add': {
      if (c.parties.some(p => p.id === a.party.id)) return c
      return { ...hold(c, true, now), parties: [...c.parties, { ...a.party, state: 'ringing' }] }
    }
    case 'answered': return { ...c, parties: c.parties.map(p => (p.id === a.id && p.state === 'ringing' ? { ...p, state: 'waiting' } : p)) }
    // Merge: everyone who answered joins the one call, and the hold ends.
    case 'merge': {
      if (!c.parties.some(p => p.state === 'waiting')) return c
      return { ...hold(c, false, now), parties: c.parties.map(p => (p.state === 'waiting' ? { ...p, state: 'line' } : p)) }
    }
    // Drop one person. If nobody is left on the line, the call is over for the VA too.
    case 'drop': {
      const gone = c.parties.find(p => p.id === a.id)
      if (!gone) return c
      const parties = c.parties.filter(p => p.id !== a.id)
      const next = { ...c, parties }
      if (!parties.some(p => p.state === 'line')) return parties.length ? next : end(next, now)
      // The last one ringing or waiting dropped while the call was held for them: back on the call.
      return gone.state !== 'line' && !parties.some(p => p.state !== 'line') && c.held ? hold(next, false, now) : next
    }
    case 'end': return end(c, now, a.outcome)
    // Live transfer (blueprint "Live transfer", decided Nov 7).
    case 'check': return { ...c, xfer: { agent: a.agent, step: 'sent', at: now } }
    case 'xfer': return c.xfer ? { ...c, xfer: { ...c.xfer, step: a.step, at: now } } : c
    case 'xferClear': return { ...c, xfer: null }
    // P880: the real check's state from the server (help-transfer / transfer_checks), replacing the sample timers.
    case 'xferServer': return { ...c, xfer: a.xfer }
    // P880 sample: the agent took back their Yes; or a late Yes arrived while the lead is still on the line.
    case 'withdrew': return c.xfer && ['yes', 'ringing', 'lateyes'].includes(c.xfer.step) ? { ...c, xfer: { ...c.xfer, step: 'withdrew', at: now } } : c
    case 'lateYes': return c.xfer && ['no', 'noanswer'].includes(c.xfer.step) ? { ...c, xfer: { ...c.xfer, step: 'lateyes', at: now } } : c
    // Yes → a straight (cold) transfer to the agent's phone; the VA drops off once the agent picks up.
    case 'transfer': return ['yes', 'lateyes'].includes(c.xfer?.step) ? { ...c, xfer: { ...c.xfer, step: 'ringing', at: now } } : c
    case 'picked': return c.xfer?.step === 'ringing' ? end({ ...c, xfer: { ...c.xfer, step: 'done', at: now } }, now, 'transferred') : c
    case 'bounce': return c.xfer?.step === 'ringing' ? { ...c, xfer: { ...c.xfer, step: 'bounced', at: now } } : c
    default: return c
  }
}

function end(c, now, outcome = null) {
  if (c.end) return c
  return { ...hold(c, false, now), end: now, outcome, pad: false }
}

// Everyone on the merged call (not counting the VA), and how many are on it in all with the VA.
export const onLine = c => (c ? c.parties.filter(p => p.state === 'line') : [])
export const lineCount = c => onLine(c).length + 1
export const heldFor = (c, now = Date.now()) => (c ? c.heldMs + (c.held && c.heldSince ? now - c.heldSince : 0) : 0)

// What the transfer card says at each step.
export const XFER_WORDS = {
  sent: 'Sent to the agent’s phone',
  seen: 'Seen. Waiting for an answer',
  yes: 'Yes. Transfer them now',
  no: 'Not now. Book them on the agent’s calendar',
  noanswer: 'No answer. Book them on the agent’s calendar',
  fail: 'Couldn’t reach the agent. Book them on the agent’s calendar',
  ringing: 'Ringing the agent. You drop off when they pick up',
  done: 'Transferred',
  bounced: 'The agent didn’t pick up. The call came back to you. Book them',
  // P880
  lateyes: 'The agent said Yes late. They’re still free: transfer now',
  withdrew: 'The agent withdrew. Book them on the agent’s calendar',
  cancelled: 'Check cancelled. The lead is back in your queue as a callback',
  booked: 'Booked on the agent’s calendar',
  busy: 'Agent being checked by another VA. Book them',
  unreachable: 'Not reachable for live calls. Book them on the agent’s calendar',
}
export const xferOpen = x => !!x && ['sent', 'seen', 'ringing'].includes(x.step)
// The steps that leave the VA booking the lead, and the ones that offer Transfer now.
export const XFER_BOOK = ['no', 'noanswer', 'fail', 'bounced', 'withdrew', 'busy', 'unreachable']
export const XFER_GO = ['yes', 'lateyes']

// P880 — transfer_checks.status (help-transfer) → the card's step. The timer comes from the row (expires_at for the
// 30 s answer, ring_started_at + 20 s for the ring), corrected by the server's clock so a reload or a slow phone
// clock never shows the wrong seconds.
const STEP = {
  sent: 'sent', seen: 'seen', yes: 'yes', late_yes: 'lateyes', no: 'no', no_answer: 'noanswer', failed: 'fail',
  withdrawn: 'withdrew', cancelled: 'cancelled', ringing: 'ringing', connected: 'done', bounced: 'bounced', booked: 'booked',
}
export function xferFromCheck(row, skewMs = 0, now = Date.now()) {
  if (!row) return null
  const t = now + skewMs
  let status = row.status
  if ((status === 'sent' || status === 'seen') && row.expires_at && Date.parse(row.expires_at) <= t) status = 'no_answer'
  const step = STEP[status] || 'fail'
  // The card counts down from `at` + CHECK_MS / BOUNCE_MS: give it the server's start, on this device's clock.
  const start = step === 'ringing' ? row.ring_started_at : row.sent_at || row.created_at
  return { agent: row.agent_id, step, at: start ? Date.parse(start) - skewMs : now, checkId: row.id, bookedFor: row.booked_for || null, live: true }
}
// The server's answer to Check agent when no check was made (agent busy, not reachable, no agent).
export function xferRefused(code, agent, now = Date.now()) {
  const step = code === 'agent_busy' ? 'busy' : code === 'not_reachable' ? 'unreachable' : 'fail'
  return { agent, step, at: now, live: true }
}

// Sample reach (the real one is transfer_reach): who can't get live calls right now, and why.
export const SAMPLE_REACH = { 'ag-marcus': 'not_tested' }
export const REACH_WORDS = {
  not_tested: 'Not reachable for live calls: hasn’t passed the push test',
  no_device: 'Not reachable for live calls: no phone with the app',
  notifications_off: 'Not reachable for live calls: notifications are off',
  booking_only: 'Not reachable for live calls: booking only',
}
