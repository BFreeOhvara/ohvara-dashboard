// A lasting rate limit for public edge functions. Hits are stored in
// rate_limit_hits (migration 163) through check_and_record_hit, so the count
// survives cold starts and is shared by every worker. Only a SHA-256 of the key
// is stored, never the raw IP or phone.

export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}

// Records a hit for `key` and says whether it is now over `limit` within `windowMs`.
export async function checkAndRecord(db: RpcClient, key: string, limit: number, windowMs: number): Promise<boolean> {
  const { data, error } = await db.rpc('check_and_record_hit', {
    p_key: await sha256Hex(key),
    p_limit: limit,
    p_window_seconds: Math.ceil(windowMs / 1000),
  })
  if (error) throw new Error(`rate limit failed: ${error.message}`)
  return data === true
}
