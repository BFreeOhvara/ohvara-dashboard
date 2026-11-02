// Prompt 776 — the client texts, word for word as registered with Twilio for
// the A2P campaign (CMf63d92…). Change a body here only after the campaign's
// samples are changed to match: unregistered content risks the campaign.
// No Deno APIs, so node --test can load it.

export type Sample = 'missed' | 'reminder' | 'sorry'

export type Row = {
  policy_id: string; kind: string; sample: Sample; needs_confirm: boolean
  first_name: string; phone: string; agent_name: string | null; carrier: string
  tried_at: string | null; retry_at: string | null; token: string; tz: string
}

export const OPT_IN_REPLY =
  "Ohvara: You're opted in to texts about your call to cancel your old insurance policy. Up to 4 msgs per call. Msg & data rates may apply. Reply HELP for help, STOP to opt out."

export const HELP_REPLY =
  'Ohvara: Help with texts about your cancellation call: email support@ohvara.com. Up to 4 msgs per call. Msg & data rates may apply. Reply STOP to opt out.'

export const STOP_REPLY =
  "Ohvara: You're opted out and won't get more texts about your call. Reply START to opt back in."

// "2:30 PM CDT" in the client's zone.
export function timeText(iso: string, tz: string) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short' })
    .format(new Date(iso)).replace(/ /g, ' ')
}

// portal.ohvara.com/r/<code> — no scheme, as registered.
export function shortLink(appUrl: string, token: string) {
  return `${appUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}/r/${token}`
}

export function confirmation(carrier: string) {
  return `Ohvara: You're set to get texts about your call with Ohvara (ohvara.com) to cancel your old ${carrier} policy. Up to 4 msgs per call. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`
}

export function compose(r: Row, appUrl: string): string {
  const link = shortLink(appUrl, r.token)
  const tried = r.tried_at ? timeText(r.tried_at, r.tz) : ''
  const retry = r.retry_at ? timeText(r.retry_at, r.tz) : ''
  switch (r.sample) {
    case 'missed':
      return `Ohvara: Hi ${r.first_name}, this is the call your agent ${r.agent_name} booked to cancel your old ${r.carrier} policy. We tried you at ${tried} and missed you. Pick a new time here: ${link}. Reply STOP to opt out.`
    case 'reminder':
      return `Ohvara: Reminder, we're calling you today at ${retry} about cancelling your old ${r.carrier} policy. Need a different time? ${link}. Reply STOP to opt out.`
    case 'sorry':
      return `Ohvara: Sorry ${r.first_name}, we missed your ${tried} call today. We'll call you tomorrow at ${retry} instead, or pick another time: ${link}. Reply STOP to opt out.`
  }
  throw new Error(`No registered text for sample ${r.sample}`)
}

export type SendResult = { ok: boolean; sid?: string; error?: string }

export type Deps = {
  claim(fn: string): Promise<Row[]>                       // hands back nothing until sms_live is on
  mark(fn: string, r: Row, result: SendResult): Promise<void>   // writes the recovery_sms_log row
  logConfirm(r: Row, result: SendResult): Promise<void>         // same, kind 'confirm'
  send(to: string, body: string): Promise<SendResult>
  // recovery_sms_log.body (219) on the row mark / logConfirm just wrote.
  keepWords(policyId: string, kind: string, sid: string, body: string): Promise<void>
  appUrl: string
}

// P696 no-answer texts, then P771 missed-by-us apologies.
const QUEUES = [['recovery_claim_due', 'recovery_mark_sent'], ['missed_claim_due', 'missed_mark_sent']]

// One run: send what each queue hands back and report each result. The SQL
// functions write the log rows and don't take the words, so they are added to
// the row right after, found by its Twilio sid. Only a text Twilio took has
// words kept, and a miss here never holds up the next text.
export async function sendDue(deps: Deps) {
  let claimed = 0, sent = 0, failed = 0
  const keep = async (r: Row, kind: string, result: SendResult, body: string) => {
    if (!result.ok || !result.sid) return
    try {
      await deps.keepWords(r.policy_id, kind, result.sid, body)
    } catch (err) {
      console.error('[recovery-sms] keepWords', err instanceof Error ? err.message : String(err))
    }
  }
  for (const [claim, mark] of QUEUES) {
    const rows = await deps.claim(claim)
    claimed += rows.length
    for (const r of rows) {
      // The booking's first text: the registered confirmation goes first.
      // If it fails, the text waits for the next run (the claim re-offers it
      // in 15 minutes; after 3 failed confirmations SQL skips the texts).
      if (r.needs_confirm) {
        const words = confirmation(r.carrier)
        const c = await deps.send(r.phone, words)
        await deps.logConfirm(r, c)
        await keep(r, 'confirm', c, words)
        if (c.ok) sent++; else { failed++; continue }
      }
      const words = compose(r, deps.appUrl)
      const result = await deps.send(r.phone, words)
      await deps.mark(mark, r, result)
      await keep(r, r.kind, result, words)
      if (result.ok) sent++; else failed++
    }
  }
  return { configured: true, claimed, sent, failed }
}

// Twilio's opt-out / opt-in / help keywords (the Messaging Service defaults).
const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT']
const START_WORDS = ['START', 'YES', 'UNSTOP']
const HELP_WORDS = ['HELP', 'INFO']

// What an inbound text means. Twilio's OptOutType (sent when the service's
// opt-out management is on) wins over our own keyword match.
export function inboundIntent(body: string, optOutType?: string | null): 'stop' | 'start' | 'help' | null {
  const t = (optOutType || '').toUpperCase()
  if (t === 'STOP') return 'stop'
  if (t === 'START') return 'start'
  if (t === 'HELP') return 'help'
  const word = (body || '').trim().toUpperCase().replace(/[^A-Z]/g, '')
  if (STOP_WORDS.includes(word)) return 'stop'
  if (START_WORDS.includes(word)) return 'start'
  if (HELP_WORDS.includes(word)) return 'help'
  return null
}
