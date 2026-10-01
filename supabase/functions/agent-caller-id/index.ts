import { createClient } from 'npm:@supabase/supabase-js'

// Prompt 666 — an agent verifies their own cell as an outbound Caller ID on the
// "Ohvara" Twilio sub-account, so Fulfillment can call clients showing the
// agent's number (calling on the agent's behalf — never as them).
//
// Twilio's Validation Request flow: we ask Twilio to verify a number, Twilio
// returns a 6-digit code and immediately calls that number; the agent types
// the code into their phone's keypad. We then poll Twilio's Outgoing Caller ID
// list until the number shows up, and only then mark it verified. The
// verification columns on profiles are server-write-only (migration 108).
//
// Actions (POST JSON { action, phone? }):
//   status — { configured, verified_number, pending_number, enabled }
//   start  — begin verifying `phone`; returns { validation_code }
//   check  — poll; returns { verified: boolean }
//   remove — drop the verified number (from Twilio too)
//
// Uses its own CALLER_ID_TWILIO_* secrets on purpose — the plain TWILIO_* names
// belong to an older, unrelated account behind dead pre-pivot functions.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const SID = Deno.env.get('CALLER_ID_TWILIO_ACCOUNT_SID')
const TOKEN = Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN')
const TWILIO_BASE = `https://api.twilio.com/2010-04-01/Accounts/${SID}`

// US numbers only — every agent and client is US.
function toE164(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return null
}

async function twilio(path: string, init: { method?: string; form?: Record<string, string> } = {}) {
  const res = await fetch(`${TWILIO_BASE}${path}`, {
    method: init.method || (init.form ? 'POST' : 'GET'),
    headers: {
      Authorization: `Basic ${btoa(`${SID}:${TOKEN}`)}`,
      ...(init.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: init.form ? new URLSearchParams(init.form) : undefined,
  })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = { message: text } }
  return { ok: res.ok, status: res.status, data }
}

async function findVerified(e164: string) {
  const r = await twilio(`/OutgoingCallerIds.json?PhoneNumber=${encodeURIComponent(e164)}`)
  if (!r.ok) throw new Error(r.data?.message || `Twilio lookup failed (${r.status})`)
  return (r.data?.outgoing_caller_ids || [])[0] || null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const configured = !!(SID && TOKEN)

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '')
  let body: any = {}
  try { body = await req.json() } catch { /* empty body */ }
  const action = body.action || 'status'

  // Deployed with verify_jwt off and authenticates here instead, so an ops
  // check can ask "are the secrets set?" without a user session. Signed-out
  // status only ever returns booleans, never values.
  const { data: { user } } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } }
  if (!user && action === 'status') {
    return json({ configured, has_from_number: !!Deno.env.get('CALLER_ID_TWILIO_FROM_NUMBER') })
  }
  if (!user) return json({ error: 'Not signed in' }, 401)

  const { data: me } = await admin
    .from('profiles')
    .select('id, role, full_name, caller_id_number, caller_id_twilio_sid, caller_id_pending_number, caller_id_pending_at, caller_id_enabled')
    .eq('id', user.id)
    .single()
  if (!me || !['agent', 'admin'].includes(me.role)) return json({ error: 'Only agents can set a Caller ID' }, 403)

  if (action === 'status') {
    return json({
      configured,
      verified_number: me.caller_id_number,
      pending_number: me.caller_id_pending_number,
      enabled: me.caller_id_enabled,
    })
  }

  if (!configured) {
    return json({ error: 'Calling isn\'t set up yet — the Twilio account hasn\'t been connected.', code: 'not_configured' }, 503)
  }

  try {
    if (action === 'start') {
      const e164 = toE164(body.phone)
      if (!e164) return json({ error: 'Enter a 10-digit US number.' }, 400)

      // A number can back one agent only.
      const { data: taken } = await admin
        .from('profiles').select('id').eq('caller_id_number', e164).neq('id', me.id).limit(1)
      if (taken?.length) return json({ error: 'That number is already verified for another agent.' }, 409)

      // If Twilio already has it (e.g. added as a trial tester in the console),
      // it was never proven by *this* agent — clear it and verify fresh rather
      // than trusting the existing entry.
      const existing = await findVerified(e164)
      if (existing && existing.sid === me.caller_id_twilio_sid) {
        return json({ error: 'That number is already your verified Caller ID.' }, 409)
      }
      if (existing) await twilio(`/OutgoingCallerIds/${existing.sid}.json`, { method: 'DELETE' })

      const r = await twilio('/OutgoingCallerIds.json', {
        form: { PhoneNumber: e164, FriendlyName: `Ohvara agent — ${me.full_name || me.id}`.slice(0, 64) },
      })
      if (!r.ok) return json({ error: r.data?.message || 'Twilio couldn\'t start verification.' }, 502)

      await admin.from('profiles').update({
        caller_id_pending_number: e164,
        caller_id_pending_at: new Date().toISOString(),
      }).eq('id', me.id)

      return json({ validation_code: r.data.validation_code, phone: e164 })
    }

    if (action === 'check') {
      if (!me.caller_id_pending_number) return json({ verified: !!me.caller_id_number })
      const hit = await findVerified(me.caller_id_pending_number)
      // Only accept an entry created after this agent's own request.
      const startedAt = new Date(me.caller_id_pending_at).getTime() - 60e3
      if (!hit || new Date(hit.date_created).getTime() < startedAt) return json({ verified: false })

      // Replacing an older number: drop it from Twilio so it can't linger.
      if (me.caller_id_twilio_sid && me.caller_id_twilio_sid !== hit.sid) {
        await twilio(`/OutgoingCallerIds/${me.caller_id_twilio_sid}.json`, { method: 'DELETE' })
      }
      await admin.from('profiles').update({
        caller_id_number: hit.phone_number,
        caller_id_twilio_sid: hit.sid,
        caller_id_verified_at: new Date().toISOString(),
        caller_id_pending_number: null,
        caller_id_pending_at: null,
        caller_id_enabled: true,
      }).eq('id', me.id)
      return json({ verified: true, verified_number: hit.phone_number })
    }

    if (action === 'remove') {
      if (me.caller_id_twilio_sid) {
        await twilio(`/OutgoingCallerIds/${me.caller_id_twilio_sid}.json`, { method: 'DELETE' })
      }
      await admin.from('profiles').update({
        caller_id_number: null,
        caller_id_twilio_sid: null,
        caller_id_verified_at: null,
        caller_id_pending_number: null,
        caller_id_pending_at: null,
      }).eq('id', me.id)
      return json({ removed: true })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (e) {
    return json({ error: (e as Error).message || 'Twilio request failed' }, 502)
  }
})
