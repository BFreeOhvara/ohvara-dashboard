// twilio-sms-webhook — inbound texts to the "Ohvara Texts" Messaging Service
// (Prompt 776; replaces the pre-pivot appointments version, which was retired).
//
// Deploy WITHOUT jwt verification (Twilio calls this directly), then set it as
// the Messaging Service's Integration → "Send a webhook" request URL:
//   https://jjextitmbptoaolacocs.supabase.co/functions/v1/twilio-sms-webhook
//
// Only records opt-outs: STOP (and Twilio's other opt-out words) marks the
// number opted out in sms_opt_outs so nothing is queued to it again; START /
// YES / UNSTOP undoes it. The replies to STOP / START / HELP are Twilio's
// (Messaging Service → Opt-Out Management), so we answer with empty TwiML and
// a client never gets two replies. Requests must carry Twilio's signature.
import { createClient } from 'npm:@supabase/supabase-js'
import { readTwilioRequest } from '../_shared/twilio.ts'
import { inboundIntent } from '../recovery-sms/core.ts'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const TOKEN = Deno.env.get('RECOVERY_TWILIO_AUTH_TOKEN') ?? Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN')
const PUBLIC_URL = `${Deno.env.get('SUPABASE_URL')!.replace(/\/$/, '')}/functions/v1/twilio-sms-webhook`

const twiml = () => new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
  headers: { 'Content-Type': 'text/xml' },
})

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!TOKEN) return new Response('Not configured', { status: 503 })
  const { form, ok } = await readTwilioRequest(req, TOKEN, PUBLIC_URL)
  if (!ok) return new Response('Bad signature', { status: 403 })

  const intent = inboundIntent(form.Body || '', form.OptOutType)
  if ((intent === 'stop' || intent === 'start') && form.From) {
    const { error } = await supabase.rpc('sms_set_opt', {
      p_phone: form.From, p_opted_out: intent === 'stop', p_source: intent === 'stop' ? 'STOP' : 'START',
    })
    if (error) {
      console.error('[twilio-sms-webhook] sms_set_opt', error.message)
      return new Response('Error', { status: 500 })   // Twilio retries
    }
  }
  return twiml()
})
