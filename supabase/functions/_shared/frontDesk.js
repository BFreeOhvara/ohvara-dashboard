// P932 — the AI front desk and the hold line, as plain rules (shared by help-voice and the portal's sample data).
// Brayden (Nov 9 22:43): when every VA is busy, "AI answers… qualify the call… tell them estimated time is blank
// minutes… put it on hold", and "when our clients are on hold, they hear music."
//   estimateWait   minutes from live data: VAs free / on calls, the average call length, people ahead
//   holdUpdate     the short line said every ~60 s on hold ("You're next" / "about 2 minutes")
//   needOf         what the caller said → the change (cancel, beneficiary, bank, address, name, payment, question)
//   summaryOf      the 2–3 line note the VA sees when the call reaches them, so the client never repeats themselves

export const HOLD = { aiAfterSec: 20, updateEverySec: 60, maxWaitMin: 10 }
export const AVG_CALL_MIN = 6   // until there's a week of real inbound calls

// Minutes until a specialist is free for this caller. `ahead` people wait before them; `free` VAs are free now; `busy`
// VAs are on calls. A free VA with nobody ahead: about a minute. Otherwise the first busy VA frees up in about half an
// average call, then one more caller is taken every avg / VAs.
/** @param {{ ahead?: number, free?: number, busy?: number, avgMin?: number|null }} [o] */
export function estimateWait({ ahead = 0, free = 0, busy = 0, avgMin = AVG_CALL_MIN } = {}) {
  const avg = Number(avgMin) > 0 ? Number(avgMin) : AVG_CALL_MIN
  if (free > ahead) return 1
  const vas = Math.max(free + busy, 1)
  return Math.max(1, Math.ceil(avg / 2 + Math.max(ahead - free, 0) * avg / vas))
}
export const minutesWord = m => (m <= 1 ? 'about a minute' : `about ${m} minutes`)

/** @param {{ ahead?: number, minutes?: number }} [o] */
export function holdUpdate({ ahead = 0, minutes = 1 } = {}) {
  if (ahead <= 0) return 'You’re next. A specialist will be with you shortly.'
  return `You’re number ${ahead + 1} in line. A specialist will be with you in ${minutesWord(minutes)}.`
}
export const PRESS_1 = 'Press 1 any time and we’ll call you back instead.'

// Past the longest wait, or nobody on shift: book the callback instead of holding.
/** @param {{ waitedSec?: number, maxWaitMin?: number, online?: number, deskOpen?: boolean }} [o] */
export function needsCallback({ waitedSec = 0, maxWaitMin = HOLD.maxWaitMin, online = 1, deskOpen = true } = {}) {
  if (!deskOpen) return 'after_hours'
  if (online <= 0) return 'no_va'
  if (waitedSec >= maxWaitMin * 60) return 'too_long'
  return null
}

// ── Qualifying ───────────────────────────────────────────────────────────
export const NEED = {
  cancel: { word: 'Cancel', ask: 'I’m sorry to hear that. Can I ask what’s making you want to cancel?', form: true },
  beneficiary: { word: 'Beneficiary change', ask: 'Who would you like the new beneficiary to be, and how are they related to you?', form: true },
  bank: { word: 'Bank or draft date change', ask: 'What day of the month would you like the payment to come out? Please don’t say any account numbers; the specialist will take those safely.', form: true },
  address: { word: 'Address change', ask: 'What’s the new address?', form: true },
  name: { word: 'Name change', ask: 'What’s the new name on the policy?', form: true },
  payment: { word: 'Payment problem', ask: 'What happened with the payment?', form: false },
  question: { word: 'Question', ask: 'Tell me a little more, and I’ll pass it on.', form: false },
}
const WORDS = [
  ['beneficiary', /benef|beneficiar|leave (it|the money) to|who gets/],
  ['bank', /bank|draft|account|routing|withdraw|debit|take it out|payment date|due date|change the date/],
  ['address', /address|moved|moving|new house|new home|mail/],
  ['name', /name change|change (my|the) name|married|maiden|divorc|last name/],
  ['cancel', /cancel|stop (the|my) policy|don'?t want|end (the|my) policy|surrender/],
  ['payment', /payment|missed|bounced|declined|late|lapse|bill|charge/],
]
export function needOf(text) {
  const t = String(text || '').toLowerCase()
  for (const [k, re] of WORDS) if (re.test(t)) return k
  return 'question'
}

const clip = (s, n = 140) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
// The note on the VA's panel: who, which policy, what they need and what they said.
/** @param {{ name?: string|null, known?: boolean, carrier?: string|null, need?: string, said?: string, detail?: string, minutes?: number|null, dob?: string|null }} [o] */
export function summaryOf({ name = null, known = false, carrier = null, need = 'question', said = '', detail = '', minutes = null, dob = null } = {}) {
  const who = name ? `${name}${known ? '' : ' (not on file: check name and date of birth)'}` : 'Unknown caller'
  const l1 = `${who}${carrier ? ` · ${carrier}` : ''}${dob && !known ? ` · DOB ${dob}` : ''}`
  const l2 = `${NEED[/** @type {keyof typeof NEED} */ (need)]?.word || 'Question'}${said ? `: “${clip(said, 100)}”` : ''}`
  const l3 = detail ? `They said: “${clip(detail)}”` : minutes ? `Told about ${minutes} min wait.` : ''
  return [l1, l2, l3].filter(Boolean).join('\n')
}

// What the caller can pick after qualifying. Hold is the default; 1 = a callback; 2 = the e-sign link now, offered
// first only for a form-type change at a carrier that takes forms, and only when texting is live.
/** @param {{ need?: string|null, esignPath?: boolean, smsLive?: boolean, minutes?: number }} [o] */
export function choicesOf({ need, esignPath = false, smsLive = false, minutes = 1 } = {}) {
  const esign = !!(NEED[/** @type {keyof typeof NEED} */ (need)]?.form && esignPath && smsLive)
  const wait = `A specialist will be with you in ${minutesWord(minutes)}.`
  const say = esign
    ? `Good news: this change can be done by signing a form on your phone. Press 2 and I’ll text you the link now. ${wait} Press 1 for a call back, or stay on the line.`
    : `${wait} Stay on the line, or press 1 and we’ll call you back.`
  return { esign, digits: esign ? '12' : '1', say }
}

// The callback time told to the caller: soon while the desk is open, else 8 AM Central on the next weekday.
/** @param {{ deskOpen?: boolean, minutes?: number }} [o] */
export function callbackLine({ deskOpen = true, minutes = 15 } = {}) {
  return deskOpen
    ? `A specialist will call you back in ${minutesWord(Math.max(minutes, 10))}. You’ll get a text to confirm.`
    : 'Our team is away right now. A specialist will call you back after 8 AM Central on the next business day. You’ll get a text to confirm.'
}
export const GREETING = 'Thanks for calling Deedstone Insurance.'
export const BUSY_LINE = 'All our specialists are helping other clients right now. I can get things ready so you don’t have to repeat yourself.'
