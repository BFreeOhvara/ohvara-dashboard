// ============================================================
// twilio-token — mint a Twilio Voice Access Token for the browser
//
// The rep's CallModal calls this on open. It returns a short-lived
// JWT (Access Token) that the @twilio/voice-sdk Device uses to
// register and place WebRTC calls. Replaces the Prompt 29 bridge
// (twilio-call) — audio runs through the rep's mic/headset, Twilio
// dials the lead directly (1 leg, ~$0.0065/min).
//
// Deploy WITH jwt verification (this is called by an authed rep):
//   supabase functions deploy twilio-token --project-ref jjextitmbptoaolacocs
//
// Required Supabase secrets:
//   TWILIO_ACCOUNT_SID      — Twilio account SID (ACxxxx)
//   TWILIO_API_KEY_SID      — Standard API Key SID (SKxxxx)
//   TWILIO_API_KEY_SECRET   — that API Key's secret
//   TWILIO_TWIML_APP_SID    — Voice TwiML App SID (APxxxx), Voice URL
//                             = .../functions/v1/twilio-voice-webhook
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — to resolve the caller
//
// The token's identity = the calling rep's profile_id (auth user id),
// read from the request JWT — never trusted from the body.
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// base64url (no padding) of a UTF-8 string.
function b64url(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// base64url of raw bytes.
function b64urlBytes(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Build a Twilio Access Token (JWT, HS256) by hand — Twilio's format is
// a standard JWT with a `cty: twilio-fpa;v=1` header and a `grants` claim.
// No SDK needed; signed with the API Key Secret.
async function buildAccessToken(opts: {
  accountSid: string
  apiKeySid: string
  apiKeySecret: string
  twimlAppSid: string
  identity: string
  ttlSeconds: number
  nowSeconds: number
}): Promise<string> {
  const header = { typ: 'JWT', alg: 'HS256', cty: 'twilio-fpa;v=1' }
  const payload = {
    jti: `${opts.apiKeySid}-${opts.nowSeconds}`,
    iss: opts.apiKeySid,
    sub: opts.accountSid,
    nbf: opts.nowSeconds,
    exp: opts.nowSeconds + opts.ttlSeconds,
    grants: {
      identity: opts.identity,
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: opts.twimlAppSid },
      },
    },
  }

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(opts.apiKeySecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${b64urlBytes(new Uint8Array(sig))}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const accountSid   = Deno.env.get('TWILIO_ACCOUNT_SID')
  const apiKeySid    = Deno.env.get('TWILIO_API_KEY_SID')
  const apiKeySecret = Deno.env.get('TWILIO_API_KEY_SECRET')
  const twimlAppSid  = Deno.env.get('TWILIO_TWIML_APP_SID')
  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
    return new Response(JSON.stringify({ error: 'Twilio Voice not configured' }), {
      status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Resolve the caller from the request JWT — identity must be the rep's
  // own profile_id, never something passed in the body.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { data: { user }, error: authError } =
    await adminClient.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Date.now() is fine in an edge runtime (no replay-cache concern here).
  const nowSeconds = Math.floor(Date.now() / 1000)
  const token = await buildAccessToken({
    accountSid, apiKeySid, apiKeySecret, twimlAppSid,
    identity: user.id,
    ttlSeconds: 3600,
    nowSeconds,
  })

  return new Response(JSON.stringify({ token, identity: user.id }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
