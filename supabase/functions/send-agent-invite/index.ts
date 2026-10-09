// send-agent-invite — Prompt 731. An agent invites another agent from the
// account menu ("Invite an agent"); Ohvara sends a personal single-use
// /join/<token> link by text or email and the agent never sees it.
//
// Deployed with verify_jwt ON (called from the signed-in app):
//   supabase functions deploy send-agent-invite --project-ref jjextitmbptoaolacocs
//
//   { action: 'status' }                    → { email, sms } — which channels can send
//   { action: 'send', channel, to }         → { ok: true } (nothing else, ever)
//
// Email: Resend (RESEND_API_KEY, INVITE_FROM_EMAIL on a Resend-verified domain).
// Text: the same Twilio account/number as recovery-sms, and only once
// recovery_config.sms_live is on (the number is SMS-capable and A2P-registered).
// All the rules live in logic.ts; this file wires the database, env and fetch.
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, type Channel, type Deps } from './logic.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const destColumn = (c: Channel) => (c === 'email' ? 'invited_email' : 'invited_phone')
const likeEscape = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`)

const deps: Deps = {
  env: {
    resendKey: Deno.env.get('RESEND_API_KEY'),
    fromEmail: Deno.env.get('INVITE_FROM_EMAIL'),
    twilioSid: Deno.env.get('RECOVERY_TWILIO_ACCOUNT_SID') ?? Deno.env.get('CALLER_ID_TWILIO_ACCOUNT_SID'),
    twilioToken: Deno.env.get('RECOVERY_TWILIO_AUTH_TOKEN') ?? Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN'),
    twilioFrom: Deno.env.get('RECOVERY_TWILIO_FROM_NUMBER') ?? Deno.env.get('CALLER_ID_TWILIO_FROM_NUMBER'),
    appUrl: Deno.env.get('PUBLIC_APP_URL'),
  },
  async caller(jwt) {
    const { data } = await db.auth.getUser(jwt)
    if (!data?.user) return null
    const { data: p } = await db.from('profiles').select('role, is_active, full_name').eq('id', data.user.id).maybeSingle()
    return { id: data.user.id, role: p?.role ?? null, is_active: p?.is_active ?? null, full_name: p?.full_name ?? null }
  },
  async smsLive() {
    const { data } = await db.from('recovery_config').select('sms_live').maybeSingle()
    return !!data?.sms_live
  },
  async countSent(createdBy, since, dest) {
    let q = db.from('rep_invites').select('id', { count: 'exact', head: true })
      .eq('created_by', createdBy).gte('created_at', since)
    if (dest) q = q.eq(destColumn(dest.channel), dest.to)
    const { count, error } = await q
    if (error) throw error
    return count ?? 0
  },
  async emailHasAccount(email) {
    // profiles.email mirrors auth.users.email (handle_new_user); case-insensitive exact match.
    const { data, error } = await db.from('profiles').select('id').ilike('email', likeEscape(email)).limit(1)
    if (error) throw error
    return (data?.length ?? 0) > 0
  },
  async expireLive(createdBy, dest, at) {
    const { error } = await db.from('rep_invites').update({ expires_at: at })
      .eq('created_by', createdBy).eq(destColumn(dest.channel), dest.to)
      .is('used_at', null).gt('expires_at', at)
    if (error) throw error
  },
  async insertInvite(row) {
    const { data, error } = await db.from('rep_invites').insert(row).select('id').single()
    if (error) throw error
    return data.id
  },
  async deleteInvite(id) {
    const { error } = await db.from('rep_invites').delete().eq('id', id)
    if (error) console.error('[send-agent-invite] cleanup failed:', error.message)
  },
  fetch: (...a) => fetch(...a),
  randomBytes(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return b },
  now: () => new Date(),
  log: m => console.error('[send-agent-invite]', m),
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  try {
    const r = await handle(deps, jwt, body)
    return json(r.body, r.status)
  } catch (err) {
    // Never the destination or token — only the error text.
    console.error('[send-agent-invite]', err instanceof Error ? err.message : String(err))
    return json({ error: "Couldn't send that. Try again." }, 500)
  }
})
