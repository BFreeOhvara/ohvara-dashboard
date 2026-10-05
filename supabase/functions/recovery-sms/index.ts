// Prompt 696 — the SMS half of the no-answer recovery flow.
//
// Called every 5 minutes by pg_cron (service-role bearer). Claims the texts
// that are due (recovery_claim_due — which hands back nothing until
// recovery_config.sms_live is on), sends each through Twilio, and reports the
// result back (recovery_mark_sent) so the lead moves to its next step.
//
// Also answers { action: 'status' } for an admin's Settings panel: is a
// sender configured, and is that number actually SMS-capable.
//
// Twilio credentials: RECOVERY_TWILIO_* if set, else the Caller ID account's
// CALLER_ID_TWILIO_ACCOUNT_SID / _AUTH_TOKEN. The sending number is
// RECOVERY_TWILIO_FROM_NUMBER, else CALLER_ID_TWILIO_FROM_NUMBER. It must be
// SMS-capable and registered for A2P 10DLC or carriers will filter the texts.
import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const SID = Deno.env.get('RECOVERY_TWILIO_ACCOUNT_SID') ?? Deno.env.get('CALLER_ID_TWILIO_ACCOUNT_SID')
const TOKEN = Deno.env.get('RECOVERY_TWILIO_AUTH_TOKEN') ?? Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN')
const FROM = Deno.env.get('RECOVERY_TWILIO_FROM_NUMBER') ?? Deno.env.get('CALLER_ID_TWILIO_FROM_NUMBER')
const APP_URL = (Deno.env.get('PUBLIC_APP_URL') ?? 'https://portal.ohvara.com').replace(/\/$/, '')
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY)
const configured = !!(SID && TOKEN && FROM)
const auth = () => `Basic ${btoa(`${SID}:${TOKEN}`)}`

function toE164(raw: string): string | null {
  const d = String(raw || '').replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return null
}

const ymd = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)

function timeText(iso: string, tz: string) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short' })
    .format(new Date(iso))
}

function dayText(iso: string, tz: string) {
  const at = new Date(iso)
  const today = ymd(new Date(), tz)
  const tomorrow = ymd(new Date(Date.now() + 24 * 3600e3), tz)
  const day = ymd(at, tz)
  if (day === today) return 'today'
  if (day === tomorrow) return 'tomorrow'
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz }).format(at)
}

type Row = {
  policy_id: string; kind: 'text1' | 'text2' | 'am' | 'pm'; first_name: string; phone: string
  retry_at: string | null; token: string; agent_name: string | null; tz: string
}

function compose(r: Row): string {
  const agentFirst = (r.agent_name || '').trim().split(/\s+/)[0]
  const who = agentFirst ? `${agentFirst}'s team at Ohvara` : 'Ohvara'
  const link = `${APP_URL}/r/${r.token}`
  const stop = 'Reply STOP to opt out.'
  const when = r.retry_at ? `${dayText(r.retry_at, r.tz)} at ${timeText(r.retry_at, r.tz)}` : ''
  switch (r.kind) {
    case 'text1':
      return `Hi ${r.first_name}, it's ${who}. We tried to reach you about your insurance call and missed you. We've saved a retry for ${when}. Need a different time? ${link} ${stop}`
    case 'text2':
      return `Hi ${r.first_name}, a reminder from ${who}: we're calling you ${when}. Need a different time, or sooner? ${link} ${stop}`
    case 'am':
      return `Hi ${r.first_name}, it's ${who}. We still haven't been able to reach you about your insurance call. Pick a time that works and we'll call you then: ${link} ${stop}`
    default:
      return `Hi ${r.first_name}, one last note from ${who}: we'd still like to get your call on the calendar. Choose a time here: ${link} ${stop}`
  }
}

async function sendSms(to: string, body: string): Promise<{ ok: boolean; sid?: string; error?: string }> {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: FROM!, Body: body }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: `${res.status} ${data?.code ?? ''} ${data?.message ?? ''}`.trim() }
  return { ok: true, sid: data.sid }
}

// Is the sending number a Twilio number on this account, and can it text?
async function senderStatus() {
  if (!configured) {
    return { configured: false, missing: [!SID && 'account SID', !TOKEN && 'auth token', !FROM && 'from number'].filter(Boolean) }
  }
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(FROM!)}`,
    { headers: { Authorization: auth() } },
  )
  if (!res.ok) return { configured: true, from: FROM, sms_capable: null, error: `Twilio ${res.status}` }
  const data = await res.json()
  const num = data?.incoming_phone_numbers?.[0]
  return {
    configured: true, from: FROM,
    owned: !!num,                         // false = a verified caller ID, not a purchased number
    sms_capable: num ? !!num.capabilities?.sms : false,
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const isWorker = bearer === SERVICE_KEY

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
    const { data: rows, error } = await supabase.rpc('recovery_claim_due', { p_limit: 25 })
    if (error) throw error

    let sent = 0, failed = 0
    for (const r of (rows ?? []) as Row[]) {
      const to = toE164(r.phone)
      const result = to ? await sendSms(to, compose(r)) : { ok: false, error: 'Unusable phone number' }
      const { error: markErr } = await supabase.rpc('recovery_mark_sent', {
        p_policy: r.policy_id, p_kind: r.kind, p_ok: result.ok,
        p_sid: result.sid ?? null, p_error: result.error ?? null, p_phone: to ?? r.phone,
      })
      if (markErr) console.error('[recovery-sms] mark_sent', markErr.message)
      if (result.ok) sent++; else failed++
    }
    return json({ configured: true, claimed: rows?.length ?? 0, sent, failed })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[recovery-sms]', msg)
    return json({ error: msg }, 500)
  }
})
