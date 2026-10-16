// Prompt 767 — the pg_cron jobs call edge functions with the x-ohvara-cron
// secret from Vault (fulfillment_cron_post, migration 145/146), checked here
// by fulfillment_cron_ok. Nothing is hard-coded and the secret never leaves
// the database except in that header.
// deno-lint-ignore no-explicit-any
export async function isCron(req: Request, db: any): Promise<boolean> {
  const secret = req.headers.get('x-ohvara-cron')
  if (!secret) return false
  const { data } = await db.rpc('fulfillment_cron_ok', { p_secret: secret })
  return data === true
}
