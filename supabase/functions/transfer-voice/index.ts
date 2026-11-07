// transfer-voice — P880, the Twilio side of the live transfer: the lead's hold music, the agent's whisper and
// "press 1", the accept (cold hand-off), the agent leg's status (bounce-back), plus the agent phone's "seen"
// ping. Logic: help-transfer/core.ts handleVoice. No JWT: Twilio requests carry X-Twilio-Signature (checked
// here); the seen ping carries the check's seen_token instead.
//
// Deploy without JWT verification:
//   npx.cmd supabase functions deploy transfer-voice --no-verify-jwt --project-ref jjextitmbptoaolacocs
import { handleVoice } from '../help-transfer/core.ts'
import { store, twilio, env } from '../help-transfer/wiring.ts'
import { readTwilioRequest } from '../_shared/twilio.ts'

const AUTH = Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN')
const PUBLIC_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/transfer-voice`

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const q = new URL(req.url).searchParams
  const event = q.get('event') || ''
  if (event === 'seen') return handleVoice(event, q, {}, store, twilio, env, false)
  if (!AUTH) return new Response('Not configured', { status: 503 })
  const { form, query, ok } = await readTwilioRequest(req, AUTH, PUBLIC_URL)
  return handleVoice(event, query, form, store, env.configured ? twilio : null, env, ok)
})
