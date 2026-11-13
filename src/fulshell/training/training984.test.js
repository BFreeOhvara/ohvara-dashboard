// P984 — phone versions of the training videos: the phone app asks for 'phone' and gets the portrait file when a
// lesson has one (else the desktop file); the desk always gets the desktop file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { videoFor, hasVideo, hasPhoneVideo } from './videoModel.js'
import VIDEOS from './videos.json' with { type: 'json' }

const ids = Object.keys(VIDEOS.lessons)
const phones = ids.filter(hasPhoneVideo)

test('every lesson with a video has a phone version', () => {
  assert.deepEqual(ids.filter(id => !hasPhoneVideo(id)), [])
})

test('the phone app gets the phone file; the desk gets the desktop file', () => {
  for (const id of phones) {
    const d = videoFor(id, {}), p = videoFor(id, {}, 'phone')
    assert.ok(hasVideo(id))
    assert.equal(d.variant, undefined)
    assert.equal(p.variant, 'phone')
    assert.notEqual(p.url, d.url)
    assert.match(p.url, /-phone\.mp4$/)
    assert.ok(p.captionsUrl.endsWith('-phone.captions.json'))
    assert.ok(p.duration > 10)
    assert.deepEqual(p.size, [1080, 1920])
    assert.equal(p.title, d.title) // same lesson
    for (const c of p.chapters) assert.ok(c.t >= 0 && c.t < p.duration)
  }
})

test('a lesson without a phone version falls back to the desktop file', () => {
  const id = ids[0]
  const saved = VIDEOS.lessons[id].phone
  delete VIDEOS.lessons[id].phone
  try { assert.equal(videoFor(id, {}, 'phone').url, videoFor(id, {}).url) } finally { if (saved) VIDEOS.lessons[id].phone = saved }
})
