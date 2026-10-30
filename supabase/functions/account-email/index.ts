// account-email — Prompt 781. The email side of sign-in that Supabase Auth
// can't do on its own here.
//
// Deployed with verify_jwt DISABLED (reset + confirm run signed out; resend
// checks the JWT itself):
//   supabase functions deploy account-email --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
//   { action: 'reset', email, redirect_to? } → { ok: true }, always the same
//     answer. Sends Supabase's own reset email only when the address belongs
//     to an account whose email is confirmed (not a text-invite account that
//     hasn't clicked its confirm link, not a legacy @ohvara.internal one).
//     A self-signup account still waiting on its link does get it: the mail
//     only reaches the real inbox owner, so a stranger who registers someone
//     else's email can't lock that person out.
//   { action: 'confirm', token }             → { ok: true } | { error } — the /confirm-email link
//   { action: 'resend' } + Authorization     → { ok: true } | { error } — the banner's "Send again"
import { createClient } from 'npm:@supabase/supabase-js'
import { sendConfirmEmail, sha256Hex, appUrl } from '../_shared/confirmEmail.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const URL_ = Deno.env.get('SUPABASE_URL')!
const db = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const likeEscape = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`)
const RESEND_PER_HOUR = 3

// Reset links may only point back at the portal (Supabase also checks its own allow list).
function safeRedirect(raw: unknown) {
  const base = appUrl()
  try {
    const u = new URL(String(raw))
    const ok = u.origin === new URL(base).origin || u.hostname === 'localhost' || u.hostname === '127.0.0.1'
      || u.hostname === 'ohvara-dashboard.vercel.app'
    if (ok && u.pathname === '/reset-password') return u.toString()
  } catch { /* fall through */ }
  return `${base}/reset-password`
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Invalid request body' }, 400) }

  try {
    if (body.action === 'reset') {
      const email = String(body.email ?? '').trim().toLowerCase()
      if (!EMAIL_RE.test(email)) return json({ error: "Enter your account's email" }, 400)
      const { data: rows } = await db.from('profiles')
        .select('id, email_confirm_pending, is_active').ilike('email', likeEscape(email)).limit(1)
      const p = rows?.[0]
      // Its own read, only for a pending account: every other reset keeps
      // working whether or not signup_source is on the database yet.
      let mayReset = !p?.email_confirm_pending
      if (p?.email_confirm_pending) {
        const { data: s } = await db.from('profiles').select('signup_source').eq('id', p.id).maybeSingle()
        mayReset = s?.signup_source === 'self'
      }
      if (p && mayReset && p.is_active !== false && !email.endsWith('@ohvara.internal')) {
        // Supabase's own recovery mail (its sender, its per-address limits), as before.
        const anon = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } })
        const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo: safeRedirect(body.redirect_to) })
        if (error) console.error('[account-email] reset:', error.status ?? '', error.code ?? error.name)
      }
      return json({ ok: true })
    }

    if (body.action === 'confirm') {
      const token = String(body.token ?? '')
      if (!token || token.length > 100) return json({ error: 'invalid' }, 400)
      const hash = await sha256Hex(token)
      const now = new Date().toISOString()
      const { data: row } = await db.from('email_confirm_tokens')
        .update({ used_at: now }).eq('token_hash', hash).is('used_at', null).gt('expires_at', now)
        .select('user_id').maybeSingle()
      if (!row) {
        const { data: seen } = await db.from('email_confirm_tokens').select('used_at').eq('token_hash', hash).maybeSingle()
        return json({ error: seen?.used_at ? 'used' : seen ? 'expired' : 'invalid' }, 400)
      }
      const { error } = await db.from('profiles').update({ email_confirm_pending: false }).eq('id', row.user_id)
      if (error) throw error
      return json({ ok: true })
    }

    if (body.action === 'resend') {
      const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
      const { data: u } = await db.auth.getUser(jwt)
      if (!u?.user?.email) return json({ error: 'Unauthorized' }, 401)
      const { data: p } = await db.from('profiles').select('email_confirm_pending').eq('id', u.user.id).maybeSingle()
      if (!p?.email_confirm_pending) return json({ ok: true, already: true })
      const since = new Date(Date.now() - 3600e3).toISOString()
      const { count } = await db.from('email_confirm_tokens').select('token_hash', { count: 'exact', head: true })
        .eq('user_id', u.user.id).gte('created_at', since)
      if ((count ?? 0) >= RESEND_PER_HOUR) return json({ error: 'You just asked for a few. Try again in an hour.' }, 429)
      const sent = await sendConfirmEmail(db, u.user.id, u.user.email)
      return sent ? json({ ok: true }) : json({ error: "Couldn't send that. Try again." }, 502)
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error('[account-email]', err instanceof Error ? err.message : String(err))
    return json({ error: 'Something went wrong. Try again.' }, 500)
  }
})
