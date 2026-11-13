// P960 — one caption source: the video's own text track. The cue text carries a timestamp before every word after the
// first, so the words already said can be styled apart, and no two lines of one lesson are ever on screen together.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cueMarkup, vttTime } from './videoModel.js'
import VIDEOS from './videos.json' with { type: 'json' }

test('vttTime formats hh:mm:ss.mmm', () => {
  assert.equal(vttTime(0), '00:00:00.000')
  assert.equal(vttTime(1.312), '00:00:01.312')
  assert.equal(vttTime(3725.5), '01:02:05.500')
})

test('cueMarkup times every word after the first and escapes markup', () => {
  assert.equal(cueMarkup({ words: [{ w: 'Pick', t: 1 }, { w: 'the', t: 1.4 }, { w: 'agent.', t: 1.6 }] }), 'Pick <00:00:01.400>the <00:00:01.600>agent.')
  assert.equal(cueMarkup({ words: [{ w: 'A<b>', t: 0 }, { w: '&', t: 0.5 }] }), 'A&lt;b&gt; <00:00:00.500>&amp;')
})

test('the player draws no caption of its own over the video, and the page has one text track only', () => {
  const src = readFileSync(new URL('./VideoPlayer.jsx', import.meta.url), 'utf8')
  assert.equal(/\btr-cc\b/.test(src), false)
  assert.equal((src.match(/addTextTrack\(/g) || []).length, 1)
  assert.equal(/<track\b/.test(src), false)
})

test('every lesson has a captions file listed', () => {
  assert.equal(Object.keys(VIDEOS.lessons).length, 16) // P976: the 4 lead lessons went
  for (const [id, v] of Object.entries(VIDEOS.lessons)) assert.ok(v.captions, `${id} lists captions`)
})
