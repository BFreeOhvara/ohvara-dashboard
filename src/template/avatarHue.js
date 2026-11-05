// P842: every avatar takes one of the four palette colours, picked by a stable hash of the person, so the same person
// is the same colour on every page. The key is the person's name (lower-cased): it is the one thing every surface
// that shows a person carries (some only have the name), so it is what keeps one person one colour everywhere.
export const AVATAR_HUES = ['sky', 'apricot', 'sage', 'butter']
export function avatarHue(seed) {
  const key = String(seed || '').trim().toLowerCase()
  let h = 2166136261
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) }
  return AVATAR_HUES[(h >>> 0) % AVATAR_HUES.length]
}
