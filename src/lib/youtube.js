// Prompt 417 — pull the 11-char video ID out of any URL shape an admin
// might paste (watch?v=, youtu.be/, /embed/, /shorts/), so storage stays as
// the raw pasted URL (easy to eyeball/re-open) while render sites only need
// the ID.
const YOUTUBE_ID_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/

export function extractYoutubeId(url) {
  if (!url) return null
  const match = url.match(YOUTUBE_ID_RE)
  return match ? match[1] : null
}

export function youtubeThumbnailUrl(id) {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`
}

export function youtubeEmbedUrl(id) {
  return `https://www.youtube.com/embed/${id}`
}
