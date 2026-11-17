// payment-intake — P885 + P1027, forwarded carrier notices → payment_intake_receive(). Logic: core.ts.
//
// Each agent forwards carrier notices to their own address, <name>-<4>@notices.ohvara.com (payment_settings.intake_domain).
// Resend Receiving (MX on notices.ohvara.com) posts an email.received webhook here; we fetch the email from the
// Receiving API. Postmark / plain JSON with the shared secret still work (tests, a manual replay).
// Deploy with --no-verify-jwt (mail services have no JWT; core.ts checks the signature / secret on every request):
//   npx.cmd supabase functions deploy payment-intake --no-verify-jwt --project-ref jjextitmbptoaolacocs
// Secrets: RESEND_API_KEY (already set), RESEND_INBOUND_SECRET (the webhook's whsec_ signing secret),
//   PAYMENT_INTAKE_SECRET (Postmark/plain), ANTHROPIC_API_KEY (optional: the AI reader for unclear notices).
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, type AiRead, type Store } from './core.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const RESEND = Deno.env.get('RESEND_API_KEY')
const ANTHROPIC = Deno.env.get('ANTHROPIC_API_KEY')

const store: Store = {
  async receive(token, messageId, from, subject, body, parsed) {
    const { data, error } = await admin.rpc('payment_intake_receive', {
      p_token: token, p_message_id: messageId, p_from: from, p_subject: subject, p_body: body, p_parsed: parsed,
    })
    if (error) throw error
    return data
  },
  async gmailCode(token, code, link, forAddr) {
    const { data, error } = await admin.rpc('payment_intake_gmail_code', { p_token: token, p_code: code, p_link: link, p_for: forAddr })
    if (error) throw error
    return data
  },
}

async function fetchResend(id: string) {
  if (!RESEND || !/^[A-Za-z0-9-]{8,80}$/.test(id)) return null
  const r = await fetch(`https://api.resend.com/emails/receiving/${id}`, { headers: { authorization: `Bearer ${RESEND}` } })
  return r.ok ? await r.json() : null
}

const PROMPT = `You read one email an insurance agent forwarded from a life insurance carrier. Reply with JSON only:
{"category": one of "failed" (a premium payment failed or was not received), "returned" (bank returned/NSF), "grace" (policy is in its grace period), "pending_lapse" (will lapse/terminate soon), "lapsed" (has lapsed/terminated), "login" (says to log in to view a notice, no details), "paid" (payment received), "ignore" (not about a specific policy: marketing, newsletter, commissions, a test), "other" (about a policy, but none of these),
 "policy_number": string or null, "client_name": the insured's name or null, "due_date": "YYYY-MM-DD" or null, "amount": "12.34" or null}`

const ai: AiRead | undefined = ANTHROPIC ? async (subject, text) => {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-5-5', max_tokens: 300, system: PROMPT,
      messages: [{ role: 'user', content: `Subject: ${subject}\n\n${text}` }],
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!r.ok) return null
  const out = await r.json()
  const t = (out?.content?.[0]?.text ?? '') as string
  const j = t.match(/\{[\s\S]*\}/)
  return j ? JSON.parse(j[0]) : null
} : undefined

Deno.serve(req => handle(req, store, Deno.env.get('PAYMENT_INTAKE_SECRET'), {
  resendSecret: Deno.env.get('RESEND_INBOUND_SECRET'), fetchResend, ai,
}))
