/**
 * Node unit tests for fulfillment-cancel-check (Prompt 764): mocked Twilio
 * callbacks, fake transcripts, a fake Claude. No real calls, audio or AI.
 * Run: node --test supabase/functions/fulfillment-cancel-check/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handle, checkCancel, parseVerdict, quoteInTranscript, transcriptLines, recordingState, MAX_ATTEMPTS, type Store, type Deps, type Cancel, type Recording, type Transcript } from './core.ts'
import { twilioSignature, readTwilioRequest } from '../_shared/twilio.ts'

const POL = '44444444-4444-4444-8444-444444444444'
const URL_ = 'https://x.supabase.co/functions/v1/fulfillment-cancel-check'
const TOKEN = 'tw-token'
const NOW = Date.parse('2026-10-14T18:00:00Z')

const CLEAR: Transcript = {
  text: '',
  utterances: [
    { start: 2, speaker: 0, text: 'Thanks for calling Globe Life, this is Dana.' },
    { start: 9, speaker: 1, text: 'Hi, I have Maria Lopez on the line, she wants to cancel her policy.' },
    { start: 95, speaker: 0, text: 'Okay, I have processed that. Policy GL-4410 is cancelled effective today.' },
    { start: 101, speaker: 1, text: 'Great, thank you.' },
  ],
}
const MUMBLED: Transcript = { text: '', utterances: [{ start: 3, speaker: 0, text: 'mm yeah let me uh check the uh' }, { start: 40, speaker: 1, text: 'hello? are you there' }] }

function world(over: { recs?: Recording[]; cancel?: Partial<Cancel>; transcript?: Transcript | Error; answer?: any; status?: string } = {}) {
  const cancel: Cancel & { status: string; next?: string | null; claimed?: boolean } = {
    id: 'c1', policy_id: POL, logged_at: new Date(NOW - 60e3).toISOString(), check_attempts: 0,
    client_name: 'Maria Lopez', carrier_name: 'Globe Life', status: over.status ?? 'checking', ...over.cancel,
  }
  const recs: Recording[] = over.recs ?? [{ id: 'r1', recording_sid: 'RE1', status: 'ready', created_at: new Date(NOW - 20 * 60e3).toISOString() }]
  const checks: any[] = []
  const results: any[] = []
  const saved: any[] = []
  const asked: any[] = []
  const store: Store = {
    async cronOk(s) { return s === 'cron' },
    async saveRecording(call, patch) { saved.push([call, patch]) },
    async checking() { return cancel.status === 'checking' ? [cancel] : [] },
    async claim() {
      if (cancel.status !== 'checking') return null
      cancel.check_attempts++
      return { ...cancel }
    },
    async release(_id, at) { cancel.next = at },
    async recordings() { return recs },
    async policyNumber() { return 'GL-4410' },
    async saveCheck(row) { checks.push(row) },
    // Same rule as fulfillment_cancel_check_result: only from checking, never not_paid.
    async result(_id, confirmed, reason, at, rec) {
      results.push({ confirmed, reason, at, rec })
      if (cancel.status !== 'checking') return cancel.status
      cancel.status = confirmed ? 'verified' : 'needs_listen'
      return cancel.status
    },
  }
  const deps: Deps = {
    async audio(sid) { return new TextEncoder().encode(`audio:${sid}`) },
    async transcribe() { if (over.transcript instanceof Error) throw over.transcript; return over.transcript ?? CLEAR },
    async ask(p) {
      asked.push(p)
      const a = over.answer ?? { text: JSON.stringify({ confirmed: true, quote: 'Policy GL-4410 is cancelled effective today.', at_seconds: 95, reason: 'Carrier rep confirmed the cancel.' }) }
      if (a instanceof Error) throw a
      return a
    },
    now: () => NOW,
  }
  return { store, deps, cancel, checks, results, saved, asked }
}

test('a clear carrier confirmation → verified, with the quote and time saved (admin-only table)', async () => {
  const w = world()
  const r = await checkCancel(w.store, w.deps, 'c1')
  assert.equal(r.status, 'verified')
  assert.deepEqual(w.results[0], { confirmed: true, reason: null, at: 95, rec: 'r1' })
  assert.equal(w.checks[0].quote, 'Policy GL-4410 is cancelled effective today.')
  assert.match(w.checks[0].transcript, /^\[00:02\] Speaker 1: Thanks for calling/)
  assert.match(w.asked[0].user, /Carrier: Globe Life\nClient: Maria Lopez\nPolicy number: GL-4410/)
  assert.match(w.asked[0].user, /\[01:35\] Speaker 1: Okay, I have processed that/)
})

test('a mumbled / unclear call → needs a listen (never not paid)', async () => {
  const w = world({ transcript: MUMBLED, answer: { text: JSON.stringify({ confirmed: false, quote: '', at_seconds: 40, reason: 'The carrier never confirmed anything.' }) } })
  const r = await checkCancel(w.store, w.deps, 'c1')
  assert.equal(r.status, 'needs_listen')
  assert.deepEqual(w.results[0], { confirmed: false, reason: 'unclear', at: 40, rec: 'r1' })
})

test('the AI says yes but the quote isn\'t in the transcript → needs a listen', async () => {
  const w = world({ transcript: MUMBLED, answer: { text: JSON.stringify({ confirmed: true, quote: 'Your policy is cancelled.', at_seconds: 12, reason: 'Confirmed.' }) } })
  assert.equal((await checkCancel(w.store, w.deps, 'c1')).status, 'needs_listen')
  assert.match(w.checks[0].reason, /quote not found/)
})

test('a speech-to-text error retries a few times, then needs a listen', async () => {
  const w = world({ transcript: new Error('Deepgram 502') })
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    const r = await checkCancel(w.store, w.deps, 'c1')
    assert.equal(r.status, 'checking')
    assert.ok(r.retry)
  }
  assert.ok(w.cancel.next)
  const last = await checkCancel(w.store, w.deps, 'c1')
  assert.equal(last.status, 'needs_listen')
  assert.equal(w.results.at(-1).reason, 'stt_error')
  assert.equal(w.results.length, 1)
})

test('an AI error, a refusal, unreadable JSON, an empty transcript → needs a listen', async () => {
  const err = world({ answer: new Error('529 overloaded'), cancel: { check_attempts: MAX_ATTEMPTS - 1 } })
  assert.equal((await checkCancel(err.store, err.deps, 'c1')).status, 'needs_listen')
  assert.equal(err.results[0].reason, 'ai_error')
  const refused = world({ answer: { text: null, refusal: true } })
  assert.equal((await checkCancel(refused.store, refused.deps, 'c1')).status, 'needs_listen')
  assert.equal(refused.results[0].reason, 'refused')
  const junk = world({ answer: { text: 'Sure! The carrier confirmed it.' }, cancel: { check_attempts: MAX_ATTEMPTS - 1 } })
  assert.equal((await checkCancel(junk.store, junk.deps, 'c1')).status, 'needs_listen')
  assert.equal(junk.results[0].reason, 'ai_error')
  const empty = world({ transcript: { text: '', utterances: [] } })
  assert.equal((await checkCancel(empty.store, empty.deps, 'c1')).status, 'needs_listen')
  assert.equal(empty.results[0].reason, 'unclear')
  assert.equal(empty.asked.length, 0)
})

test('no recording: needs a listen; a call still recording waits (up to 30 min)', async () => {
  const none = world({ recs: [] })
  assert.equal((await checkCancel(none.store, none.deps, 'c1')).status, 'needs_listen')
  assert.equal(none.results[0].reason, 'no_recording')
  const busy = world({ recs: [{ id: 'r2', recording_sid: null, status: 'recording', created_at: new Date(NOW - 5 * 60e3).toISOString() }] })
  assert.equal((await checkCancel(busy.store, busy.deps, 'c1')).status, 'checking')
  const late = world({ recs: [{ id: 'r2', recording_sid: null, status: 'recording', created_at: new Date(NOW - 50 * 60e3).toISOString() }], cancel: { logged_at: new Date(NOW - 40 * 60e3).toISOString() } })
  assert.equal((await checkCancel(late.store, late.deps, 'c1')).status, 'needs_listen')
  const failed = world({ recs: [{ id: 'r3', recording_sid: 'RE3', status: 'failed', created_at: new Date(NOW - 5 * 60e3).toISOString() }] })
  assert.equal((await checkCancel(failed.store, failed.deps, 'c1')).status, 'needs_listen')
  // A recording that started after the cancel was logged isn't this call's.
  const after = world({ recs: [{ id: 'r4', recording_sid: 'RE4', status: 'ready', created_at: new Date(NOW + 5 * 60e3).toISOString() }] })
  assert.equal((await checkCancel(after.store, after.deps, 'c1')).status, 'needs_listen')
})

test('a cancel that is no longer checking (flagged, decided) is left alone', async () => {
  const w = world({ status: 'needs_listen' })
  assert.equal((await checkCancel(w.store, w.deps, 'c1')).status, 'skipped')
  assert.equal(w.asked.length, 0)
})

async function twilioPost(query: string, form: Record<string, string>, sig?: string) {
  const s = sig ?? await twilioSignature(TOKEN, URL_ + query, form)
  return new Request(`http://internal/fulfillment-cancel-check${query}`, {
    method: 'POST', headers: { 'X-Twilio-Signature': s, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form),
  })
}
const ENV = { authToken: TOKEN, publicUrl: URL_ }

test('Twilio callback: signature checked; completed recording saved and its cancels checked', async () => {
  const w = world()
  const jobs: Promise<unknown>[] = []
  const q = `?event=rec&policy=${POL}&call=CArep`
  const bad = await handle(await twilioPost(q, { RecordingStatus: 'completed' }, 'nope'), w.store, w.deps, ENV, readTwilioRequest, p => jobs.push(p))
  assert.equal(bad.status, 403)
  const ok = await handle(await twilioPost(q, { RecordingStatus: 'completed', RecordingSid: 'RE1', ConferenceSid: 'CF1', RecordingDuration: '612' }), w.store, w.deps, ENV, readTwilioRequest, p => jobs.push(p))
  assert.equal(ok.status, 204)
  await Promise.all(jobs)
  assert.deepEqual(w.saved[0], ['CArep', { recording_sid: 'RE1', conference_sid: 'CF1', status: 'ready', duration_seconds: 612, error: null }])
  assert.equal(w.cancel.status, 'verified')
  // in-progress only saves; absent is a failed recording.
  assert.equal(recordingState('in-progress'), 'recording')
  assert.equal(recordingState('absent'), 'failed')
})

test('cron sweep: needs the Vault secret; unsigned requests are refused', async () => {
  const w = world()
  const jobs: Promise<unknown>[] = []
  const nope = await handle(new Request('http://x', { method: 'POST', headers: { 'x-ohvara-cron': 'guess' } }), w.store, w.deps, ENV, readTwilioRequest, p => jobs.push(p))
  assert.equal(nope.status, 403)
  const anon = await handle(new Request('http://x', { method: 'POST', body: '{}' }), w.store, w.deps, ENV, readTwilioRequest, p => jobs.push(p))
  assert.equal(anon.status, 403)
  const ok = await handle(new Request('http://x', { method: 'POST', headers: { 'x-ohvara-cron': 'cron' } }), w.store, w.deps, ENV, readTwilioRequest, p => jobs.push(p))
  assert.equal(ok.status, 202)
  await Promise.all(jobs)
  assert.equal(w.cancel.status, 'verified')
})

test('helpers: verdict parsing, quote matching, transcript lines', () => {
  assert.deepEqual(parseVerdict('{"confirmed":true,"quote":"q","at_seconds":12.34,"reason":"r"}'), { confirmed: true, quote: 'q', at_seconds: 12.3, reason: 'r' })
  assert.equal(parseVerdict('{"confirmed":"yes"}'), null)
  assert.equal(parseVerdict(null), null)
  assert.ok(quoteInTranscript('policy gl-4410 is CANCELLED, effective today', CLEAR))
  assert.ok(!quoteInTranscript('ok', CLEAR))
  assert.equal(transcriptLines({ text: 'plain words', utterances: [] }), 'plain words')
})
