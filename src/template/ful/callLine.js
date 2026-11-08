// P876 — the VA's call, as plain data: who is on the line, hold (with a held-time counter), mute, speaker, the
// keypad's tones, notes, Add caller / Merge / Drop, and the live transfer (Check agent → push
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
    notes: who.notes || '', dnc: false, help: null, vm: false, handoff: null,
    lineId: who.lineId || null, callSid: who.callSid || null,
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
    // P882: one-tap Do not call (the person stays on the line to hear goodbye; every queued call and text stops).
    case 'dnc': return { ...c, dnc: true }
    // P882: Need help pings both admins; they can listen, whisper or join.
    case 'help': return { ...c, help: now }
    // P882: leave the voicemail message on that line and drop it (the last one on the line ends the call).
    case 'voicemail': return callReducer({ ...c, vm: true }, { type: 'drop', id: a.id, now })
    // P882: a carrier hold with no client is handed to the next free VA; this VA leaves the call.
    case 'handoff': return holdOnlyCarrier(c) ? end({ ...c, handoff: { at: now, path: a.path || '', notes: a.notes || '' } }, now, 'handed_off') : c
    // P882: the real line's ids, once the server has them.
    case 'line': return { ...c, lineId: a.lineId ?? c.lineId, callSid: a.callSid ?? c.callSid }
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
  cancelled: 'Check cancelled. A callback is booked on your Schedule',
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

// P882 — a carrier hold with nobody else: on hold, and everyone left on the call is a carrier (the client dropped).
export const holdOnlyCarrier = c => !!c && !c.end && c.held && c.parties.length > 0 && c.parties.every(p => p.role === 'carrier')

// P882 — routing. A ring (an offer) lasts 15 seconds; Not now or no answer counts as a missed ring, and two in a row
// set the VA to Away and tell the admins. The ring says what kind of call it is.
export const RING_SECS = 15
export const RING_KIND = { call_in: 'Calling in', new_lead: 'New lead', callback: 'Callback', hold_handoff: 'Hold hand-off', rescue: 'Dropped call' }
export const ringLeft = (at, now = Date.now()) => Math.max(0, Math.ceil((RING_SECS * 1000 - (now - at)) / 1000))

// Wrap-up: the outcome is required before the VA is Available again. 60 seconds, +60 s at a time (each one counted);
// past 3 minutes the admins are told.
export const WRAP_MS = 60000
export const WRAP_STUCK_MS = 180000
export const MISSED_TO_AWAY = 2

// The VA's routing status. status: 'available' | 'ringing' | 'on_call' | 'wrap' | 'away' | 'offline' | 'on_hold_carrier'
export const initialPresence = { status: 'available', missedRow: 0, wrapAt: null, wrapExtra: 0, paused: null }
export function presenceReducer(p, a) {
  const now = a.now ?? Date.now()
  switch (a.type) {
    case 'set': return ['available', 'away'].includes(a.status) && !['wrap', 'on_call', 'ringing'].includes(p.status) ? { ...p, status: a.status, missedRow: a.status === 'available' ? 0 : p.missedRow } : p
    case 'ring': return p.status === 'available' || p.status === 'on_hold_carrier' ? { ...p, status: 'ringing' } : p
    case 'answer': return { ...p, status: 'on_call', missedRow: 0 }
    case 'missed': {
      const missedRow = p.missedRow + 1
      return { ...p, missedRow, status: missedRow >= MISSED_TO_AWAY ? 'away' : p.status === 'ringing' ? 'available' : p.status }
    }
    case 'wrap': return p.status === 'wrap' ? p : { ...p, status: 'wrap', wrapAt: now, wrapExtra: 0 }
    case 'more': return p.status === 'wrap' ? { ...p, wrapExtra: p.wrapExtra + 1 } : p
    // Done needs an outcome; without one nothing changes.
    case 'done': return p.status === 'wrap' && String(a.outcome || '').trim() ? { ...p, status: 'available', wrapAt: null, wrapExtra: 0 } : p
    case 'pause': return { ...p, paused: a.task || null }
    case 'resume': return { ...p, paused: null }
    // The server's presence (va_beat) wins on a real line.
    case 'server': {
      const s = a.presence || {}
      return { ...p, status: s.status || p.status, missedRow: s.missed_rings ?? p.missedRow, wrapAt: s.wrap_started_at ? Date.parse(s.wrap_started_at) - (a.skew || 0) : null, wrapExtra: s.wrap_extra ?? 0, paused: s.paused_task ?? p.paused }
    }
    default: return p
  }
}
// ms left of the wrap-up (negative once it runs over), and whether the admins have been told.
export const wrapLeft = (p, now = Date.now()) => (p.wrapAt == null ? null : p.wrapAt + WRAP_MS * (1 + p.wrapExtra) - now)
export const wrapStuck = (p, now = Date.now()) => p.wrapAt != null && now - p.wrapAt >= WRAP_STUCK_MS
export const PRESENCE_WORDS = { available: 'Available', ringing: 'Ringing', on_call: 'On a call', wrap: 'Wrapping up', away: 'Away', offline: 'Offline', on_hold_carrier: 'On a carrier hold' }
