// P1024 (Brayden, Nov 16): people are shown by name, never by email. One place decides what a usable name is.
// A name is missing when it is blank, still the email the account was made with (older sign-ups saved it that
// way), or the "New user" stand-in. Missing names show as "New user" until the person's name is set.
export const NO_NAME = 'New user'

export const hasRealName = n => {
  const s = typeof n === 'string' ? n.trim() : ''
  return !!s && !s.includes('@') && s !== NO_NAME
}

// The first candidate that is a real name, else "New user". Never returns an email.
export const personName = (...names) => names.find(hasRealName)?.trim() || NO_NAME

// "Jordan McNutt" → ['Jordan', 'McNutt']; "Ana" → ['Ana', '']; a missing name → ['', ''].
export const splitName = n => {
  if (!hasRealName(n)) return ['', '']
  const [first, ...rest] = n.trim().split(/\s+/)
  return [first, rest.join(' ')]
}

export const joinName = (first, last) => `${String(first || '').trim()} ${String(last || '').trim()}`.trim()
