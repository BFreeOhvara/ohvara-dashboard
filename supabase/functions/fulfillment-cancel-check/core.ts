// fulfillment-cancel-check — Prompt 764. Did the carrier confirm the cancel on
// the call? Logic only; index.ts wires Deno (Twilio, Deepgram, Claude, the
// service-role store). No JWT: Twilio's requests carry X-Twilio-Signature and
// pg_cron's carry the x-ohvara-cron secret (checked against Vault).
//
// Requests
//   ?event=rec   Twilio's recording-status callback for a recorded call
//                (fulfillment-voice put ?policy=&call= on it). Saves the
//                recording's state; once it's ready, checks the cancels
//                waiting on that cancellation.
//   cron         { action: 'sweep' } every 2 minutes while any cancel is
//                'checking': checks the ones whose recording is ready, retries
//                failed checks, and gives up on calls that never produced a
//                recording.
//
// One check: the recording's audio (from Twilio, with auth) → speech to text
// (Deepgram, with timestamps) → Claude, with the carrier, client and policy:
// "did the carrier confirm this client's policy is being cancelled?", strict
// JSON { confirmed, quote, at_seconds, reason }. confirmed with a quote that is
// really in the transcript → verified. Everything else (no, unsure, refusal,
// empty transcript, unreadable answer, errors after retries, no recording)
// → needs a listen, for Brayden. The AI can only verify or hand it to
// Brayden; it never marks a cancel as not paid (fulfillment_cancel_check_result
// can't). Transcripts and quotes are stored admin-only.

export type Cancel = {
  id: string; policy_id: string | null; logged_at: string; check_attempts: number
  client_name: string | null; carrier_name: string | null
}
export type Recording = { id: string; recording_sid: string | null; status: 'recording' | 'ready' | 'failed'; created_at: string }
export type Utterance = { start: number; speaker?: number | null; text: string }
export type Transcript = { text: string; utterances: Utterance[] }
export type Verdict = { confirmed: boolean; quote: string; at_seconds: number | null; reason: string }
export type AiAnswer = { text: string | null; refusal?: boolean; model?: string }
export type Reason = 'no_recording' | 'unclear' | 'stt_error' | 'ai_error' | 'refused'

export interface Store {
  cronOk(secret: string): Promise<boolean>
  saveRecording(callSid: string, patch: { recording_sid?: string; conference_sid?: string; status?: 'recording' | 'ready' | 'failed'; duration_seconds?: number | null; error?: string | null }): Promise<void>
  // Cancels still 'checking' on this cancellation (callback) or anywhere and
  // due (sweep: next_check_at passed or null).
  checking(policyId?: string): Promise<Cancel[]>
  // Takes the cancel for one check (bumps check_attempts); null if someone
  // else has it or it's no longer 'checking'.
  claim(cancelId: string): Promise<Cancel | null>
  release(cancelId: string, nextAt: string): Promise<void>
  recordings(policyId: string): Promise<Recording[]>      // newest first
  policyNumber(policyId: string): Promise<string | null>
  saveCheck(row: Record<string, unknown>): Promise<void>
  result(cancelId: string, confirmed: boolean, reason: Reason | null, at: number | null, recordingId: string | null): Promise<string>
}

export interface Deps {
  audio(recordingSid: string): Promise<Uint8Array>
  transcribe(audio: Uint8Array): Promise<Transcript>
  ask(prompt: { system: string; user: string }): Promise<AiAnswer>
  now?: () => number
}

export const MAX_ATTEMPTS = 3
export const WAIT_FOR_RECORDING_MIN = 30   // after this, no recording = needs a listen
export const STT_PROVIDER = 'deepgram:nova-3'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ohvara-cron',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// "[01:05] Speaker 1: ..." lines; the timestamps are what the AI points at.
export function transcriptLines(t: Transcript) {
  if (!t.utterances.length) return t.text.trim()
  return t.utterances.map(u => {
    const s = Math.max(0, Math.floor(u.start))
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    const who = u.speaker == null ? '' : ` Speaker ${u.speaker + 1}:`
    return `[${mm}:${ss}]${who} ${u.text.trim()}`
  }).join('\n')
}

export const SYSTEM = [
  'You check recordings of phone calls made by Ohvara, an insurance agency. On each call an Ohvara rep phones an',
  'insurance carrier, with the client on the line, to cancel the client\'s old policy.',
  'You read the transcript and answer one question: did the carrier\'s representative confirm that this client\'s',
  'policy is being cancelled (for example "your policy has been cancelled", "the cancellation is processed",',
  '"it will cancel effective ...")?',
  'Answer confirmed=true only when a carrier representative clearly says so on the call about this client\'s',
  'policy. The rep or the client saying it does not count. A request to cancel, a transfer, a hold, a promise to',
  'call back, a voicemail, or anything you are unsure of is confirmed=false.',
  'quote: the carrier\'s exact words that confirm it, copied verbatim from the transcript (empty if not confirmed).',
  'at_seconds: the second in the call where that quote (or the most relevant moment, if not confirmed) starts,',
  'from the [mm:ss] marks. reason: one short sentence a manager can read.',
].join(' ')

export function userPrompt(c: { carrier: string | null; client: string | null; policy: string | null }, transcript: string) {
  return [
    `Carrier: ${c.carrier || 'unknown'}`,
    `Client: ${c.client || 'unknown'}`,
    `Policy number: ${c.policy || 'unknown'}`,
    '',
    'Transcript (speaker numbers are automatic and may be wrong):',
    '<transcript>',
    transcript,
    '</transcript>',
  ].join('\n')
}

// JSON schema for the answer (structured output).
export const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    confirmed: { type: 'boolean' },
    quote: { type: 'string' },
    at_seconds: { type: ['number', 'null'] },
    reason: { type: 'string' },
  },
  required: ['confirmed', 'quote', 'at_seconds', 'reason'],
  additionalProperties: false,
}

export function parseVerdict(text: string | null): Verdict | null {
  if (!text) return null
  let v: any
  try { v = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) } catch { return null }
  if (!v || typeof v !== 'object' || typeof v.confirmed !== 'boolean') return null
  const at = typeof v.at_seconds === 'number' && Number.isFinite(v.at_seconds) && v.at_seconds >= 0 ? Math.round(v.at_seconds * 10) / 10 : null
  return { confirmed: v.confirmed, quote: typeof v.quote === 'string' ? v.quote : '', at_seconds: at, reason: typeof v.reason === 'string' ? v.reason : '' }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
// The quote has to really be in the transcript (guards a made-up quote).
export const quoteInTranscript = (quote: string, t: Transcript) => {
  const q = norm(quote)
  return q.length >= 6 && norm(t.utterances.length ? t.utterances.map(u => u.text).join(' ') : t.text).includes(q)
}

type Outcome = { status: string; reason?: Reason | null; retry?: boolean }

async function fail(store: Store, deps: Deps, c: Cancel, reason: Reason, extra: Record<string, unknown>, recordingId: string | null, at: number | null = null): Promise<Outcome> {
  // A failed call to a service gets retried a few times before Brayden listens.
  const transient = reason === 'stt_error' || reason === 'ai_error'
  if (transient && c.check_attempts < MAX_ATTEMPTS) {
    const now = (deps.now ?? Date.now)()
    await store.saveCheck({ cancel_id: c.id, recording_id: recordingId, stt_provider: STT_PROVIDER, reason: `retry: ${reason}`, ...extra })
    await store.release(c.id, new Date(now + 2 * 60e3 * c.check_attempts).toISOString())
    return { status: 'checking', retry: true, reason }
  }
  await store.saveCheck({ cancel_id: c.id, recording_id: recordingId, stt_provider: STT_PROVIDER, confirmed: false, reason, at_seconds: at, ...extra })
  return { status: await store.result(c.id, false, reason, at, recordingId), reason }
}

// One cancel, start to finish. Returns where it ended up.
export async function checkCancel(store: Store, deps: Deps, cancelId: string): Promise<Outcome> {
  const c = await store.claim(cancelId)
  if (!c) return { status: 'skipped' }
  if (!c.policy_id) return { status: await store.result(c.id, false, 'no_recording', null, null), reason: 'no_recording' }
  const now = (deps.now ?? Date.now)()
  const logged = new Date(c.logged_at).getTime()

  // The latest finished recording of this cancellation from before the cancel
  // was logged (a call that's still being written up has no recording yet).
  const recs = await store.recordings(c.policy_id)
  const before = recs.filter(r => new Date(r.created_at).getTime() <= logged + 60e3)
  const ready = before.find(r => r.status === 'ready' && r.recording_sid)
  if (!ready) {
    const stillRecording = before.some(r => r.status === 'recording')
    if (stillRecording && now - logged < WAIT_FOR_RECORDING_MIN * 60e3) {
      await store.release(c.id, new Date(now + 2 * 60e3).toISOString())
      return { status: 'checking', retry: true }
    }
    await store.saveCheck({ cancel_id: c.id, confirmed: false, reason: 'no_recording' })
    return { status: await store.result(c.id, false, 'no_recording', null, null), reason: 'no_recording' }
  }

  let t: Transcript
  try {
    t = await deps.transcribe(await deps.audio(ready.recording_sid!))
  } catch (e) {
    return fail(store, deps, c, 'stt_error', { error: (e as Error).message.slice(0, 500) }, ready.id)
  }
  const transcript = transcriptLines(t)
  if (!transcript) return fail(store, deps, c, 'unclear', { transcript: '', error: 'empty transcript' }, ready.id)

  let answer: AiAnswer
  try {
    answer = await deps.ask({
      system: SYSTEM,
      user: userPrompt({ carrier: c.carrier_name, client: c.client_name, policy: await store.policyNumber(c.policy_id) }, transcript),
    })
  } catch (e) {
    return fail(store, deps, c, 'ai_error', { transcript, error: (e as Error).message.slice(0, 500) }, ready.id)
  }
  const base = { transcript, ai_model: answer.model ?? null, ai_raw: answer.text?.slice(0, 4000) ?? null }
  if (answer.refusal) return fail(store, deps, c, 'refused', base, ready.id)
  const v = parseVerdict(answer.text)
  if (!v) return fail(store, deps, c, 'ai_error', { ...base, error: 'answer was not readable JSON' }, ready.id)

  if (v.confirmed && quoteInTranscript(v.quote, t)) {
    await store.saveCheck({ cancel_id: c.id, recording_id: ready.id, stt_provider: STT_PROVIDER, ...base, confirmed: true, quote: v.quote, at_seconds: v.at_seconds, reason: v.reason })
    return { status: await store.result(c.id, true, null, v.at_seconds, ready.id) }
  }
  const why = v.confirmed ? `${v.reason} (quote not found in the transcript)` : v.reason
  await store.saveCheck({ cancel_id: c.id, recording_id: ready.id, stt_provider: STT_PROVIDER, ...base, confirmed: false, quote: v.quote || null, at_seconds: v.at_seconds, reason: why })
  return { status: await store.result(c.id, false, 'unclear', v.at_seconds, ready.id), reason: 'unclear' }
}

// Twilio RecordingStatus → our state.
export function recordingState(s: string): 'recording' | 'ready' | 'failed' | null {
  if (s === 'in-progress') return 'recording'
  if (s === 'completed') return 'ready'
  if (s === 'absent' || s === 'failed') return 'failed'
  return null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function checkAll(store: Store, deps: Deps, policyId?: string) {
  const out: Record<string, number> = {}
  for (const c of await store.checking(policyId)) {
    try {
      const r = await checkCancel(store, deps, c.id)
      out[r.status] = (out[r.status] || 0) + 1
    } catch (e) {
      console.error('cancel check failed:', c.id, (e as Error).message)
      out.error = (out.error || 0) + 1
    }
  }
  return out
}

export type Env = { authToken: string | null; publicUrl: string }

// defer: keeps work running after the response (EdgeRuntime.waitUntil), so
// Twilio and pg_net get an answer at once while a long call is transcribed.
export async function handle(
  req: Request, store: Store, deps: Deps, env: Env,
  verify: (req: Request, token: string, url: string) => Promise<{ form: Record<string, string>; query: URLSearchParams; ok: boolean }>,
  defer: (p: Promise<unknown>) => void = p => { p.catch(() => {}) },
): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const cron = req.headers.get('x-ohvara-cron')
  if (cron) {
    if (!(await store.cronOk(cron))) return json({ error: 'Not allowed' }, 403)
    defer(checkAll(store, deps).then(r => console.log('cancel sweep:', JSON.stringify(r))))
    return json({ ok: true, started: true }, 202)
  }

  if (!req.headers.get('X-Twilio-Signature')) return json({ error: 'Not allowed' }, 403)
  if (!env.authToken) return new Response('Not configured', { status: 503 })
  const { form, query, ok } = await verify(req, env.authToken, env.publicUrl)
  if (!ok) return new Response('Bad signature', { status: 403 })
  if (query.get('event') !== 'rec') return new Response(null, { status: 204 })

  const call = query.get('call') || ''
  const policyId = query.get('policy') || ''
  const state = recordingState(form.RecordingStatus || '')
  if (!call || !UUID.test(policyId) || !state) return new Response(null, { status: 204 })
  const dur = Number(form.RecordingDuration)
  await store.saveRecording(call, {
    recording_sid: form.RecordingSid || undefined,
    conference_sid: form.ConferenceSid || undefined,
    status: state,
    duration_seconds: Number.isFinite(dur) ? dur : null,
    error: state === 'failed' ? (form.ErrorCode ? `Twilio ${form.ErrorCode}` : form.RecordingStatus) : null,
  })
  // A finished (or failed) recording: check the cancels waiting on it now.
  if (state !== 'recording') defer(checkAll(store, deps, policyId))
  return new Response(null, { status: 204 })
}
