// twilio-sms-webhook logic, with the database passed in so tests can run it
// without Supabase. No Deno APIs, so node --test can load it.
//
// Order: Twilio's signature first. STOP / START (and Twilio's other opt words)
// only update sms_opt_outs, exactly as before. Any other text (HELP included)
// is a reply for the VA queue: saved once per MessageSid in lead_sms_replies,
// tied to the newest lead with that phone (or none). We never reply ourselves:
// the answer is always empty TwiML, and nothing here can send a text.
// Logs carry error text only, never the phone or the message body.
import { readTwilioRequest } from '../_shared/twilio.ts'
import { inboundIntent } from '../recovery-sms/core.ts'

export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
export const MAX_BODY = 1600   // Twilio's longest inbound message

type DbError = { message: string; code?: string } | null

export type ReplyRow = { twilio_sid: string; from_phone: string; body: string; lead_id: string | null }

export type Deps = {
  token: string | undefined
  publicUrl: string
  // PromiseLike: supabase-js query builders are thenables, not Promises.
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError }>
  insertReply(row: ReplyRow): PromiseLike<{ error: DbError }>
  log(msg: string): void
}

// The reply to save for an inbound text, or null when it isn't one: STOP /
// START texts are opt changes, and a text without a sender or MessageSid
// can't be tied to anyone or saved once.
export function replyToSave(form: Record<string, string>, intent: ReturnType<typeof inboundIntent>) {
  if (intent === 'stop' || intent === 'start') return null
  const twilio_sid = (form.MessageSid || form.SmsSid || '').trim()
  const from_phone = (form.From || '').trim()
  if (!twilio_sid || !from_phone) return null
  return { twilio_sid, from_phone, body: (form.Body || '').slice(0, MAX_BODY) }
}

const twiml = () => new Response(EMPTY_TWIML, { headers: { 'Content-Type': 'text/xml' } })
const retry = () => new Response('Error', { status: 500 })   // Twilio retries

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!deps.token) return new Response('Not configured', { status: 503 })
  const { form, ok } = await readTwilioRequest(req, deps.token, deps.publicUrl)
  if (!ok) return new Response('Bad signature', { status: 403 })

  const intent = inboundIntent(form.Body || '', form.OptOutType)
  if ((intent === 'stop' || intent === 'start') && form.From) {
    const { error } = await deps.rpc('sms_set_opt', {
      p_phone: form.From, p_opted_out: intent === 'stop', p_source: intent === 'stop' ? 'STOP' : 'START',
    })
    if (error) {
      deps.log(`[twilio-sms-webhook] sms_set_opt ${error.message}`)
      return retry()
    }
  }

  const reply = replyToSave(form, intent)
  if (reply) {
    const match = await deps.rpc('lead_sms_match', { p_phone: reply.from_phone })
    if (match.error) {
      deps.log(`[twilio-sms-webhook] lead_sms_match ${match.error.message}`)
      return retry()
    }
    const { error } = await deps.insertReply({ ...reply, lead_id: typeof match.data === 'string' ? match.data : null })
    // 23505: this MessageSid is already saved (a Twilio retry), so it's done.
    if (error && error.code !== '23505') {
      deps.log(`[twilio-sms-webhook] save reply ${error.message}`)
      return retry()
    }
  }
  return twiml()
}
