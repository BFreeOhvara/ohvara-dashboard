// submit-mp-lead — the logic, kept free of Supabase/Deno imports so it can be
// exercised with fakes (index.ts wires the real database).
//
// The public mortgage-protection lead form posts here with no login, so every
// gate lives in this file: field checks, a honeypot, a per-IP / per-phone rate
// limit and a 30-day repeat-phone drop. A good lead is stored in leads as
// lead_type 'mortgage_protection', lead_source 'meta' (migration 166), and
// handed to assign_lead (migration 162), which also charges the agent.
//
// The caller only ever gets { ok: true } (or a field error). A bot, a repeat
// phone, a rate-limited caller and a real lead all look the same, and nothing
// about the agent it went to comes back. Nothing here texts, emails or calls.
// Logs carry error text only, never the phone, name or IP.

// The consent wording version the form shows. The server stores this value,
// not the client's; a form showing older wording is turned away.
export const MP_CONSENT_VERSION = 'mp-v1'

export const DEDUPE_DAYS = 30
export const IP_LIMIT = 5        // submissions per IP per hour
export const PHONE_LIMIT = 2     // per phone per hour (catches races the 30-day check can't)
const HOUR_MS = 3600e3
const DAY_MS = 24 * HOUR_MS

export const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
])

// US E.164 only: +1, then a NANP area code and exchange (neither starts with 0 or 1).
export const E164_US = /^\+1[2-9]\d{2}[2-9]\d{6}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
// The form's hidden field. People never see or fill it; bots do.
export const HONEYPOT = 'website'

// The Meta mortgage-protection value of leads.lead_type (166). Google
// policy-help calls are 'policy_help'.
export const MP_LEAD_TYPE = 'mortgage_protection'

// The qualifier's answers, the consent record and the tracking tags, kept
// together in leads.qualifier_answers (166).
export type QualifierAnswers = {
  age_band: string
  mortgage_balance_band: string
  homeowner: boolean
  smoker: boolean
  best_time: string | null
  consent_at: string
  consent_text_version: string
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
}

// Only these leads columns are ever written; nothing else from the body gets through.
export type LeadRow = {
  lead_type: typeof MP_LEAD_TYPE
  lead_source: 'meta'
  business_name: string   // leads.business_name is NOT NULL (001); a person lead uses their name
  contact_name: string
  phone: string
  email: string | null
  state: string
  qualifier_answers: QualifierAnswers
}

export interface Deps {
  // leads rows of MP_LEAD_TYPE with this phone created at or after `since`.
  countPhone(phone: string, since: string): Promise<number>
  insertLead(row: LeadRow): Promise<string>
  assign(leadId: string): Promise<void>
  limiter: Limiter
  now(): Date
  log(msg: string): void
}

export type Result = { status: number; body: Record<string, unknown> }

const OK: Result = { status: 200, body: { ok: true } }
const bad = (error: string): Result => ({ status: 400, body: { error } })

export const MSG = {
  name: 'Enter your first name',
  phone: 'Enter a valid US mobile number',
  state: 'Pick your state',
  email: 'Enter a valid email or leave it blank',
  answers: 'Answer every question',
  consent: 'Please agree to be contacted',
  stale: 'This page is out of date. Refresh and try again.',
}

// A sliding-window counter kept in memory. It lives as long as the function's
// worker, so it slows a burst from one IP; the 30-day phone check in the
// database is the lasting guard.
export class Limiter {
  private hits = new Map<string, number[]>()
  private max: number
  constructor(max = 10_000) { this.max = max }
  // Records a hit and says whether `key` is now over `limit` within `windowMs`.
  over(key: string, limit: number, windowMs: number, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter(t => now - t < windowMs)
    recent.push(now)
    this.hits.set(key, recent)
    if (this.hits.size > this.max) this.prune(now, windowMs)
    return recent.length > limit
  }
  private prune(now: number, windowMs: number) {
    for (const [k, ts] of this.hits) if (!ts.some(t => now - t < windowMs)) this.hits.delete(k)
    // Still too big (a flood of distinct keys): start over rather than grow without bound.
    if (this.hits.size > this.max) this.hits.clear()
  }
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s && s.length <= max ? s : null
}
const optText = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined || v === null || v === '') return null
  return text(v, max) ?? undefined   // undefined = present but invalid
}
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

export function validate(body: Record<string, unknown>, now: Date): LeadRow | Result {
  const first_name = text(body.first_name, 100)
  if (!first_name) return bad(MSG.name)
  const last_name = optText(body.last_name, 100)
  if (last_name === undefined) return bad(MSG.name)

  const phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  if (!E164_US.test(phone)) return bad(MSG.phone)

  const state = typeof body.state === 'string' ? body.state.trim().toUpperCase() : ''
  if (!US_STATES.has(state)) return bad(MSG.state)

  let email = optText(body.email, 254)
  if (email === undefined || (email && !EMAIL_RE.test(email))) return bad(MSG.email)
  email = email ? email.toLowerCase() : null

  const age_band = text(body.age_band, 40)
  const mortgage_balance_band = text(body.mortgage_balance_band, 40)
  const homeowner = bool(body.homeowner)
  const smoker = bool(body.smoker)
  const best_time = optText(body.best_time, 100)
  if (!age_band || !mortgage_balance_band || homeowner === null || smoker === null || best_time === undefined) {
    return bad(MSG.answers)
  }

  if (body.consent !== true) return bad(MSG.consent)
  if (body.consent_text_version !== MP_CONSENT_VERSION) return bad(MSG.stale)

  // Tracking tags are best-effort: a bad one is dropped, not an error.
  const utm = Object.fromEntries(UTM.map(k => [k, text(body[k], 200)])) as Record<typeof UTM[number], string | null>

  const name = last_name ? `${first_name} ${last_name}` : first_name
  return {
    lead_type: MP_LEAD_TYPE,
    lead_source: 'meta',
    business_name: name,
    contact_name: name,
    phone, email, state,
    qualifier_answers: {
      age_band, mortgage_balance_band, homeowner, smoker, best_time,
      consent_at: now.toISOString(),
      consent_text_version: MP_CONSENT_VERSION,
      ...utm,
    },
  }
}

export async function handle(deps: Deps, body: Record<string, unknown>, ip: string | null): Promise<Result> {
  // A filled honeypot is a bot: look like success, store nothing.
  const trap = body[HONEYPOT]
  if (trap !== undefined && trap !== null && trap !== '') return OK

  const now = deps.now()
  const t = now.getTime()
  // No IP header: skip this one rather than put every real visitor in one
  // bucket; the phone limit and 30-day check below still apply.
  if (ip && deps.limiter.over(`ip:${ip}`, IP_LIMIT, HOUR_MS, t)) return OK

  const row = validate(body, now)
  if ('status' in row) return row

  if (deps.limiter.over(`phone:${row.phone}`, PHONE_LIMIT, HOUR_MS, t)) return OK

  // Same phone in the last 30 days: drop it quietly so the reply can't be used
  // to learn who has already asked.
  const since = new Date(t - DEDUPE_DAYS * DAY_MS).toISOString()
  if ((await deps.countPhone(row.phone, since)) > 0) return OK

  const id = await deps.insertLead(row)
  try {
    await deps.assign(id)
  } catch (err) {
    // The lead is saved as 'new' and can be assigned later; the person still gets ok.
    deps.log(`assign failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return OK
}

// First address in x-forwarded-for (the Supabase gateway puts the client first).
export function clientIp(headers: Headers): string | null {
  const xff = headers.get('x-forwarded-for')
  const first = xff?.split(',')[0]?.trim()
  return first || headers.get('cf-connecting-ip') || headers.get('x-real-ip') || null
}
