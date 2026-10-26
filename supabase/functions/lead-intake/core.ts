// lead-intake — the logic, kept free of Supabase/Deno imports so it can be
// exercised with fakes (index.ts wires the real database).
//
// The Meta mortgage-protection qualifier posts here with no login, so every
// gate lives in this file: field checks, consent, a per-IP / per-phone rate
// limit and a 24-hour same-phone dedupe. A good lead goes into leads as
// lead_type 'mortgage_protection', lead_source 'meta' (migration 161), is
// handed to the assignment step, and gets delivered_at once an agent has it.
//
// Nothing here texts, emails or calls; that is a separate function. Logs carry
// error text only, never the phone, name or IP.

export const DEDUPE_HOURS = 24
export const IP_LIMIT = 5        // submissions per IP per hour
export const PHONE_LIMIT = 3     // per phone per hour (catches races the dedupe can't)
export const HOUR_MS = 3600e3

export const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
])

// US E.164 only: +1, then a NANP area code and exchange (neither starts with 0 or 1).
export const E164_US = /^\+1[2-9]\d{2}[2-9]\d{6}$/

export type QualifierAnswers = {
  age_range: string
  mortgage_balance_range: string
  homeowner: boolean
  best_time: string | null
  consent_checked: true
  consent_at: string
  utm: { source: string | null; campaign: string | null; ad: string | null }
}

// Only these columns are ever written; nothing else from the body gets through.
export type LeadRow = {
  lead_type: 'mortgage_protection'
  lead_source: 'meta'
  business_name: string   // leads.business_name is NOT NULL (001); a person lead uses the first name
  contact_name: string
  phone: string
  state: string
  qualifier_answers: QualifierAnswers
}

export interface Deps {
  // Newest mortgage_protection lead with this phone created at or after `since`.
  findRecent(phone: string, since: string): Promise<string | null>
  insertLead(row: LeadRow): Promise<string>
  // Assigns the lead; returns the agent's id, or null if nobody qualifies.
  assign(leadId: string): Promise<string | null>
  markDelivered(leadId: string, at: string): Promise<void>
  // Records a hit and says whether `key` is now over `limit` within `windowMs`.
  overLimit(key: string, limit: number, windowMs: number): Promise<boolean>
  now(): Date
  log(msg: string): void
}

export type Result = { status: number; body: { ok: boolean; lead_id?: string; error?: string } }

const ok = (lead_id: string): Result => ({ status: 200, body: { ok: true, lead_id } })
const fail = (status: number, error: string): Result => ({ status, body: { ok: false, error } })

export const MSG = {
  name: 'Enter your first name',
  phone: 'Enter a valid US phone number',
  state: 'Pick your state',
  answers: 'Answer every question',
  consent: 'Please agree to be contacted',
  limited: 'Too many tries. Please wait a bit and try again.',
}

// A sliding-window counter kept in memory. It lives as long as the function's
// worker, so it slows a burst; the 24-hour phone dedupe in the database is the
// lasting guard. Swap for _shared/ipLimit.ts (migration 163) once that lands.
export class Limiter {
  private hits = new Map<string, number[]>()
  private max: number
  constructor(max = 10_000) { this.max = max }
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

// "(512) 555-0123", "512.555.0123", "1 512 555 0123", "+15125550123" → "+15125550123".
// Anything else (letters, wrong length, non-US, bad area code) → null.
export function toE164(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s || s.length > 30 || !/^\+?[\d\s().-]+$/.test(s)) return null
  const digits = s.replace(/\D/g, '')
  const e164 = digits.length === 10 ? `+1${digits}`
    : digits.length === 11 && digits.startsWith('1') ? `+${digits}`
    : null
  return e164 && E164_US.test(e164) ? e164 : null
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s && s.length <= max ? s : null
}

export function validate(body: Record<string, unknown>, now: Date): LeadRow | Result {
  const first_name = text(body.first_name, 100)
  if (!first_name) return fail(400, MSG.name)

  const phone = toE164(body.phone)
  if (!phone) return fail(400, MSG.phone)

  const state = typeof body.state === 'string' ? body.state.trim().toUpperCase() : ''
  if (!US_STATES.has(state)) return fail(400, MSG.state)

  const age_range = text(body.age_range, 40)
  const mortgage_balance_range = text(body.mortgage_balance_range, 40)
  const homeowner = typeof body.homeowner === 'boolean' ? body.homeowner : null
  // best_time may be left blank; a value that's there must be sane.
  const rawTime = body.best_time
  const best_time = rawTime === undefined || rawTime === null || rawTime === '' ? null : text(rawTime, 100)
  if (!age_range || !mortgage_balance_range || homeowner === null || (best_time === null && rawTime)) {
    return fail(400, MSG.answers)
  }

  if (body.consent_checked !== true) return fail(400, MSG.consent)

  // Tracking tags are best-effort: a bad one is dropped, not an error.
  const u = body.utm && typeof body.utm === 'object' && !Array.isArray(body.utm)
    ? body.utm as Record<string, unknown> : {}
  const utm = { source: text(u.source, 200), campaign: text(u.campaign, 200), ad: text(u.ad, 200) }

  return {
    lead_type: 'mortgage_protection',
    lead_source: 'meta',
    business_name: first_name,
    contact_name: first_name,
    phone,
    state,
    qualifier_answers: {
      age_range, mortgage_balance_range, homeowner, best_time,
      consent_checked: true,
      consent_at: now.toISOString(),   // the server's clock, never the client's
      utm,
    },
  }
}

export async function handle(deps: Deps, body: Record<string, unknown>, ip: string | null): Promise<Result> {
  // No IP header: skip this one rather than put every real visitor in one
  // bucket; the phone limit and dedupe below still apply.
  if (ip && await deps.overLimit(`lead-intake:ip:${ip}`, IP_LIMIT, HOUR_MS)) return fail(429, MSG.limited)

  const now = deps.now()
  const row = validate(body, now)
  if ('status' in row) return row

  if (await deps.overLimit(`lead-intake:phone:${row.phone}`, PHONE_LIMIT, HOUR_MS)) return fail(429, MSG.limited)

  // Same phone in the last 24 hours: hand back the lead we already have
  // (a double tap or a resubmit), no second row, no second assignment.
  const since = new Date(now.getTime() - DEDUPE_HOURS * HOUR_MS).toISOString()
  const existing = await deps.findRecent(row.phone, since)
  if (existing) return ok(existing)

  const id = await deps.insertLead(row)
  try {
    const agent = await deps.assign(id)
    if (agent) await deps.markDelivered(id, deps.now().toISOString())
  } catch (err) {
    // The lead is saved unassigned and can be assigned later; the person still gets ok.
    deps.log(`assign failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return ok(id)
}

// First address in x-forwarded-for (the Supabase gateway puts the client first).
export function clientIp(headers: Headers): string | null {
  const xff = headers.get('x-forwarded-for')
  const first = xff?.split(',')[0]?.trim()
  return first || headers.get('cf-connecting-ip') || headers.get('x-real-ip') || null
}
