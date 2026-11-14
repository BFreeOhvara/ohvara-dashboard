// P842: every avatar takes one of the four palette colours, picked by a stable hash of the person, so the same person
// is the same colour on every page.
// P1001: the hash key is the person's USER ID whenever it is known (Brayden: "derive it from the user id, not from the
// page"). Many surfaces carry only a name, so the portal remembers name -> id as people load (the signed-in account,
// and the real agent / VA / admin lists: rememberPerson) and every name-only avatar resolves through that. With no id
// known (sample data) the lower-cased name is the key, the same on every page and device. Ohvara Support is never a
// colour: it is the Ohvara logo everywhere (isSupportPerson; the avatar components draw it).
export const AVATAR_HUES = ['sky', 'apricot', 'sage', 'butter']
const norm = s => String(s || '').trim().toLowerCase()
const ids = new Map() // lower-cased full name -> user id

export function rememberPerson(id, name) {
  const k = norm(name)
  if (id && k && !isSupportPerson(k)) ids.set(k, String(id))
}
export const forgetPeople = () => ids.clear()
export const personKey = (seed, id = null) => (id ? String(id) : ids.get(norm(seed)) || norm(seed))

export function avatarHue(seed, id = null) {
  const key = personKey(seed, id)
  let h = 2166136261
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) }
  return AVATAR_HUES[(h >>> 0) % AVATAR_HUES.length]
}

// The admin team as agents and VAs see it (P911/P987): one name, one logo.
export const isSupportPerson = name => /^(ohvara( support| team)?|our team)$/.test(norm(name))

// P843: a lead or a client takes the colour of its CURRENT status, the same hue as its stage card (flow.css .is-<tone>
// --cf), so the avatar changes when the stage does. Everyone else (VAs, the agent) keeps avatarHue above.
export const TONE_HUE = { blue: 'sky', warn: 'apricot', teal: 'butter', violet: 'butter', green: 'sage', mute: 'stone' }
export const hueFor = (name, tone) => (tone && TONE_HUE[tone]) || avatarHue(name)
