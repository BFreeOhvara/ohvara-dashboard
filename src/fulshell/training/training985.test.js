// P985 — training videos: no skipping ahead (back is fine), resume where you left off (saved on the server when signed
// in), Practice locked until the video has played to the end, always normal speed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { markSeen, emptySeen, finishSeen, furthestOf, seekLimit, clampSeek, resumeAt, mergeSeen, fromRow, toRow, END_SLACK } from './videoModel.js'

const play = (s, from, to, dur, step = 0.25) => { let x = s; for (let t = from; t < to; t += step) x = markSeen(x, t, Math.min(to, t + step), dur); return x }
const src = f => readFileSync(new URL(f, import.meta.url), 'utf8')

test('furthest grows only with playback that runs on from what was watched', () => {
  const dur = 120
  let s = play(emptySeen(dur), 0, 60, dur)
  assert.ok(Math.abs(s.furthest - 60) < 0.01)
  s = markSeen(s, 60, 100, dur) // a jump forward is a seek
  assert.ok(Math.abs(s.furthest - 60) < 0.01)
  s = play(s, 90, 95, dur) // somehow playing from past the furthest point doesn't move it
  assert.ok(Math.abs(s.furthest - 60) < 0.01)
  s = play(s, 20, 40, dur) // going back and rewatching changes nothing
  assert.ok(Math.abs(s.furthest - 60) < 0.01)
  assert.equal(s.watched, false)
})

test('they can move back freely but not past the furthest point, until watched', () => {
  const dur = 120
  const s = play(emptySeen(dur), 0, 60, dur)
  assert.ok(Math.abs(seekLimit(s, dur) - 60) < 0.01)
  assert.equal(clampSeek(s, 30, dur), 30)
  assert.ok(Math.abs(clampSeek(s, 110, dur) - 60) < 0.01)
  const done = play(s, 60, dur - END_SLACK + 0.1, dur)
  assert.equal(done.watched, true)
  assert.equal(seekLimit(done, dur), Infinity)
  assert.equal(clampSeek(done, 110, dur), 110)
  // A lesson already done (free) can move anywhere, watched or not.
  assert.equal(clampSeek(emptySeen(dur), 110, dur, true), 110)
})

test('the end of the video marks it watched, whatever the file length', () => {
  const s = finishSeen(play(emptySeen(100), 0, 97, 100), 100)
  assert.equal(s.watched, true)
  assert.equal(s.furthest, 100)
  assert.equal(s.pos, 0)
})

test('resume at their spot, never past the furthest point', () => {
  const dur = 180
  const s = { ...play(emptySeen(dur), 0, 60, dur), pos: 60 }
  assert.ok(Math.abs(resumeAt(s, dur) - 60) < 0.01)
  assert.ok(Math.abs(resumeAt({ ...s, pos: 150 }, dur) - 60) < 0.01) // a stray spot is held to what they reached
  assert.equal(resumeAt({ pos: 150, watched: true }, dur), 150)
})

test('older saves without furthest: the parts seen from the start without a gap', () => {
  assert.equal(furthestOf({ seen: [0, 1, 2, 3, 7, 8] }, 100), 8)
  assert.equal(furthestOf({ seen: [3, 4] }, 100), 0)
  assert.equal(furthestOf(null, 100), 0)
  assert.equal(seekLimit({ seen: [], watched: true }, 100), Infinity) // already watched before P985 stays watched
})

test('desk/phone/server copies merge forward: furthest and watched never go back; the newer spot wins', () => {
  const dur = 100
  const a = { ...play(emptySeen(dur), 0, 60, dur), pos: 60, at: 1000 }
  const b = { ...play(emptySeen(dur), 0, 20, dur), pos: 12, at: 2000 }
  const m = mergeSeen(a, b, dur)
  assert.ok(Math.abs(m.furthest - 60) < 0.01)
  assert.equal(m.pos, 12)
  assert.equal(m.watched, false)
  assert.equal(mergeSeen(a, { ...b, watched: true }, dur).watched, true)
  assert.equal(mergeSeen(null, b, dur), b)
})

test('a server row round-trips', () => {
  const s = { ...play(emptySeen(100), 0, 61, 100), pos: 61 }
  const row = toRow('inbound', 'phone', s, 100)
  assert.equal(row.p_lesson, 'inbound')
  assert.equal(row.p_variant, 'phone')
  assert.equal(row.p_watched, false)
  assert.equal(toRow('inbound', null, s, 100).p_variant, 'desktop')
  const back = fromRow({ pos: row.p_pos, furthest: row.p_furthest, seen: row.p_seen, watched: row.p_watched, updated_at: '2026-11-13T12:00:00Z' }, 100)
  assert.ok(Math.abs(back.furthest - 61) < 0.2)
  assert.ok(Math.abs(back.pos - 61) < 0.2)
  assert.deepEqual(back.seen, s.seen)
})

test('player: no speed controls, normal speed forced, forward moves snap back', () => {
  const p = src('./VideoPlayer.jsx')
  assert.doesNotMatch(p, /SPEEDS|tr-speed|1\.25x|1\.5/)
  assert.match(p, /controlsList="noplaybackrate nodownload"/)
  assert.match(p, /onRateChange=\{normal\}/)
  assert.match(p, /onSeeking=\{onSeeking\}/)
  assert.match(p, /Watch to unlock the rest/)
  assert.match(p, /prog\.finish\(\)/)
})

test('Practice is locked until the video has played to the end', () => {
  const t = src('./Training.jsx')
  assert.match(t, /videoDone = !vid \|\| st\.state === 'passed' \|\| !!watchedMap\[lesson\.id\]\?\.watched/)
  assert.match(t, /Finish the video first/)
  assert.match(t, /free=\{st\.state === 'passed'\}/)
})

test('the server table: own rows, forward-only saves, admins read', () => {
  const m = readFileSync(new URL('../../../supabase/migrations/272_va_training_video.sql', import.meta.url), 'utf8')
  assert.match(m, /enable row level security/)
  assert.match(m, /user_id = auth\.uid\(\) or public\.is_admin\(\)/)
  assert.match(m, /furthest\s+= greatest\(t\.furthest, excluded\.furthest\)/)
  assert.match(m, /watched\s+= t\.watched or excluded\.watched/)
  assert.match(m, /on delete cascade/)
  assert.match(m, /revoke all on function public\.save_training_video[^;]+from public, anon/)
})

test('furthest keeps up when the store skips small saves (it writes about every 2 s)', () => {
  const dur = 100
  let saved = emptySeen(dur)
  let last = 0
  for (let now = 0.25; now <= 60; now += 0.25) {
    const next = markSeen(saved, last, now, dur)
    // the store's skip: no new 2-second part and the spot moved < 2 s
    if (!(next.seen.length === saved.seen.length && Math.abs((saved.pos || 0) - now) < 2)) saved = { ...next, pos: now }
    last = now
  }
  assert.ok(saved.furthest > 57, `furthest ${saved.furthest}`)
})
