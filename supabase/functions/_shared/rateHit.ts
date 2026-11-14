// P999 — a durable rate limit for the public (signed-out) functions, on public.rate_hit() (migration 274).
//
//   if (await overLimit(db, 'reset-ip', clientIp(req), 5, 3600)) return sameAnswer()
//
// The key is hashed with FORM_IP_SALT (same as ipLimit.ts); only the hash is stored. Fails OPEN (logs, returns
// false) when the salt or the database is missing, so a broken limiter never locks real people out of signing in;
// Supabase Auth's own per-IP limits still apply behind it.
import { hashIp } from './ipLimit.ts'

// deno-lint-ignore no-explicit-any
type Db = { rpc(fn: string, args?: Record<string, unknown>): any }

export async function overLimit(db: Db, bucket: string, key: string | null, max: number, seconds: number): Promise<boolean> {
  if (!key) return false
  try {
    const hash = await hashIp(key.toLowerCase())
    const { data, error } = await db.rpc('rate_hit', { p_bucket: bucket, p_key: hash, p_max: max, p_seconds: seconds })
    if (error) { console.error('[rate-hit]', bucket, error.code ?? 'error'); return false }
    return data === true
  } catch (err) {
    console.error('[rate-hit]', bucket, err instanceof Error ? err.message : 'error')
    return false
  }
}
