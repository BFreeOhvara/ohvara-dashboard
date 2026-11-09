// P916 — an agent's Call through Deedstone, as plain logic (no React; the network only in callDeedstone, which takes
// the client). Tapping Call rings the agent's own connected phone first; when they answer and press 1, the client is
// dialed from the agent's Deedstone number, so the client only ever sees "Deedstone Insurance". The agent never sees
// that number. Screens: template/DeedstoneCall.jsx (the call sheet), Settings → Hours and calls (connect your phone).

// fulfillment-call, with the error body unwrapped (supabase.functions.invoke hides it behind error.context).
export async function callDeedstone(db, action, body = {}) {
  const { data, error } = await db.functions.invoke('fulfillment-call', { body: { action, ...body } })
  if (!error) return data
  let payload = null
  try { payload = await error.context?.json() } catch { /* not JSON */ }
  const err = new Error(payload?.error || error.message || 'Request failed')
  err.code = payload?.code
  err.next_at = payload?.next_at ?? null
  throw err
}

// What the call sheet says at each step (deedstone_calls.status).
export const CALL_STEPS = {
  calling_agent: { title: 'Calling your phone', sub: 'Answer it, then press 1. We’ll dial {first} from Deedstone.' },
  agent_on: { title: 'Press 1 on your phone', sub: 'Then we dial {first}. They’ll see Deedstone Insurance.' },
  calling_client: { title: 'Ringing {first}', sub: 'From your Deedstone number. Stay on your phone.' },
  live: { title: 'On the call with {first}', sub: 'Talk on your phone. Hang up there or here when you’re done.' },
  ended: { title: 'Call ended', sub: '' },
}

// Why it ended, in the agent's words.
export const END_WORDS = {
  done: 'Call ended.',
  agent_hung_up: 'You ended the call.',
  agent_cancelled: 'Cancelled on your phone.',
  agent_no_answer: 'Your phone didn’t answer, so we didn’t dial them.',
  agent_busy: 'Your phone was busy, so we didn’t dial them.',
  agent_failed: 'Your phone couldn’t be reached.',
  agent_canceled: 'Call cancelled.',
  client_no_answer: '{first} didn’t answer.',
  client_busy: '{first}’s line was busy.',
  ring_failed: 'Your phone couldn’t be rung. Try again.',
  stale: 'Call ended.',
}

// Refusals that mean Deedstone calling isn't on yet (pre-launch): the sheet offers the old tap-to-call so agents
// aren't stuck until calling goes live.
export const NOT_ON_YET = ['voice_off', 'not_configured', 'no_number']

const firstOf = name => String(name || '').trim().split(/\s+/)[0] || 'them'
const fill = (s, name) => String(s || '').replaceAll('{first}', firstOf(name))

export function stepOf(status, name) {
  const s = CALL_STEPS[status] || CALL_STEPS.calling_agent
  return { title: fill(s.title, name), sub: fill(s.sub, name) }
}

export function endWords(reason, name) {
  if (String(reason || '').startsWith('predial_')) return 'They can’t be called right now.'
  return fill(END_WORDS[reason] || END_WORDS.done, name)
}

// A Call target from a lead or a client (a client's id is their policy id).
export function targetOf(kind, item) {
  if (!item?.id) return null
  if (kind === 'client') {
    return { kind, id: item.id, name: `${item.client_first_name || ''} ${item.client_last_name || ''}`.trim() || 'Client', phone: item.client_phone || null }
  }
  return { kind: 'lead', id: item.id, name: item.name || `${item.first_name || ''} ${item.last_name || ''}`.trim() || 'Lead', phone: item.rawPhone || item.phone || null }
}

// The body fulfillment-call takes.
export const callBody = t => (t.kind === 'client' ? { policy_id: t.id } : { lead_id: t.id })

// Connect your phone: a code is 6 digits; a phone is 10 US digits.
export const codeOk = code => /^\d{6}$/.test(String(code || '').replace(/\D/g, ''))
export function e164(raw) {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10 && /^[2-9]/.test(d)) return `+1${d}`
  if (d.length === 11 && d.startsWith('1') && /^[2-9]/.test(d.slice(1))) return `+${d}`
  return null
}
export function shown(e) {
  const d = String(e || '').replace(/\D/g, '').slice(-10)
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : ''
}

// Why a code didn't work (deedstone_code_confirm's reason).
export const CODE_WORDS = {
  wrong_code: 'That code isn’t right. Check it and try again.',
  expired: 'That code ran out. Call me again for a new one.',
  too_many_tries: 'Too many tries. Call me again for a new code.',
  no_code: 'Ask for a code call first.',
}
