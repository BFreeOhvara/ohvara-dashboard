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
