// P939 — one place for saved secrets. The admin Connect page saves keys through
// fetch-secrets into the `secrets` table (AES-256-GCM, key = SECRETS_ENCRYPTION_KEY).
// Functions that need a saved key read it here: the saved value first, the
// function's own environment value only when nothing is saved. No Deno APIs
// (the encryption key and env reader are passed in), so node --test loads it.
// A value never appears in a log line or an error message.

const SALT = 'ohvara-secrets-salt-v1'

// P922: no built-in fallback key. Under 16 characters means "not set".
export function encKeyOk(raw: string | undefined | null): raw is string {
  return typeof raw === 'string' && raw.length >= 16
}

async function cryptoKey(raw: string): Promise<CryptoKey> {
  if (!encKeyOk(raw)) throw new Error('SECRETS_ENCRYPTION_KEY not set')
  const rawBytes = new TextEncoder().encode(raw.padEnd(32, '0').slice(0, 32))
  const material = await crypto.subtle.importKey('raw', rawBytes, 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode(SALT), iterations: 100_000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

export async function encryptValue(encKey: string, value: string): Promise<string> {
  const key = await cryptoKey(encKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value))
  const combined = new Uint8Array(12 + enc.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(enc), 12)
  return btoa(String.fromCharCode(...combined))
}

export async function decryptValue(encKey: string, encB64: string): Promise<string> {
  const key = await cryptoKey(encKey)
  const combined = Uint8Array.from(atob(encB64), c => c.charCodeAt(0))
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: combined.slice(0, 12) }, key, combined.slice(12))
  return new TextDecoder().decode(dec)
}

// The saved-secrets table, as far as this reader needs it.
export type SecretsDb = {
  from(table: string): {
    select(cols: string): { in(col: string, vals: string[]): PromiseLike<{ data: { key_name: string; encrypted_value: string }[] | null; error: unknown }> }
  }
}

export type SecretOpts = {
  encKey?: string | undefined                       // SECRETS_ENCRYPTION_KEY
  env?: (name: string) => string | undefined        // the function's own environment (fallback only)
  log?: (msg: string) => void
}

// name -> value for each name; undefined when neither the table nor the environment has it.
// A table row that can't be decrypted (wrong key, bad data) is skipped with a log line naming the key only.
export async function readSecrets(db: SecretsDb, names: string[], o: SecretOpts = {}): Promise<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {}
  let rows: { key_name: string; encrypted_value: string }[] = []
  try {
    const r = await db.from('secrets').select('key_name, encrypted_value').in('key_name', names)
    if (!r.error && r.data) rows = r.data
  } catch { /* the table may not be readable: fall back to the environment */ }
  for (const name of names) {
    let value: string | undefined
    const row = rows.find(x => x.key_name === name)
    if (row && encKeyOk(o.encKey)) {
      try { value = (await decryptValue(o.encKey, row.encrypted_value)).trim() || undefined }
      catch { o.log?.(`[secrets] ${name}: saved value could not be decrypted`) }
    } else if (row) o.log?.(`[secrets] ${name}: saved, but SECRETS_ENCRYPTION_KEY is not set`)
    out[name] = value ?? (o.env?.(name)?.trim() || undefined)
  }
  return out
}
