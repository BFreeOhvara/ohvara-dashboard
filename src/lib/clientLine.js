// P924 — clients reach our team, not the agent. Plain rules shared by the VA desk, the admin Deedstone numbers page,
// the sample store and the tests; migration 258 (route_offer / client_text_task) mirrors them on the server.
//
// Calls: the VA who last talked with that caller (if on shift) → the rest of the number's pod → any free VA → a
// booked callback. Texts: read the intent, make a booked call or a pod task, and send one automatic reply.

export const POD_MIN = 2
export const POD_MAX = 3

// Who a call to a Deedstone number rings, in order. `vas` = [{ id, onShift, busy }]; `pod` = VA ids on the number;
// `lastVa` = the VA who last talked with this caller. Returns { ring: [ids…], then: 'callback' }.
export function ringOrder({ vas = [], pod = [], lastVa = null } = {}) {
  const free = new Set(vas.filter(v => v.onShift && !v.busy).map(v => v.id))
  const ring = []
  const add = id => { if (id && free.has(id) && !ring.includes(id)) ring.push(id) }
  add(lastVa)
  pod.forEach(add)
  vas.forEach(v => add(v.id))
  return { ring, then: 'callback' }
}

// Which tier a ringing VA came from, for the desk's incoming-call card.
export function ringReason(id, { pod = [], lastVa = null } = {}) {
  if (id && id === lastVa) return 'Talked with this caller last'
  if (pod.includes(id)) return 'On this number'
  return 'Any free VA'
}

// Fill a number's pod to 2–3 VAs: keep who's there, then add the VAs on the fewest pods.
export function fillPod(pod = [], vaIds = [], pods = []) {
  const load = id => pods.filter(p => p.includes(id)).length
  const out = pod.filter(id => vaIds.includes(id)).slice(0, POD_MAX)
  const rest = vaIds.filter(id => !out.includes(id)).sort((a, b) => load(a) - load(b))
  while (out.length < Math.min(POD_MIN + 1, vaIds.length) && rest.length) out.push(rest.shift())
  return out
}

// What a client text is about. STOP / START / HELP are handled before this (recovery-sms inboundIntent).
export const TEXT_INTENTS = {
  cancel: { label: 'Cancel', kind: 'cancel_request', call: true, re: /\b(cancel|stop (my|the) policy|don'?t want (it|the policy)|end (my|the) policy|terminate)\b/i },
  payment: { label: 'Payment problem', kind: 'payment_change', call: true, re: /\b(pay(ment)?s?|bank|card|draft(ed)?|charge[ds]?|bounced|declined|bill(ed|ing)?|premium|withdraw\w*|late)\b/i },
  change: { label: 'Change request', kind: 'other', call: false, re: /\b(change|update|beneficiar\w*|address|moved|new (phone|number|email)|name)\b/i },
  question: { label: 'Question', kind: 'callback', call: true, re: /./ },
}
const ORDER = ['cancel', 'payment', 'change', 'question']

export function textIntent(body = '') {
  const t = String(body || '').trim()
  if (!t) return 'question'
  return ORDER.find(k => TEXT_INTENTS[k].re.test(t)) || 'question'
}

// The draft auto replies (client-facing wording: Brayden approves in admin Settings › Wording to approve).
export const CLIENT_LINE_WORDS = {
  reply_call: 'Got it. {va} from our care team will call you {when}.',
  reply_task: 'Got it. {va} from our care team is on it and will text or call you {when} if they need anything.',
  reply_after_hours: 'Got it. Our care team is closed for the night. {va} will call you {when}.',
  welcome_card: 'Welcome to Deedstone Insurance, {first}! Save our number: for any question about your policy, call or text us here and our care team will help. Contact card attached. Reply STOP to stop.',
  still_on_books: 'Hi {first}, this is {va} from Deedstone Insurance. Just checking: did your first payment go through OK?',
}

export const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m))

// The automatic reply for a client text. `when` is already words ("today at 3 PM", "tomorrow at 9 AM").
export function autoReply({ intent, va = 'Our team', when = 'today', afterHours = false } = {}) {
  const words = afterHours ? CLIENT_LINE_WORDS.reply_after_hours : TEXT_INTENTS[intent]?.call === false ? CLIENT_LINE_WORDS.reply_task : CLIENT_LINE_WORDS.reply_call
  return fill(words, { va, when })
}

// What a client text becomes: a booked call (cancel, payment, question) or a pod task (change), plus the reply.
export function textToWork({ body, va, when, afterHours = false }) {
  const intent = textIntent(body)
  const it = TEXT_INTENTS[intent]
  return { intent, label: it.label, kind: it.kind, booked: it.call, reply: autoReply({ intent, va, when, afterHours }) }
}

// The contact card sent with the welcome text after Submit (a vCard the phone saves with one tap).
export const CONTACT_NAME = 'Deedstone Insurance'
export function contactCard(phone = '') {
  const tel = String(phone).replace(/[^\d+]/g, '')
  return ['BEGIN:VCARD', 'VERSION:3.0', `FN:${CONTACT_NAME}`, `ORG:${CONTACT_NAME}`, `TEL;TYPE=VOICE,TEXT:${tel}`, 'NOTE:Your policy care team. Call or text any time.', 'END:VCARD'].join('\r\n')
}

// P924 Part 2: the save call after a No (or Lapsed) on the next-day check. The VA finds out why, then transfers the
// client live to the agent (Check agent) or books the agent's calendar; can't be saved → Closed with the reason.
export const SAVE_OUTCOMES = [
  ['saved', 'Saved'], ['to_agent', 'Transferred to agent'], ['agent_booked', 'Booked with agent'], ['fixing', 'Fixing it'],
  ['not_saved', "Can't be saved"], ['no_answer', 'No answer'],
]
export const NOT_SAVED_REASONS = ['Too expensive', 'Bought elsewhere', 'Changed their mind', 'Health or money changed', 'Never meant to buy', 'Other']
