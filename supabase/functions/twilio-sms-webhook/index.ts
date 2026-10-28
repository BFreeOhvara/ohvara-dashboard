// twilio-sms-webhook — inbound texts to the "Ohvara Texts" Messaging Service
// (Prompt 776; replaces the pre-pivot appointments version, which was retired).
//
// Deploy WITHOUT jwt verification (Twilio calls this directly), then set it as
// the Messaging Service's Integration → "Send a webhook" request URL:
//   https://jjextitmbptoaolacocs.supabase.co/functions/v1/twilio-sms-webhook
//
// Records opt-outs: STOP (and Twilio's other opt-out words) marks the number
// opted out in sms_opt_outs so nothing is queued to it again; START / YES /
// UNSTOP undoes it. Every other text is a lead's reply and is saved to
// lead_sms_replies for the VA queue (needs the lead_sms_replies migration).
// The replies to STOP / START / HELP are Twilio's (Messaging Service →
// Opt-Out Management), so we answer with empty TwiML and a client never gets
// two replies. Requests must carry Twilio's signature. Logic: core.ts.
import { createClient } from 'npm:@supabase/supabase-js'
import { handle } from './core.ts'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const TOKEN = Deno.env.get('RECOVERY_TWILIO_AUTH_TOKEN') ?? Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN')
const PUBLIC_URL = `${Deno.env.get('SUPABASE_URL')!.replace(/\/$/, '')}/functions/v1/twilio-sms-webhook`

Deno.serve(req => handle(req, {
  token: TOKEN,
  publicUrl: PUBLIC_URL,
  rpc: (fn, args) => supabase.rpc(fn, args),
  insertReply: row => supabase.from('lead_sms_replies').insert(row),
  log: msg => console.error(msg),
}))
