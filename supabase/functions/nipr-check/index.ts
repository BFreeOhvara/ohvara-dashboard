// nipr-check — P881, the NPN check against NIPR and the daily re-check. Logic: core.ts + registry.ts.
//
// Deploy with --no-verify-jwt: pg_cron calls it with the x-ohvara-cron secret, not a JWT. core.ts checks the
// user's JWT or the cron secret on every request.
//   npx.cmd supabase functions deploy nipr-check --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
// Secrets (NIPR PDB subscription; until set, every check goes to a manual review):
//   NIPR_CUSTOMER_NUMBER, NIPR_PIN, optional NIPR_PDB_URL.
// Needs the P881 migration (licence_apply_check, licence_view) and 145's fulfillment_cron_ok.
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, type Store } from './core.ts'
import { pdbRegistry } from './registry.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const store: Store = {
  async userFromJwt(jwt) {
    const { data } = await admin.auth.getUser(jwt)
    return data.user?.id ?? null
  },
  async caller(id) {
    const { data } = await admin.from('profiles').select('role, is_active, full_name').eq('id', id).maybeSingle()
    return data
  },
  async cronOk(secret) {
    const { data } = await admin.rpc('fulfillment_cron_ok', { p_secret: secret })
    return data === true
  },
  async apply(agentId, npn, j, daily) {
    const { data, error } = await admin.rpc('licence_apply_check', {
      p_agent: agentId, p_npn: npn, p_status: j.status, p_name: j.name, p_licences: j.licences, p_daily: daily,
    })
    if (error) throw error
    return data
  },
  async view(agentId) {
    const { data, error } = await admin.rpc('licence_view', { p_agent: agentId })
    if (error) throw error
    return data
  },
  async dailyAgents() {
    const { data, error } = await admin.from('profiles').select('id, npn, full_name')
      .eq('role', 'agent').eq('is_active', true).in('npn_status', ['verified', 'no_life']).not('npn', 'is', null)
    if (error) throw error
    return data ?? []
  },
}

const registry = pdbRegistry({
  customer: Deno.env.get('NIPR_CUSTOMER_NUMBER'),
  pin: Deno.env.get('NIPR_PIN'),
  url: Deno.env.get('NIPR_PDB_URL'),
})

Deno.serve(req => handle(req, store, registry))
