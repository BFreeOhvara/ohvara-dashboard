// The guard for functions that spend Ohvara's money or use its email and text
// senders. These run on the service role, so the table triggers that lock a
// self-signup portal don't stop them: each one asks here itself.
//
//   if (await isLockedSelfSignup(admin, user.id)) return json({ error: LOCKED_MESSAGE }, 403)
//
// Needs no npm import, so tests run with a fake client.

export const LOCKED_MESSAGE = 'Choose a plan to unlock your portal before inviting people.'

// Postgres "undefined column": profiles.signup_source isn't there yet.
const UNDEFINED_COLUMN = '42703'

// Minimal shape of a service-role supabase-js client.
type Db = {
  // deno-lint-ignore no-explicit-any
  from(table: string): any
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any
}

// True only for a self-signup agent who isn't unlocked.
// - Invited accounts (signup_source missing or 'invite'), fulfillment and admin: always false.
// - A self-signup agent whose access can't be read: true (fails closed).
// - The profile itself can't be read: true, since it could be a self-signup
//   account. The one exception is the migration not being applied yet: then no
//   self-signup account can exist, so nobody is locked.
export async function isLockedSelfSignup(admin: Db, userId: string): Promise<boolean> {
  const { data: profile, error } = await admin.from('profiles')
    .select('role, signup_source').eq('id', userId).maybeSingle()
  if (error) {
    if (error.code === UNDEFINED_COLUMN) return false
    console.error('[portal-access] profile read failed:', error.code ?? 'error')
    return true
  }
  if (profile?.role !== 'agent' || profile.signup_source !== 'self') return false

  const { data: access, error: accessError } = await admin.rpc('agent_portal_access', { p_agent: userId })
  if (accessError) {
    console.error('[portal-access] access read failed:', accessError.code ?? 'error')
    return true
  }
  return access?.unlocked !== true
}
