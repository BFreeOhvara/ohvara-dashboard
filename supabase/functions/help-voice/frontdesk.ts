// P932 — the hold line and the AI front desk on a Deedstone number (help-voice owns the numbers: Twilio).
// A caller rings the VA desk as before (route_inbound: the last VA → the pod → any free VA). While nobody has taken
// the call they wait on the HOLD LINE, outside the conference, so they can talk and press keys:
//   0–20 s      "Thanks for calling Deedstone Insurance", then our hold music.
//   ~20 s       still nobody: the AI front desk (needs recovery_config.ai_caller_live and hold_line_settings
//               .front_desk_on). It knows a client by their number (else asks name and date of birth), asks what
//               they need and one follow-up, writes the 2–3 line summary the VA sees, says the estimated wait and
//               offers: hold (default), 1 = a callback, 2 = the e-sign link now (form changes only, texting live).
//               AI off: the caller just hears the wait and the hold line.
//   hold        music with a short update every ~60 s ("You're next" / "about 2 minutes"); press 1 any time for a
//               callback. Past max_wait_min (10), or nobody on shift: the callback is booked and its text drafted.
//   a VA takes  the VA joins the conference; help-voice moves the caller in (?event=fd_join) with the summary on the
//               VA's screen (call_queue.detail.front_desk), so the client never repeats themselves.
// Speech is Twilio <Gather input="speech">; nothing is recorded. Retell can replace the questions later (P926 lane).
import { xmlEsc } from '../_shared/twilio.ts'
import { estimateWait, holdUpdate, needOf, summaryOf, choicesOf, needsCallback, callbackLine, NEED, PRESS_1, GREETING, BUSY_LINE, HOLD, AVG_CALL_MIN } from '../_shared/frontDesk.js'

export type DeskState = {
  taken: boolean; gone: boolean; queued: boolean; ahead: number; free: number; busy: number; online: number
  avg_min: number | null; waited_sec: number; desk_open: boolean; voice_live: boolean; sms_live: boolean; ai_live: boolean
  settings: { track: string; custom_url: string | null; front_desk_on: boolean; ai_after_sec: number; update_every_sec: number; max_wait_min: number } | null
  client: { policy_id: string; name: string; carrier: string | null } | null
  desk: { name: string | null; known: boolean; need: string | null; carrier: string | null; said: string | null; detail: string | null; dob: string | null; status: string; estimate_min: number | null } | null
}
export interface FrontDeskStore {
  start(callSid: string): Promise<DeskState | null>
  state(callSid: string): Promise<DeskState | null>
  save(callSid: string, patch: Record<string, unknown>): Promise<void>
  callback(callSid: string, reason: string): Promise<{ ok: boolean; text?: string }>
  path(carrier: string | null, need: string): Promise<{ path?: string } | null>
}
export type DeskEnv = { publicUrl: string; holdBase?: string | null }

export const VOICE = 'Polly.Joanna-Neural'
export const TRACK_SEC = 20   // each included track is a 20-second loop
const HOLD_BASE = 'https://ohvara-dashboard.vercel.app/hold'
export const AWAY_LINE = 'Our team is away right now. I can take a few details so a specialist calls you back first thing.'
const say = (t: string) => `<Say voice="${VOICE}">${xmlEsc(t)}</Say>`
const url = (env: DeskEnv, event: string, callSid: string, extra: Record<string, string> = {}) =>
  `${env.publicUrl}?${new URLSearchParams({ event, call: callSid, ...extra })}`
const redirect = (env: DeskEnv, event: string, callSid: string) => `<Redirect method="POST">${xmlEsc(url(env, event, callSid))}</Redirect>`

export function trackUrl(s: DeskState['settings'], env: DeskEnv) {
  if (s?.track === 'custom' && s.custom_url) return s.custom_url
  return `${env.holdBase || HOLD_BASE}/${['calm', 'warm', 'bright'].includes(s?.track || '') ? s!.track : 'calm'}.mp3`
}
const minutesOf = (st: DeskState) => estimateWait({ ahead: st.ahead, free: st.free, busy: st.busy, avgMin: st.avg_min ?? AVG_CALL_MIN })
const firstName = (n: string | null | undefined) => String(n || '').trim().split(/\s+/)[0] || ''
const deskOn = (st: DeskState) => st.ai_live && st.settings?.front_desk_on !== false

// The first ~20 s on the hold line (help-voice's inbound answer once the caller is queued).
export function intro(st: DeskState, env: DeskEnv, callSid: string) {
  const loops = Math.max(1, Math.round((st.settings?.ai_after_sec ?? HOLD.aiAfterSec) / TRACK_SEC))
  return `${say(`${GREETING} Connecting you now.`)}<Play loop="${loops}">${xmlEsc(trackUrl(st.settings, env))}</Play>${redirect(env, 'fd', callSid)}`
}

// The VA took the call: the caller joins the conference.
export const joinWords = () => say('Thanks for holding. Connecting you now.')

// A callback booked (pressed 1, waited too long, or nobody on shift): say when, hang up.
async function bookCallback(fd: FrontDeskStore, st: DeskState, callSid: string, reason: string) {
  await fd.callback(callSid, reason)
  return `${say(callbackLine({ deskOpen: st.desk_open && st.online > 0, minutes: minutesOf(st) }))}<Hangup/>`
}

// ?event=fd — ~20 s and still nobody: the AI front desk, or (AI off) the wait and the hold line.
export async function frontDesk(fd: FrontDeskStore, env: DeskEnv, callSid: string): Promise<string | null> {
  const st = await fd.state(callSid)
  if (!st || st.gone) return '<Hangup/>'
  if (st.taken) return null   // core answers with the conference
  if (!deskOn(st)) {
    const m = minutesOf(st)
    await fd.save(callSid, { status: 'holding', estimate_min: m, choice: 'hold' })
    return `${say(`${BUSY_LINE.split('.')[0]}. A specialist will be with you in ${m <= 1 ? 'about a minute' : `about ${m} minutes`}. ${PRESS_1}`)}${redirect(env, 'hold', callSid)}`
  }
  await fd.save(callSid, { status: 'qualifying' })
  const c = st.client
  const busy = st.desk_open ? BUSY_LINE : AWAY_LINE
  if (c?.name) {
    const ask = `${GREETING} ${busy} Hi ${firstName(c.name)}${c.carrier ? `, I see your ${c.carrier} policy` : ''}. What can we help you with today?`
    return gather(env, 'fd_need', callSid, ask)
  }
  return gather(env, 'fd_name', callSid, `${GREETING} ${busy} May I have your first and last name?`)
}

function gather(env: DeskEnv, next: string, callSid: string, words: string, fallback = 'hold') {
  return `<Gather input="speech" action="${xmlEsc(url(env, next, callSid))}" method="POST" speechTimeout="auto" timeout="6" language="en-US">` +
    `${say(words)}</Gather>${redirect(env, fallback, callSid)}`
}

const heard = (form: Record<string, string>) => String(form.SpeechResult || '').trim().slice(0, 400)

// ?event=fd_name / fd_dob / fd_need / fd_detail — one question each.
export async function frontDeskStep(fd: FrontDeskStore, env: DeskEnv, step: string, callSid: string, form: Record<string, string>): Promise<string | null> {
  const st = await fd.state(callSid)
  if (!st || st.gone) return '<Hangup/>'
  if (st.taken) return null
  const text = heard(form)
  if (step === 'fd_name') {
    await fd.save(callSid, { name: text || null })
    return gather(env, 'fd_dob', callSid, `Thanks${text ? `, ${firstName(text)}` : ''}. And your date of birth?`)
  }
  if (step === 'fd_dob') {
    await fd.save(callSid, { dob: text || null })
    return gather(env, 'fd_need', callSid, 'Got it. What can we help you with today?')
  }
  if (step === 'fd_need') {
    const need = needOf(text)
    await fd.save(callSid, { need, said: text || null })
    return gather(env, 'fd_detail', callSid, NEED[need as keyof typeof NEED]?.ask || NEED.question.ask, 'fd_choice')
  }
  // fd_detail: write the summary, say the wait, offer the choices.
  const d = st.desk
  const need = d?.need || 'question'
  const carrier = d?.carrier || st.client?.carrier || null
  const m = minutesOf(st)
  const summary = summaryOf({ name: d?.name || st.client?.name || null, known: !!d?.known || !!st.client?.name, carrier, need, said: d?.said || '', detail: text, minutes: m, dob: d?.dob || null })
  const p = NEED[need as keyof typeof NEED]?.form ? await fd.path(carrier, need) : null
  const ch = choicesOf({ need, esignPath: p?.path === 'esign', smsLive: st.sms_live, minutes: m })
  await fd.save(callSid, { detail: text || null, summary, estimate_min: m, path: p, status: 'holding' })
  if (!st.desk_open || st.online <= 0) return bookCallback(fd, st, callSid, st.desk_open ? 'no_va' : 'after_hours')
  return choiceGather(env, callSid, ch.say, ch.digits)
}

function choiceGather(env: DeskEnv, callSid: string, words: string, digits: string) {
  return `<Gather input="dtmf" numDigits="1" timeout="5" action="${xmlEsc(url(env, 'fd_key', callSid, { allow: digits }))}" method="POST">` +
    `${say(words)}</Gather>${redirect(env, 'hold', callSid)}`
}

// ?event=fd_choice — the follow-up got no answer: summary from what we have, then the choices.
export async function frontDeskChoice(fd: FrontDeskStore, env: DeskEnv, callSid: string) {
  return frontDeskStep(fd, env, 'fd_detail', callSid, {})
}

// ?event=hold — the hold loop: the update line, then music until the next update; press 1 = callback.
export async function hold(fd: FrontDeskStore, env: DeskEnv, callSid: string): Promise<string | null> {
  const st = await fd.state(callSid)
  if (!st || st.gone) return '<Hangup/>'
  if (st.taken) return null
  const s = st.settings
  const why = needsCallback({ waitedSec: st.waited_sec, maxWaitMin: s?.max_wait_min ?? HOLD.maxWaitMin, online: st.online, deskOpen: st.desk_open })
  if (why) return bookCallback(fd, st, callSid, why)
  const m = minutesOf(st)
  await fd.save(callSid, { status: 'holding', estimate_min: m, choice: 'hold' })
  const loops = Math.max(1, Math.round((s?.update_every_sec ?? HOLD.updateEverySec) / TRACK_SEC))
  return `<Gather input="dtmf" numDigits="1" timeout="1" action="${xmlEsc(url(env, 'fd_key', callSid, { allow: '1' }))}" method="POST">` +
    `${say(`${holdUpdate({ ahead: st.ahead, minutes: m })} ${PRESS_1}`)}<Play loop="${loops}">${xmlEsc(trackUrl(s, env))}</Play></Gather>` +
    redirect(env, 'hold', callSid)
}

// ?event=fd_key — a key on the hold line: 1 = a callback, 2 = the e-sign link (when it was offered), else hold.
export async function key(fd: FrontDeskStore, env: DeskEnv, callSid: string, digit: string, allow: string): Promise<string | null> {
  const st = await fd.state(callSid)
  if (!st || st.gone) return '<Hangup/>'
  if (st.taken) return null
  if (digit === '1' && allow.includes('1')) return bookCallback(fd, st, callSid, 'pressed_1')
  if (digit === '2' && allow.includes('2') && st.sms_live) {
    await fd.save(callSid, { choice: 'esign', status: 'esign_requested' })
    return `${say('Done. We’ll text you the link in a few minutes. Sign on your phone, and we’ll send it to your carrier and text you when it’s done. You can stay on the line too.')}${redirect(env, 'hold', callSid)}`
  }
  return redirect(env, 'hold', callSid)
}
