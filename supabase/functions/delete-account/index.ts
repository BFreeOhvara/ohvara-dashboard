// delete-account — Prompt 775. The logic is core.ts; this wires Deno.
//
// Deploy WITH jwt verification (a signed-in user calls it; core.ts checks the
// user again itself — see Gotchas: verify_jwt alone doesn't keep anyone out):
//   npx.cmd supabase functions deploy delete-account --project-ref jjextitmbptoaolacocs
//
// Secrets: STRIPE_SECRET_KEY (already set for agent-billing).
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, stripeCancel } from './core.ts'

const KEY = Deno.env.get('STRIPE_SECRET_KEY')
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(req => handle(req, {
  async userFromJwt(jwt) {
    const { data } = await admin.auth.getUser(jwt)
    return data.user?.id ?? null
  },
  async profile(id) {
    const { data } = await admin.from('profiles')
      .select('id, role, is_demo, billing_exempt, billing_status, stripe_subscription_id, deleted_at')
      .eq('id', id).maybeSingle()
    return data
  },
  stripeReady: !!KEY,
  cancelSubscription: subId => stripeCancel(KEY!, subId),
  async deleteData(id) {
    const { data, error } = await admin.rpc('account_delete', { p_uid: id })
    if (error) throw new Error(error.message)
    return data ?? {}
  },
  async removePhoto(id) {
    const { data: files } = await admin.storage.from('avatars').list(id)
    if (files?.length) await admin.storage.from('avatars').remove(files.map(f => `${id}/${f.name}`))
  },
  async deleteLogin(id) {
    // Soft delete: the login can never be used again and its email/phone are
    // scrambled, but the row stays so pay and call records keep their id.
    const { error } = await admin.auth.admin.deleteUser(id, true)
    if (error) throw new Error(error.message)
  },
}))
