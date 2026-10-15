// fulfillment-cancel-check — Prompt 764, the AI check of each cancel call.
// Logic in core.ts; this file wires Deno: Twilio (recording audio, request
// signatures), Deepgram (speech to text), Claude, and the service-role store.
//
// Deploy WITHOUT jwt verification (Twilio and pg_cron call it; core.ts checks
// the Twilio signature or the cron secret on every request):
//   npx.cmd supabase functions deploy fulfillment-cancel-check --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
// Secrets: CALLER_ID_TWILIO_ACCOUNT_SID / CALLER_ID_TWILIO_AUTH_TOKEN (already
// set), DEEPGRAM_API_KEY (new), ANTHROPIC_API_KEY (already set for
// carrier-hours). Twilio's recording callback URL is set by fulfillment-voice
// on each recorded conference; nothing to set in the Twilio console.
import { createClient } from 'npm:@supabase/supabase-js'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { handle, VERDICT_SCHEMA, type Store, type Deps, type Transcript } from './core.ts'
import { readTwilioRequest } from '../_shared/twilio.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const SID = Deno.env.get('CALLER_ID_TWILIO_ACCOUNT_SID')
const TOKEN = Deno.env.get('CALLER_ID_TWILIO_AUTH_TOKEN') ?? null
const DEEPGRAM = Deno.env.get('DEEPGRAM_API_KEY')
const MODEL = 'claude-opus-5-5'
const anthropic = Deno.env.get('ANTHROPIC_API_KEY') ? new Anthropic({ maxRetries: 2, timeout: 120e3 }) : null

const CANCEL_COLS = 'id, policy_id, logged_at, check_attempts, client_name, carrier_name'

const store: Store = {
  async cronOk(secret) {
    const { data } = await db.rpc('fulfillment_cron_ok', { p_secret: secret })
    return data === true
  },
  async saveRecording(callSid, patch) {
    const row: Record<string, unknown> = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
    if (patch.status === 'ready') row.ready_at = new Date().toISOString()
    // A ready recording never goes back to recording (callbacks can arrive out of order).
    let q = db.from('fulfillment_recordings').update(row).eq('call_sid', callSid)
    if (patch.status === 'recording') q = q.eq('status', 'recording')
    const { error } = await q
    if (error) throw error
  },
  async checking(policyId) {
    let q = db.from('fulfillment_cancels').select(CANCEL_COLS).eq('status', 'checking').order('logged_at').limit(25)
    if (policyId) q = q.eq('policy_id', policyId)
    else q = q.or(`next_check_at.is.null,next_check_at.lte.${new Date().toISOString()}`)
    const { data, error } = await q
    if (error) throw error
    return data ?? []
  },
  async claim(id) {
    const { data: cur } = await db.from('fulfillment_cancels').select('check_attempts, check_started_at').eq('id', id).eq('status', 'checking').maybeSingle()
    if (!cur) return null
    // Taken unless another check started it in the last 5 minutes.
    const stale = new Date(Date.now() - 5 * 60e3).toISOString()
    const { data } = await db.from('fulfillment_cancels')
      .update({ check_started_at: new Date().toISOString(), check_attempts: cur.check_attempts + 1 })
      .eq('id', id).eq('status', 'checking').eq('check_attempts', cur.check_attempts)
      .or(`check_started_at.is.null,check_started_at.lt.${stale}`)
      .select(CANCEL_COLS).maybeSingle()
    return data ?? null
  },
  async release(id, nextAt) {
    await db.from('fulfillment_cancels').update({ check_started_at: null, next_check_at: nextAt }).eq('id', id).eq('status', 'checking')
  },
  async recordings(policyId) {
    const { data } = await db.from('fulfillment_recordings').select('id, recording_sid, status, created_at')
      .eq('policy_id', policyId).order('created_at', { ascending: false }).limit(10)
    return data ?? []
  },
  async policyNumber(policyId) {
    const { data } = await db.from('policies').select('policy_number').eq('id', policyId).maybeSingle()
    return data?.policy_number ?? null
  },
  async saveCheck(row) {
    const { error } = await db.from('fulfillment_cancel_checks').insert(row)
    if (error) console.error('saveCheck:', error.message)
  },
  async result(id, confirmed, reason, at, recordingId) {
    const { data, error } = await db.rpc('fulfillment_cancel_check_result', {
      p_cancel: id, p_confirmed: confirmed, p_reason: reason, p_at: at, p_recording: recordingId,
    })
    if (error) throw error
    return data as string
  },
}

const deps: Deps = {
  async audio(recordingSid) {
    if (!SID || !TOKEN) throw new Error('Twilio is not configured')
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Recordings/${recordingSid}.mp3`, {
      headers: { Authorization: `Basic ${btoa(`${SID}:${TOKEN}`)}` },
    })
    if (!res.ok) throw new Error(`Twilio recording ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  },
  // Deepgram pre-recorded: one POST with the audio, utterances with start times.
  async transcribe(audio): Promise<Transcript> {
    if (!DEEPGRAM) throw new Error('DEEPGRAM_API_KEY is not set')
    const q = new URLSearchParams({ model: 'nova-3', smart_format: 'true', utterances: 'true', diarize: 'true', punctuate: 'true' })
    const res = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
      method: 'POST',
      headers: { Authorization: `Token ${DEEPGRAM}`, 'Content-Type': 'audio/mpeg' },
      body: audio,
    })
    if (!res.ok) throw new Error(`Deepgram ${res.status}`)
    const data = await res.json()
    const utterances = (data?.results?.utterances || []).map((u: any) => ({ start: Number(u.start) || 0, speaker: u.speaker ?? null, text: String(u.transcript || '') }))
      .filter((u: any) => u.text.trim())
    const text = String(data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '')
    return { text, utterances }
  },
  async ask({ system, user }) {
    if (!anthropic) throw new Error('ANTHROPIC_API_KEY is not set')
    // Structured output (strict JSON); server-side fallback if a safety
    // classifier declines (a decline still lands as needs a listen).
    const res: any = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: VERDICT_SCHEMA } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    } as any)
    if (res.stop_reason === 'refusal') return { text: null, refusal: true, model: res.model }
    const text = (res.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
    return { text, model: res.model }
  },
}

Deno.serve(req => handle(req, store, deps,
  { authToken: TOKEN, publicUrl: `${SUPABASE_URL}/functions/v1/fulfillment-cancel-check` },
  readTwilioRequest,
  // deno-lint-ignore no-explicit-any
  p => (globalThis as any).EdgeRuntime?.waitUntil ? (globalThis as any).EdgeRuntime.waitUntil(p) : p.catch(() => {}),
))
