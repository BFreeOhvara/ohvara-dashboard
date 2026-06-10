// fetch-secrets — centralized secret management with AES-256-GCM encryption
//
// GET  /fetch-secrets       → all users: capabilities object; admin: also returns secret metadata
// POST /fetch-secrets       → admin only: set/update a secret value
// DELETE /fetch-secrets     → admin only: delete a secret by key_name
//
// Encryption: AES-256-GCM via Web Crypto (standard in Deno).
// Key derived from SECRETS_ENCRYPTION_KEY env var using PBKDF2.
// If SECRETS_ENCRYPTION_KEY is not set, uses a dev-only default (logs a warning).

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Crypto helpers ────────────────────────────────────────────────────────────

const ENC_KEY_RAW = Deno.env.get('SECRETS_ENCRYPTION_KEY') || 'ohvara-dev-only-change-in-prod!!'
if (!Deno.env.get('SECRETS_ENCRYPTION_KEY')) {
  console.warn('[fetch-secrets] SECRETS_ENCRYPTION_KEY not set — using dev default, set it in Supabase secrets!')
}

async function getCryptoKey(): Promise<CryptoKey> {
  const rawBytes = new TextEncoder().encode(ENC_KEY_RAW.padEnd(32, '0').slice(0, 32))
  const keyMaterial = await crypto.subtle.importKey('raw', rawBytes, 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('ohvara-secrets-salt-v1'), iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encryptValue(value: string): Promise<string> {
  const key = await getCryptoKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(value)
  )
  const combined = new Uint8Array(12 + enc.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(enc), 12)
  return btoa(String.fromCharCode(...combined))
}

async function decryptValue(encB64: string): Promise<string> {
  const key = await getCryptoKey()
  const combined = Uint8Array.from(atob(encB64), c => c.charCodeAt(0))
  const iv   = combined.slice(0, 12)
  const data = combined.slice(12)
  const dec  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  return new TextDecoder().decode(dec)
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function getCallerProfile(req: Request) {
  const auth = req.headers.get('Authorization')
  if (!auth) return null
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: { user } } = await admin.auth.getUser(auth.replace('Bearer ', ''))
  if (!user) return null
  const { data } = await admin.from('profiles').select('id,role').eq('id', user.id).single()
  return data
}

// ── Capabilities from env vars + secrets table ───────────────────────────────
// Checks whether each key is configured (env var OR secrets table).
// Does NOT expose the actual values.

async function getCapabilities(supabase: ReturnType<typeof createClient>): Promise<Record<string, boolean>> {
  // Check env vars first (primary source)
  const caps: Record<string, boolean> = {
    has_anthropic: !!Deno.env.get('ANTHROPIC_API_KEY'),
    has_retell:    !!Deno.env.get('RETELL_API_KEY'),
    has_twilio:    !!(Deno.env.get('TWILIO_ACCOUNT_SID') && Deno.env.get('TWILIO_AUTH_TOKEN')),
    has_stripe:    !!(Deno.env.get('STRIPE_SECRET_KEY') || Deno.env.get('STRIPE_SETUP_LINK_BASIC')),
    has_google_maps: !!Deno.env.get('GOOGLE_MAPS_API_KEY'),
    has_indeed:    !!Deno.env.get('INDEED_MCP_TOKEN'),
  }

  // Supplement with secrets table entries (keys configured via admin UI)
  try {
    const { data } = await supabase.from('secrets').select('key_name')
    if (data?.length) {
      const names = new Set(data.map((r: { key_name: string }) => r.key_name))
      if (names.has('ANTHROPIC_API_KEY'))  caps.has_anthropic  = true
      if (names.has('RETELL_API_KEY'))     caps.has_retell     = true
      if (names.has('TWILIO_ACCOUNT_SID')) caps.has_twilio     = true
      if (names.has('STRIPE_SECRET_KEY'))  caps.has_stripe     = true
      if (names.has('GOOGLE_MAPS_API_KEY'))caps.has_google_maps= true
      if (names.has('INDEED_MCP_TOKEN'))   caps.has_indeed     = true
    }
  } catch { /* secrets table may not exist yet */ }

  return caps
}

// ── Main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const profile = await getCallerProfile(req)
  const isAdmin = profile?.role === 'admin'

  // ── GET: return capabilities (all users) + secret metadata (admin only) ────
  if (req.method === 'GET') {
    const capabilities = await getCapabilities(supabase)

    if (!isAdmin) {
      return new Response(JSON.stringify({ capabilities }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Admin: also return secret list (names + metadata, not values)
    const { data: secretRows } = await supabase
      .from('secrets')
      .select('id, key_name, description, created_at, updated_at, last_used_at')
      .order('key_name')

    // Update last_used_at for all returned secrets
    if (secretRows?.length) {
      await supabase
        .from('secrets')
        .update({ last_used_at: new Date().toISOString() })
        .in('id', secretRows.map((r: { id: string }) => r.id))
    }

    return new Response(JSON.stringify({ capabilities, secrets: secretRows || [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── POST: set a secret (admin only) ─────────────────────────────────────────
  if (req.method === 'POST') {
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { key_name, value, description } = await req.json()
    if (!key_name || !value) {
      return new Response(JSON.stringify({ error: 'key_name and value required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const encrypted = await encryptValue(String(value))

    const { error } = await supabase
      .from('secrets')
      .upsert({ key_name, encrypted_value: encrypted, description: description || null }, { onConflict: 'key_name' })

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Log to audit_log
    await supabase.from('secrets')
      .update({
        audit_log: supabase.rpc('jsonb_array_append', {
          arr: 'audit_log',
          val: JSON.stringify({ action: 'set', by: profile.id, at: new Date().toISOString() }),
        })
      })
      .eq('key_name', key_name)

    return new Response(JSON.stringify({ success: true, key_name }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── DELETE: remove a secret (admin only) ────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Admin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { key_name } = await req.json()
    await supabase.from('secrets').delete().eq('key_name', key_name)
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
