// P877 — training videos, pure (node --test): which lessons have a video, where the files live, how much of a video
// counts as watched, where to resume, and which moment the "?" on a task opens. The files themselves are not in this
// repo (ohvara-reels/training-video builds them); ./videos.json lists them. No imports beyond JSON on purpose.
import VIDEOS from './videos.json' with { type: 'json' }

export const WATCHED_AT = 0.9 // about 90% of a video seen counts as watched
const BUCKET = 2 // seconds per "seen" bucket

// Where the files are served from (P896): the public Supabase Storage bucket `training` on the live project, so every
// build (live, preview, local) plays them with no Vercel setting. VITE_TRAINING_VIDEO_BASE overrides it, e.g.
// '/training-video/' to test freshly built files from the app's own public folder.
export const HOSTED_BASE = 'https://jjextitmbptoaolacocs.supabase.co/storage/v1/object/public/training/'
export function videoBase(env = {}) {
  const b = env.VITE_TRAINING_VIDEO_BASE || VIDEOS.base || HOSTED_BASE
  return b.endsWith('/') ? b : `${b}/`
}

export function videoFor(id, env) {
  const v = VIDEOS.lessons?.[id]
  if (!v) return null
  const base = videoBase(env)
  return { ...v, url: base + v.src, posterUrl: v.poster ? base + v.poster : null, captionsUrl: v.captions ? base + v.captions : null }
}
export const hasVideo = id => !!VIDEOS.lessons?.[id]
export const fmtTime = s => { const n = Math.max(0, Math.round(s || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` }

// "Seen" is a set of 2-second buckets, so skipping ahead does not count as watching.
export const emptySeen = duration => ({ pos: 0, seen: [], pct: 0, watched: false, duration })
export function markSeen(state, from, to, duration) {
  const s = state || emptySeen(duration)
  if (!(to > from) || to - from > 3) return s // a seek, not playback
  const seen = new Set(s.seen)
  for (let b = Math.floor(from / BUCKET); b <= Math.floor(to / BUCKET); b++) seen.add(b)
  const buckets = Math.max(1, Math.ceil(duration / BUCKET))
  const pct = Math.min(1, seen.size / buckets)
  return { ...s, seen: [...seen].sort((a, b) => a - b), pct, watched: s.watched || pct >= WATCHED_AT, duration }
}
// Resume where they left off, unless that was the very end (then start again).
export const resumeAt = (state, duration) => (state && state.pos > 3 && state.pos < duration - 8 ? state.pos : 0)

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
