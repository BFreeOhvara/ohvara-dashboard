// self-signup — public sign-up for agents with no invite. All the rules live
// in core.ts; this file wires the database, env and auth.
//
// Deployed with verify_jwt DISABLED (the signed-out page calls it):
//   supabase functions deploy self-signup --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
//   { action: 'status' } → { open } — so the signed-out page can hide itself
//   { action: 'signup', full_name, email, password, agree_terms } → { ok: true },
//     the same answer whether or not the email already has an account
//     | 403 closed | 400 a field is wrong | 429 too many tries | 500 { error }
//
// Secrets: FORM_IP_SALT (required: with none, every sign-up is refused rather
// than storing a guessable hash), SELF_SIGNUP_TEST_EMAILS (optional, comma-
// separated, works while sign-up is closed), RESEND_API_KEY + INVITE_FROM_EMAIL
// (the confirm link, same sender as invites).
import { createClient } from 'npm:@supabase/supabase-js'
import { sendConfirmEmail } from '../_shared/confirmEmail.ts'
import { clientIp, hashIp } from '../_shared/ipLimit.ts'
import { isLockedSelfSignup } from '../_shared/portalAccess.ts'
import { handle, MSG, type Deps } from './core.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const likeEscape = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`)

const deps: Deps = {
  testEmails: Deno.env.get('SELF_SIGNUP_TEST_EMAILS') ?? '',
  async signupOpen() {
    const { data, error } = await db.from('app_settings').select('self_signup_open').eq('id', 1).maybeSingle()
    if (error) throw new Error(error.code ?? 'settings_read_failed')
    return data?.self_signup_open === true
  },
  // Salted sha-256; the same salt covers the IP and the email. Only hashes are stored.
  hash: value => hashIp(value),
  async countAttempts(column, hash, since) {
    const { count, error } = await db.from('signup_attempts').select('created_at', { count: 'exact', head: true })
      .eq(column, hash).gt('created_at', since)
    if (error) throw new Error('signup_attempts_count_failed')
    return count ?? 0
  },
  async recordAttempt(ipHash, emailHash, at) {
    const { error } = await db.from('signup_attempts').insert({ ip_hash: ipHash, email_hash: emailHash, created_at: at })
    if (error) throw new Error('signup_attempts_record_failed')
  },
  async findAccount(email) {
    const { data, error } = await db.from('profiles')
      .select('id, signup_source, email_confirm_pending, is_active')
      .ilike('email', likeEscape(email)).is('deleted_at', null).limit(1)
    if (error) throw new Error('account_lookup_failed')
    return data?.[0] ?? null
  },
  isLocked: userId => isLockedSelfSignup(db, userId),
  async savePending(row) {
    const { error } = await db.from('pending_signups').upsert(row)
    if (error) throw new Error('pending_signups_upsert_failed')
  },
  async clearPending(email) {
    const { error } = await db.from('pending_signups').delete().eq('email', email)
    if (error) console.error('[self-signup] pending_signups cleanup failed:', error.code ?? 'error')
  },
  async createUser(user) {
    const { data, error } = await db.auth.admin.createUser(user)
    return { id: data?.user?.id ?? null, error }
  },
  async markConfirmPending(userId) {
    const { error } = await db.from('profiles').update({ email_confirm_pending: true }).eq('id', userId)
    if (error) throw new Error('email_confirm_pending_update_failed')
  },
  sendConfirm: (userId, email) => sendConfirmEmail(db, userId, email),
  now: () => new Date(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  log: m => console.error('[self-signup]', m),
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  let body: unknown
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request body' }, 400)
  try {
    const r = await handle(deps, clientIp(req), body as Record<string, unknown>)
    return json(r.body, r.status)
  } catch (err) {
    // Error text only: never the email, password or IP.
    console.error('[self-signup]', err instanceof Error ? err.message : 'error')
    return json({ error: MSG.failed }, 500)
  }
})
