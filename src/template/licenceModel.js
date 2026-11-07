// P878 + P881 — the licence rules (N-H-07..10, N-H-12, N-D-06). The NPN is looked up on the national licence registry
// (NIPR, through the nipr-check function); only states with an active life licence are verified, and only verified
// states can be picked for leads. No New York agents for now (Brayden, Q61). Same rules as
// the nipr-check function (core.ts) and licence_verified_states() in the P881 migration.
export const NOT_TAKING = ['NY']
export const NPN_OK = /^\d{6,10}$/
export const SAMPLE_TODAY = '2026-11-07'

// What the registry said (profiles.npn_status). review = sent for a manual check.
export const STATUS = ['unchecked', 'verified', 'no_life', 'not_found', 'registry_down', 'mismatch', 'duplicate', 'review', 'rejected']

export const MESSAGES = {
  unchecked: 'Enter your NPN and check it. We look it up on the national licence registry.',
  verified: 'We found your licence. Pick the states you want leads in; only verified states can be picked.',
  no_life: 'We found your NPN, but no active life licence. You need one to get leads. Your account stays open; add the licence and check again.',
  not_found: 'We couldn’t find that NPN on the national licence registry. Check the number, or send us your licence to check by hand.',
  registry_down: 'The national licence registry isn’t answering right now. Try again in a few minutes, or send us your licence to check by hand.',
  mismatch: 'The name on that licence doesn’t match your account, so an admin will check it by hand.',
  duplicate: 'That NPN is already on another Ohvara account, so an admin will check it by hand.',
  review: 'Sent for a manual check. We’ll tell you when it’s done, usually within a day.',
  rejected: 'We couldn’t verify that licence. Check your NPN and try again, or talk to us.',
}

export const EMPTY_LICENCE = { npn: '', status: 'unchecked', name: null, checkedAt: null, licences: [], states: [], attested: {}, review: null }

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)

// A state counts when the licence is active, has an active life line, hasn't expired or lapsed, and isn't New York.
export const goodLicence = (l, today = SAMPLE_TODAY) =>
  !!l.active && !!l.life && !l.lapsed_at && (!l.expires_on || l.expires_on >= today) && !NOT_TAKING.includes(l.state)

// Why a registry state can't be picked (null = it can).
export function blockedWhy(l, today = SAMPLE_TODAY) {
  if (NOT_TAKING.includes(l.state)) return 'Not taking agents in New York yet'
  if (l.lapsed_at) return `Dropped ${fmtDay(l.lapsed_at)}: no longer active`
  if (!l.active) return 'Licence not active'
  if (!l.life) return 'No life line on this licence'
  if (l.expires_on && l.expires_on < today) return `Expired ${fmtDay(l.expires_on)}`
  return null
}

export const verifiedStates = (v, today = SAMPLE_TODAY) =>
  v?.status === 'verified' ? [...new Set((v.licences || []).filter(l => goodLicence(l, today)).map(l => l.state))].sort() : []

// Setup's licence step is done: a verified NPN, at least one picked verified state, each with its dated yes.
export const licenceReady = (v, today = SAMPLE_TODAY) => {
  const ok = verifiedStates(v, today)
  return !!v && v.status === 'verified' && v.states.length > 0 && v.states.every(s => ok.includes(s) && v.attested[s])
}

// N-H-09/10: the other setup steps carry on while a manual check is pending or there's no life licence yet; the
// launch (and leads) wait for licenceReady.
export const licenceCanGoOn = v => licenceReady(v) || ['review', 'mismatch', 'duplicate', 'no_life'].includes(v?.status)
export const leadsWait = v => !licenceReady(v)

// Fold a check result ({ status, name, licences }) into the form: picked states and yeses outside the verified set drop.
export function applyResult(v, r, at) {
  const next = { ...v, status: r.status, name: r.name ?? null, licences: r.licences || [], checkedAt: at }
  const ok = verifiedStates(next)
  next.states = v.states.filter(s => ok.includes(s))
  next.attested = Object.fromEntries(Object.entries(v.attested || {}).filter(([s]) => ok.includes(s)))
  if (r.status === 'mismatch' || r.status === 'duplicate') next.review = { reason: r.status, auto: true, sentAt: at }
  return next
}

// N-H-12: verified states expiring in the next 30 days.
export function expiringSoon(v, today = SAMPLE_TODAY) {
  return (v?.licences || []).filter(l => goodLicence(l, today) && l.expires_on)
    .map(l => ({ state: l.state, on: l.expires_on, days: daysBetween(today, l.expires_on) }))
    .filter(x => x.days >= 0 && x.days <= 30).sort((a, b) => a.days - b.days)
}
export const lapsed = v => (v?.licences || []).filter(l => l.lapsed_at)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function fmtDay(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : ''
}

// ── Sample registry: the lookup without NIPR. Try 11111111 (not found), 22222222 (registry down), 33333333 (another
// name), 44444444 (no life line), 55555555 (on another account); any other NPN is found under the account's name. ──
const lic = (state, expires_on, more = {}) => ({ state, active: true, life: true, expires_on, number: `${state}-${String(state.charCodeAt(0) * 7919).slice(-6)}`, ...more })
export const SAMPLE_REGISTRY = {
  '19283746': [
    lic('TX', '2028-03-31'), lic('FL', '2026-11-27'), lic('AZ', '2027-08-31'), lic('GA', '2027-05-31'), lic('NC', '2028-01-31'),
    lic('TN', '2027-10-31'), lic('CO', '2027-12-31'), lic('IN', '2028-06-30'), lic('KY', '2027-04-30'), lic('WA', '2027-09-30'),
    lic('CA', '2028-02-29'), lic('OH', '2028-01-31', { life: false }), lic('IL', '2026-10-01', { lapsed_at: '2026-10-02' }),
    lic('NY', '2028-01-31'),
  ],
}
export const SAMPLE_TRIES = [['11111111', 'not found'], ['22222222', 'registry down'], ['33333333', 'another name'], ['44444444', 'no life line'], ['55555555', 'on another account']]

export function sampleLookup(npn, accountName) {
  if (!NPN_OK.test(npn || '')) return { status: 'invalid' }
  if (npn === '11111111') return { status: 'not_found', name: null, licences: [] }
  if (npn === '22222222') return { status: 'registry_down', name: null, licences: [] }
  if (npn === '33333333') return { status: 'mismatch', name: 'ROBERT KING', licences: [lic('TX', '2028-01-31')] }
  if (npn === '44444444') return { status: 'no_life', name: (accountName || '').toUpperCase(), licences: [lic('OH', '2028-01-31', { life: false })] }
  if (npn === '55555555') return { status: 'duplicate', name: (accountName || '').toUpperCase(), licences: [] }
  const licences = SAMPLE_REGISTRY[npn] || [lic('TX', '2028-03-31'), lic('FL', '2027-06-30'), lic('GA', '2027-05-31'), lic('OK', '2026-11-30'), lic('NY', '2028-01-31')]
  return { status: 'verified', name: (accountName || '').toUpperCase(), licences }
}
