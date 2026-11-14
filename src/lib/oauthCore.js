// P999 — the pure parts of Apple / Google sign-in (no imports, so node --test loads them). oauth.js re-exports.

// '1.10' > '1.2'. Missing parts count as 0.
export function versionAtLeast(have, want) {
  const a = String(have || '0').split('.').map(n => parseInt(n, 10) || 0)
  const b = String(want).split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0)
  }
  return true
}

// Tokens or an error from a redirect address (hash first, then query).
export function parseAuthReturn(url) {
  let u
  try { u = new URL(String(url)) } catch { return null }
  const params = new URLSearchParams(u.hash.replace(/^#/, ''))
  for (const [k, v] of new URLSearchParams(u.search)) if (!params.has(k)) params.set(k, v)
  const access = params.get('access_token'), refresh = params.get('refresh_token')
  if (access && refresh) return { access_token: access, refresh_token: refresh }
  const err = params.get('error_description') || params.get('error')
  if (err) return { error: err }
  return null
}

// Plain words for what Supabase sends back when a sign-in is refused.
export function oauthErrorText(raw) {
  const m = String(raw || '').replace(/\+/g, ' ')
  if (!m) return ''
  if (/database error saving new user|invite only/i.test(m)) {
    return 'There’s no Ohvara account for that email yet. Sign-up isn’t open right now, so use the email you joined with.'
  }
  if (/access.?denied|cancel/i.test(m)) return 'Sign-in was cancelled.'
  return 'That sign-in didn’t work. Try again, or use your email and password.'
}

// A Google / Apple account made while sign-up was open hasn't agreed to the terms yet (the trigger can't ask).
export const needsTerms = profile =>
  !!profile && profile.role === 'agent' && profile.signup_source === 'self' && !profile.terms_accepted_at

