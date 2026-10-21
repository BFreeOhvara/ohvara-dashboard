// app-review-logins — Prompt 775. The logic is core.ts; this wires Deno.
// Deploy WITH jwt verification (an admin calls it from Settings → Team tools;
// core.ts checks the caller is an admin itself):
//   npx.cmd supabase functions deploy app-review-logins --project-ref jjextitmbptoaolacocs
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, makePassword } from './core.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(req => handle(req, {
  async caller(jwt) {
    const { data } = await admin.auth.getUser(jwt)
    if (!data.user) return null
    const { data: p } = await admin.from('profiles').select('id, role, is_active, is_demo').eq('id', data.user.id).maybeSingle()
    return p
  },
  async findByEmail(email) {
    const { data } = await admin.from('profiles').select('id').eq('email', email).is('deleted_at', null).maybeSingle()
    return data?.id ?? null
  },
  async createUser(email, password, role, name) {
    // Role comes from pending_signups (P787: app_metadata isn't on the row yet
    // when handle_new_user runs) — never from user_metadata (P770).
    const { error: pendErr } = await admin.from('pending_signups').upsert({ email, role, created_at: new Date().toISOString() })
    if (pendErr) throw new Error(pendErr.message)
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, app_metadata: { role }, user_metadata: { full_name: name },
    })
    if (error || !data.user) {
      await admin.from('pending_signups').delete().eq('email', email)
      throw new Error(error?.message || 'createUser failed')
    }
    return data.user.id
  },
  async setPassword(id, password) {
    const { error } = await admin.auth.admin.updateUserById(id, { password, ban_duration: 'none' })
    if (error) throw new Error(error.message)
  },
  async seed(agentId, repId) {
    const { data, error } = await admin.rpc('demo_seed', { p_agent: agentId, p_rep: repId })
    if (error) throw new Error(error.message)
    return data
  },
  password: () => makePassword(),
}))
