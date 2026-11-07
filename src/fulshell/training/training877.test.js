// P877 — training videos: watched at ~90% of real playback (skips don't count), resume, the "?" moment, captions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markSeen, emptySeen, resumeAt, cueAt, videoBase, fmtTime, WATCHED_AT, videoFor, hasVideo, helpTime } from './videoModel.js'
import VIDEOS from './videos.json' with { type: 'json' }
import { LESSONS, HELP } from './lessons.js'

const play = (s, from, to, dur, step = 0.25) => { let x = s; for (let t = from; t < to; t += step) x = markSeen(x, t, Math.min(to, t + step), dur); return x }

test('watching about 90% counts as watched; a skip does not', () => {
  const dur = 100
  let s = emptySeen(dur)
  s = markSeen(s, 0, 80, dur) // a jump of 80 s is a seek, not playback
  assert.equal(s.pct, 0)
  s = play(s, 0, 80, dur)
  assert.ok(s.pct > 0.78 && s.pct < 0.84)
  assert.equal(s.watched, false)
  s = play(s, 80, 90, dur)
  assert.ok(s.pct >= WATCHED_AT)
  assert.equal(s.watched, true)
})

test('watched stays watched; rewatching the same part adds nothing', () => {
  let s = play(emptySeen(40), 0, 40, 40)
  assert.equal(s.watched, true)
  const again = play(s, 0, 10, 40)
  assert.equal(again.pct, s.pct)
  assert.equal(again.watched, true)
})

test('resume where they left off, but not at the very start or end', () => {
  assert.equal(resumeAt({ pos: 42 }, 180), 42)
  assert.equal(resumeAt({ pos: 2 }, 180), 0)
  assert.equal(resumeAt({ pos: 176 }, 180), 0)
  assert.equal(resumeAt(null, 180), 0)
})

test('captions: the line on screen and the word being said', () => {
  const cues = [{ t0: 1, t1: 3, words: [{ w: 'Pick', t: 1 }, { w: 'the', t: 1.4 }, { w: 'agent.', t: 1.6 }] }, { t0: 3.2, t1: 5, words: [{ w: 'Thursday.', t: 3.2 }] }]
  assert.equal(cueAt(cues, 0.5), null)
  assert.deepEqual(cueAt(cues, 1.5), { i: 0, words: ['Pick', 'the', 'agent.'], now: 1 })
  assert.equal(cueAt(cues, 3.1), null)
  assert.equal(cueAt(cues, 4).words[0], 'Thursday.')
})

test('files come from the hosting base once set, else the app folder', () => {
  assert.equal(videoBase({}), '/training-video/')
  assert.equal(videoBase({ VITE_TRAINING_VIDEO_BASE: 'https://x.supabase.co/storage/v1/object/public/training' }), 'https://x.supabase.co/storage/v1/object/public/training/')
  assert.equal(fmtTime(185.4), '3:05')
})

test('every video in the manifest belongs to a real lesson, and every "?" moment is inside its video', () => {
  for (const [id, v] of Object.entries(VIDEOS.lessons)) {
    assert.ok(LESSONS.some(l => l.id === id), `${id} is a lesson`)
    assert.ok(hasVideo(id))
    assert.ok(videoFor(id, {}).url.endsWith(v.src))
    assert.ok(v.duration >= 120 && v.duration <= 300, `${id} is 2-5 minutes (${v.duration} s)`)
    for (const [task, t] of Object.entries(v.helpAt || {})) {
      assert.equal(HELP[task] || task, id, `"?" ${task} opens ${id}`)
      assert.ok(t >= 0 && t < v.duration)
      assert.equal(helpTime(id, task), t)
    }
  }
})
