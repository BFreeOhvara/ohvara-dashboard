// Shared per-IP limiter for public (no-login) forms. The count lives in the
// database (public.public_form_attempts), so it holds across function
// restarts and cold starts; nothing is kept in memory.
//
//   const ip = clientIp(req)                       // null → treat as blocked
//   const ipHash = await hashIp(ip)                // throws if FORM_IP_SALT is unset
//   const r = await checkAndRecord(serviceStore(db), ipHash, { limit: 5, windowMs: 3_600_000 })
//   if (r.blocked) …
//
// Only the salted hash is ever stored. Never log or return the raw IP.

// Supabase's gateway sets x-forwarded-for on every request to an edge
// function; the first entry is the caller's address. Other client-sent
// headers (x-real-ip, cf-connecting-ip, true-client-ip, forwarded) are
// ignored on purpose. Confirm on a real request before relying on it.
export function clientIp(req: Request): string | null {
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return first ? first : null
}

// SHA-256 of salt + ip, hex. The salt is read at call time so a rotated
// secret takes effect without a redeploy; with no salt we refuse rather
// than store a guessable hash.
export async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get('FORM_IP_SALT')
  if (!salt) throw new Error('ip_salt_missing')
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ip))
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
}

export type Store = {
  // Rows for this hash with created_at strictly after `sinceIso`.
  countSince(ipHash: string, sinceIso: string): Promise<number>
  record(ipHash: string, atIso: string): Promise<void>
}

export type LimitResult = { blocked: boolean; count: number }

// Rolling window: count attempts in (now - windowMs, now]. At or over the
// limit → blocked and nothing is written; otherwise this attempt is recorded.
export async function checkAndRecord(
  store: Store,
  ipHash: string,
  { limit, windowMs, now = new Date() }: { limit: number; windowMs: number; now?: Date },
): Promise<LimitResult> {
  const since = new Date(now.getTime() - windowMs).toISOString()
  const count = await store.countSince(ipHash, since)
  if (count >= limit) return { blocked: true, count }
  await store.record(ipHash, now.toISOString())
  return { blocked: false, count: count + 1 }
}

// Minimal shape of a service-role supabase-js client, so this file needs no
// npm import (and the test runs offline).
type Db = {
  // deno-lint-ignore no-explicit-any
  from(table: string): any
}

// Service-role store against public.public_form_attempts (ip_hash, created_at).
// Errors throw, so a database failure blocks instead of letting traffic through.
export function serviceStore(db: Db): Store {
  return {
    async countSince(ipHash, sinceIso) {
      const { count, error } = await db.from('public_form_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('ip_hash', ipHash).gt('created_at', sinceIso)
      if (error) throw new Error('ip_limit_count_failed')
      return count ?? 0
    },
    async record(ipHash, atIso) {
      const { error } = await db.from('public_form_attempts').insert({ ip_hash: ipHash, created_at: atIso })
      if (error) throw new Error('ip_limit_record_failed')
    },
  }
}
