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

// P843: a lead or a client takes the colour of its CURRENT status, the same hue as its stage card (flow.css .is-<tone>
// --cf), so the avatar changes when the stage does. Everyone else (VAs, the agent) keeps avatarHue above.
export const TONE_HUE = { blue: 'sky', warn: 'apricot', teal: 'butter', violet: 'butter', green: 'sage', mute: 'stone' }
export const hueFor = (name, tone) => (tone && TONE_HUE[tone]) || avatarHue(name)
