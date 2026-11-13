// P877 — training videos, pure (node --test): which lessons have a video, where the files live, how much of a video
// counts as watched, where to resume, and which moment the "?" on a task opens. The files themselves are not in this
// repo (ohvara-reels/training-video builds them); ./videos.json lists them. No imports beyond JSON on purpose.
import VIDEOS from './videos.json' with { type: 'json' }

// P985: watched = played to the end (not ~90% any more). Until then nobody can move past the furthest point they have
// really played to; afterwards (or once the lesson is done) they can move anywhere.
export const END_SLACK = 1.5 // within this many seconds of the end counts as the end
const RUN_ON = 3 // playback starting this close after the furthest point carries it on
const BUCKET = 2 // seconds per "seen" bucket

// Where the files are served from (P896): the public Supabase Storage bucket `training` on the live project, so every
// build (live, preview, local) plays them with no Vercel setting. VITE_TRAINING_VIDEO_BASE overrides it, e.g.
// '/training-video/' to test freshly built files from the app's own public folder.
export const HOSTED_BASE = 'https://jjextitmbptoaolacocs.supabase.co/storage/v1/object/public/training/'
export function videoBase(env = {}) {
  const b = env.VITE_TRAINING_VIDEO_BASE || VIDEOS.base || HOSTED_BASE
  return b.endsWith('/') ? b : `${b}/`
}

// P984: a lesson can also have a phone version (videos.json lessons[id].phone, portrait), recorded in the VA phone app.
// The phone app asks for 'phone' and falls back to the desktop video when a lesson has no phone version.
export function videoFor(id, env, variant = null) {
  const d = VIDEOS.lessons?.[id]
  const v = variant === 'phone' && d?.phone ? { ...d, ...d.phone, variant: 'phone' } : d
  if (!v) return null
  const base = videoBase(env)
  return { ...v, url: base + v.src, posterUrl: v.poster ? base + v.poster : null, captionsUrl: v.captions ? base + v.captions : null }
}
export const hasVideo = id => !!VIDEOS.lessons?.[id]
export const hasPhoneVideo = id => !!VIDEOS.lessons?.[id]?.phone
export const fmtTime = s => { const n = Math.max(0, Math.round(s || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` }

// "Seen" is a set of 2-second buckets, so skipping ahead does not count as watching. `furthest` is the furthest second
// reached by real playback that ran on from what was already watched (P985).
export const emptySeen = duration => ({ pos: 0, seen: [], pct: 0, watched: false, furthest: 0, duration })
// Older saves have no `furthest`: take the parts seen without a gap from the start.
export function furthestOf(s, duration = Infinity) {
  if (!s) return 0
  if (Number.isFinite(s.furthest)) return s.furthest
  const seen = new Set(s.seen || [])
  let b = 0
  while (seen.has(b)) b++
  return Math.min(duration || Infinity, b * BUCKET)
}
const pctOf = (seen, duration) => Math.min(1, seen.length / Math.max(1, Math.ceil(duration / BUCKET)))
export function markSeen(state, from, to, duration) {
  const s = state || emptySeen(duration)
  if (!(to > from) || to - from > 3) return s // a seek, not playback
  const set = new Set(s.seen)
  for (let b = Math.floor(from / BUCKET); b <= Math.floor(to / BUCKET); b++) set.add(b)
  const seen = [...set].sort((a, b) => a - b)
  const far = furthestOf(s, duration)
  // The store saves about every 2 s of playback, so `from` can sit a little past the last saved furthest point.
  const furthest = from <= far + RUN_ON ? Math.max(far, Math.min(to, duration)) : far
  return { ...s, seen, pct: pctOf(seen, duration), furthest, watched: !!s.watched || furthest >= duration - END_SLACK, duration }
}
// The video played to its end (the player's `ended`), whatever the file's exact length.
export const finishSeen = (state, duration) => ({ ...(state || emptySeen(duration)), furthest: duration, watched: true, pos: 0, duration })
// How far they may move: anywhere once watched (or `free`: the lesson is already done), else up to `furthest`.
export const seekLimit = (state, duration, free = false) => (free || state?.watched ? Infinity : furthestOf(state, duration))
export const clampSeek = (state, t, duration, free = false) => Math.max(0, Math.min(t, seekLimit(state, duration, free)))
// Resume where they left off, unless that was the very end (then start again); never past where they may move.
export const resumeAt = (state, duration, free = false) => {
  const p = state && state.pos > 3 && state.pos < duration - 8 ? state.pos : 0
  return clampSeek(state, p, duration, free)
}
// Two saves of the same video (this device and the server): furthest and watched only move forward, seen parts add up,
// the spot is the newer one's.
export function mergeSeen(a, b, duration) {
  if (!a) return b || null
  if (!b) return a
  const seen = [...new Set([...(a.seen || []), ...(b.seen || [])])].sort((x, y) => x - y)
  const newer = (b.at || 0) > (a.at || 0) ? b : a
  return {
    ...a, seen, pct: pctOf(seen, duration), duration,
    furthest: Math.max(furthestOf(a, duration), furthestOf(b, duration)),
    watched: !!a.watched || !!b.watched,
    pos: newer.pos || 0, at: Math.max(a.at || 0, b.at || 0),
  }
}
// A server row (va_training_video) as a saved state, and back.
export const fromRow = (r, duration) => ({
  pos: Number(r.pos) || 0, seen: (r.seen || []).map(Number), pct: pctOf(r.seen || [], duration), watched: !!r.watched,
  furthest: Number(r.furthest) || 0, duration, at: Date.parse(r.updated_at) || 0,
})
export const toRow = (id, variant, s, duration) => ({
  p_lesson: id, p_variant: variant === 'phone' ? 'phone' : 'desktop', p_pos: Math.round((s.pos || 0) * 10) / 10,
  p_furthest: Math.round(furthestOf(s, duration) * 10) / 10, p_seen: s.seen || [], p_watched: !!s.watched,
})

// The "?" on a task opens the lesson's video at the moment that task is shown (videos.json helpAt), if there is one.
export const helpTime = (lessonId, task) => {
  const v = VIDEOS.lessons?.[lessonId]
  const t = v?.helpAt?.[task]
  return Number.isFinite(t) ? t : null
}

// Captions: the line on screen at time t, and which of its words is being said.
export function cueAt(cues, t) {
  if (!cues) return null
  let lo = 0, hi = cues.length - 1, hit = -1
  while (lo <= hi) { const m = (lo + hi) >> 1; if (cues[m].t0 <= t) { hit = m; lo = m + 1 } else hi = m - 1 }
  if (hit < 0 || t > cues[hit].t1) return null
  const c = cues[hit]
  let w = 0
  for (let i = 0; i < c.words.length; i++) if (c.words[i].t <= t) w = i
  return { i: hit, words: c.words.map(x => x.w), now: w }
}

// P960 — one caption source: the lesson video's own text track (drawn by the browser, so it looks and behaves the same
// in the page, in fullscreen and on phones). Each line becomes WebVTT cue text with a timestamp before every word after
// the first, so the words already said can be styled apart (video::cue(:past)).
const pad = (n, w) => String(n).padStart(w, '0')
export function vttTime(t) {
  const ms = Math.round(Math.max(0, t) * 1000)
  return `${pad(Math.floor(ms / 3600000), 2)}:${pad(Math.floor(ms / 60000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)}.${pad(ms % 1000, 3)}`
}
const escVtt = w => String(w).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export function cueMarkup(c) {
  return c.words.map((x, i) => (i === 0 ? escVtt(x.w) : `<${vttTime(x.t)}>${escVtt(x.w)}`)).join(' ')
}
