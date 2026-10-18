// Prompt 696 — the SMS half of the no-answer recovery flow.
//
// Called every 5 minutes by pg_cron (service-role bearer). Claims the texts
// that are due (recovery_claim_due — which hands back nothing until
// recovery_config.sms_live is on), sends each through Twilio, and reports the
// result back (recovery_mark_sent) so the lead moves to its next step.
//
// Prompt 771: the same run also sends the two "sorry we missed your call"
// texts for a call a rep missed (missed_claim_due / missed_mark_sent).
//
// Also answers { action: 'status' } for an admin's Settings panel: is a
// sender configured, and is that number actually SMS-capable.
//
// Prompt 776: every text goes through the "Ohvara Texts" Messaging Service
// (TWILIO_MESSAGING_SERVICE_SID, the sender pool Twilio's A2P campaign covers),
// never a bare From number, and the bodies are the registered samples
// (core.ts). Who may be texted is decided in SQL (sms_check, migration 157):
// consent on the booking, agent opt-in, not opted out, 8 AM–9 PM client time,
// max 4 per call with the one-time confirmation first.
//
// Twilio credentials: RECOVERY_TWILIO_* if set, else the Caller ID account's
// CALLER_ID_TWILIO_ACCOUNT_SID / _AUTH_TOKEN.
import { createClient } from 'npm:@supabase/supabase-js'
import { isCron } from '../_shared/cronAuth.ts'
import { compose, confirmation, type Row } from './core.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const SID = Deno.env.get('RECOVERY_TWILIO_ACCOUNT_SID') ?? Deno.env.get('CALLER_ID_TWILIO_ACCOUNT_SID')
const TOKEN = Deno.env.get('RECOVERY_TWILIO_AUTH_TOKEN') ?? Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN')
const SERVICE = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID')
const APP_URL = (Deno.env.get('PUBLIC_APP_URL') ?? 'https://portal.ohvara.com').replace(/\/$/, '')
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY)
const configured = !!(SID && TOKEN && SERVICE)
const auth = () => `Basic ${btoa(`${SID}:${TOKEN}`)}`

async function sendSms(to: string, body: string): Promise<{ ok: boolean; sid?: string; error?: string }> {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, MessagingServiceSid: SERVICE!, Body: body }),
  })
  const data = await res.json().catch(() => ({}))
  // Status + Twilio's code only (21610 = the number replied STOP); the message can quote the number.
  if (!res.ok) return { ok: false, error: `${res.status} ${data?.code ?? ''}`.trim() }
  return { ok: true, sid: data.sid }
}

// The Messaging Service and the numbers in its sender pool.
async function senderStatus() {
  if (!configured) {
    return { configured: false, missing: [!SID && 'account SID', !TOKEN && 'auth token', !SERVICE && 'TWILIO_MESSAGING_SERVICE_SID'].filter(Boolean) }
  }
  const res = await fetch(`https://messaging.twilio.com/v1/Services/${SERVICE}/PhoneNumbers?PageSize=20`, { headers: { Authorization: auth() } })
  if (!res.ok) return { configured: true, service: SERVICE, senders: null, error: `Twilio ${res.status}` }
  const data = await res.json()
  const senders = (data?.phone_numbers ?? []).map((n: any) => ({ number: n.phone_number, sms_capable: !!n.capabilities?.includes?.('SMS') || !!n.capabilities?.sms }))
  return {
    configured: true, service: SERVICE, senders,
    sms_capable: senders.some((n: { sms_capable: boolean }) => n.sms_capable),
    from: senders[0]?.number ?? null,
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  // pg_cron sends the Vault secret (P767); the service key still works too.
  const isWorker = bearer === SERVICE_KEY || await isCron(req, supabase)

  if (!isWorker) {
    // An admin asking about the sender; nothing else is open to users.
    const { data: u } = await supabase.auth.getUser(bearer)
    if (!u?.user) return json({ error: 'Unauthorized' }, 401)
    const { data: p } = await supabase.from('profiles').select('role').eq('id', u.user.id).single()
    if (p?.role !== 'admin') return json({ error: 'Admins only' }, 403)
    return json(await senderStatus())
  }

  try {
    if (!configured) return json({ configured: false, sent: 0 })
    let claimed = 0, sent = 0, failed = 0
    // P696 no-answer texts, then P771 missed-by-us apologies. Each claim
    // function hands back nothing until recovery_config.sms_live is on.
    for (const [claim, mark] of [['recovery_claim_due', 'recovery_mark_sent'], ['missed_claim_due', 'missed_mark_sent']]) {
      const { data: rows, error } = await supabase.rpc(claim, { p_limit: 25 })
      if (error) throw error
      claimed += rows?.length ?? 0
      for (const r of (rows ?? []) as Row[]) {
        // The booking's first text: the registered confirmation goes first.
        // If it fails, the text waits for the next run (the claim re-offers it
        // in 15 minutes; after 3 failed confirmations SQL skips the texts).
        if (r.needs_confirm) {
          const c = await sendSms(r.phone, confirmation(r.carrier))
          const { error: cErr } = await supabase.rpc('sms_log_confirm', {
            p_policy: r.policy_id, p_ok: c.ok, p_sid: c.sid ?? null, p_error: c.error ?? null, p_phone: r.phone,
          })
          if (cErr) console.error('[recovery-sms] sms_log_confirm', cErr.message)
          if (c.ok) sent++; else { failed++; continue }
        }
        const result = await sendSms(r.phone, compose(r, APP_URL))
        const { error: markErr } = await supabase.rpc(mark, {
          p_policy: r.policy_id, p_kind: r.kind, p_ok: result.ok,
          p_sid: result.sid ?? null, p_error: result.error ?? null, p_phone: r.phone,
        })
        if (markErr) console.error(`[recovery-sms] ${mark}`, markErr.message)
        if (result.ok) sent++; else failed++
      }
    }
    return json({ configured: true, claimed, sent, failed })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[recovery-sms]', msg)
    return json({ error: msg }, 500)
  }
})
