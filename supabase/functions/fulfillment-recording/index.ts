// fulfillment-recording — Prompt 764. Admin-only playback of a cancel call's
// recording: streams the audio from Twilio with Ohvara's credentials. No
// public recording URL is ever stored or returned; reps and agents get 403.
//
//   GET or POST ?id=<fulfillment_recordings.id>  (or body { id })
//   Authorization: Bearer <admin's session JWT>
//   → audio/mpeg (Range passed through, so the player can seek)
//
// The page fetches it with the session token and plays the blob (an <audio
// src> can't send the header).
//
// Deploy WITH jwt verification:
//   npx.cmd supabase functions deploy fulfillment-recording --project-ref jjextitmbptoaolacocs
// Secrets: CALLER_ID_TWILIO_ACCOUNT_SID / CALLER_ID_TWILIO_AUTH_TOKEN.
import { createClient } from 'npm:@supabase/supabase-js'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const SID = Deno.env.get('CALLER_ID_TWILIO_ACCOUNT_SID')
const TOKEN = Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, range',
  'Access-Control-Expose-Headers': 'content-length, content-range, accept-ranges',
}
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '')
  const { data: u } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } }
  if (!u.user) return json({ error: 'Not signed in' }, 401)
  const { data: me } = await db.from('profiles').select('role').eq('id', u.user.id).maybeSingle()
  if (me?.role !== 'admin') return json({ error: 'Only an admin can play recordings' }, 403)

  let id = new URL(req.url).searchParams.get('id') || ''
  if (!id && req.method === 'POST') id = String((await req.json().catch(() => ({})))?.id || '')
  if (!UUID.test(id)) return json({ error: 'Which recording?' }, 400)
  const { data: rec } = await db.from('fulfillment_recordings').select('recording_sid, status').eq('id', id).maybeSingle()
  if (!rec?.recording_sid || rec.status !== 'ready') return json({ error: 'That recording isn\'t ready' }, 404)
  if (!SID || !TOKEN) return json({ error: 'Twilio isn\'t set up' }, 503)

  const range = req.headers.get('Range')
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Recordings/${rec.recording_sid}.mp3`, {
    headers: { Authorization: `Basic ${btoa(`${SID}:${TOKEN}`)}`, ...(range ? { Range: range } : null) },
  })
  if (!res.ok && res.status !== 206) return json({ error: `Twilio couldn't send it (${res.status})` }, 502)
  const headers = new Headers({ ...corsHeaders, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes' })
  for (const h of ['content-length', 'content-range']) { const v = res.headers.get(h); if (v) headers.set(h, v) }
  return new Response(res.body, { status: res.status, headers })
})
