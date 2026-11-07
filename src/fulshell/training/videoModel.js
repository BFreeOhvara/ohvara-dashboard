// P877 — training videos, pure (node --test): which lessons have a video, where the files live, how much of a video
// counts as watched, where to resume, and which moment the "?" on a task opens. The files themselves are not in this
// repo (ohvara-reels/training-video builds them); ./videos.json lists them. No imports beyond JSON on purpose.
import VIDEOS from './videos.json' with { type: 'json' }

export const WATCHED_AT = 0.9 // about 90% of a video seen counts as watched
const BUCKET = 2 // seconds per "seen" bucket

// Where the files are served from: VITE_TRAINING_VIDEO_BASE once hosting is set up (a Supabase Storage bucket or
// Vercel Blob, Brayden's door list), else the app's own /training-video/ folder (local and preview builds only).
export function videoBase(env = {}) {
  const b = env.VITE_TRAINING_VIDEO_BASE || VIDEOS.base || '/training-video/'
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
