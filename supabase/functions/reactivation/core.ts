// reactivation — P952. The national Do Not Call + TCPA litigator scrub for paid reactivation lists. index.ts wires
// Deno; the logic is here, free of Deno globals, so core.test.ts runs it with a fake scrubber and store.
//
// pg_cron (every 5 minutes, x-ohvara-cron) → { action: 'scrub' }: claims paid lists waiting for the scrub
// (reactivation_scrub_claim; none while reactivation_settings.scrub_provider = 'none'), checks every number with the
// provider, and reports the flagged ones (reactivation_scrub_done): they come off the list, their price is paid back
// (lead-spend's cron), national DNC numbers are remembered in dnc_numbers, and the list starts calling.
// A provider error leaves the list waiting; nothing is ever dialed before its list is scrubbed.
//
// Providers (brain/ohvara/Reactivation.md, "What Brayden signs up for"):
//   blacklist_alliance  Blacklist Alliance lookup API (federal DNC + litigators + state DNC). Secret SCRUB_API_KEY.
//                       CHECK the response fields against their docs when the account is opened (parseBlacklist).
//   stub                tests only: numbers ending 0000 = national DNC, 9999 = litigator. Never set on live.

import { FLOW_STEPS, fillWords } from '../_shared/leadFlows.js'

export type Flag = { phone: string; reason: 'national_dnc' | 'litigator' }
export type Scrubber = { name: string; check(phones: string[]): Promise<Flag[]> }
export type Store = { rpc(name: string, args: Record<string, unknown>): Promise<any> }
type Fetch = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>

export const stubScrubber: Scrubber = {
  name: 'stub',
  async check(phones) {
    return phones.flatMap(p => (p.endsWith('0000') ? [{ phone: p, reason: 'national_dnc' as const }]
      : p.endsWith('9999') ? [{ phone: p, reason: 'litigator' as const }] : []))
  },
}

// One Blacklist Alliance answer → a flag or null. A litigator wins over DNC (the bigger risk).
export function parseBlacklist(phone: string, body: any): Flag | null {
  const text = JSON.stringify(body ?? {}).toLowerCase()
  if (/litigator|tcpa|plaintiff|attorney/.test(text)) return { phone, reason: 'litigator' }
  if (/"message":"good"/.test(text)) return null
  if (/fed[-_ ]?dnc|national[-_ ]?dnc|"dnc"|blacklisted|do not call/.test(text)) return { phone, reason: 'national_dnc' }
  return null
}

export function blacklistAlliance(key: string, f: Fetch, concurrency = 8): Scrubber {
  return {
    name: 'blacklist_alliance',
    async check(phones) {
      if (!key) throw new Error('SCRUB_API_KEY is not set')
      const flags: Flag[] = []
      for (let i = 0; i < phones.length; i += concurrency) {
        const got = await Promise.all(phones.slice(i, i + concurrency).map(async p => {
          const digits = p.replace(/^\+1/, '')
          const r = await f(`https://api.blacklistalliance.net/lookup?key=${encodeURIComponent(key)}&ver=v3&resp=json&phone=${digits}`)
          if (!r.ok) throw new Error(`scrub ${r.status}`)
          return parseBlacklist(p, await r.json())
        }))
        for (const g of got) if (g) flags.push(g)
      }
      return flags
    },
  }
}

export function scrubberFor(provider: string, env: { key: string }, f: Fetch): Scrubber | null {
  if (provider === 'stub') return stubScrubber
  if (provider === 'blacklist_alliance') return blacklistAlliance(env.key, f)
  return null // 'none', or a provider with no adapter yet: lists keep waiting
}

export async function scrubRun(store: Store, provider: string, scrubber: Scrubber | null) {
  if (!scrubber) return { skipped: `no scrubber for ${provider || 'none'}`, lists: 0 }
  const got = await store.rpc('reactivation_scrub_claim', { p_limit: 3 })
  const claimed: { list_id: string; phones: string[] | null }[] = Array.isArray(got) ? got : []
  const results = []
  for (const l of claimed) {
    try {
      const flags = await scrubber.check(l.phones || [])
      results.push({ list_id: l.list_id, ...(await store.rpc('reactivation_scrub_done', { p_list: l.list_id, p_flagged: flags, p_provider: scrubber.name })) })
    } catch (e) {
      results.push({ list_id: l.list_id, error: String((e as Error)?.message || e).slice(0, 200) }) // stays waiting; next run tries again
    }
  }
  return { lists: claimed.length, results }
}

// -- P957: booking texts, only to people who booked AND said yes to "Can I text you the confirmation?" ----------------
// pg_cron (reactivation_tick, while sms_live) -> { action: 'texts' }: reactivation_texts_claim hands back due texts
// (nothing unless sms_live AND reactivation_live; never from a main number; cancelled if they stopped, the time moved
// or the appointment passed). Words = the normal booked flow (leadFlows.js) without the booking link, which imported
// people don't have; the first text says how to stop. Sent from the reactivation pool number the claim picked.
export type TextJob = { id: string; step: string; to: string; from: string; first: string; agent: string; appt_at: string; tz: string }
export type Send = (to: string, from: string, body: string) => Promise<{ ok: boolean; id?: string; error?: string }>

const NO_LINK: Record<string, [string, string]> = {
  bk_confirm: [' from {number}. Reply C to confirm or change it here: {link}', '. Reply C to confirm, or reply with a better time. Reply STOP to opt out.'],
  bk_day_before: [' Reply C to confirm or change it here: {link}', ' Reply C to confirm, or reply with a better time.'],
  bk_morning: [' Need a different time? {link}', ' Need a different time? Just reply.'],
  bk_1h: [' Need a different time? {link}', ' Need a different time? Just reply.'],
}
export function reactivationTextBody(j: Pick<TextJob, 'step' | 'first' | 'agent' | 'appt_at' | 'tz'>): string | null {
  const step = (FLOW_STEPS as any).booked.find((x: any) => x.key === j.step)
  const fix = NO_LINK[j.step]
  if (!step || !fix) return null
  const at = new Date(j.appt_at)
  const tz = j.tz || 'America/Chicago'
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(at)
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(at).find(x => x.type === 'timeZoneName')?.value
  return fillWords(String(step.words).replace(fix[0], fix[1]), {
    first: j.first, agent: j.agent, day: part({ weekday: 'long' }), time: part({ hour: 'numeric', minute: '2-digit' }), zone,
  })
}

export async function textsRun(store: Store, send: Send | null, limit = 20) {
  if (!send) return { sent: 0, failed: 0, skipped: 'no_twilio' }
  const jobs: TextJob[] = (await store.rpc('reactivation_texts_claim', { p_limit: limit })) ?? []
  let sent = 0, failed = 0
  for (const j of jobs) {
    const body = reactivationTextBody(j)
    if (!body) { await store.rpc('reactivation_text_sent', { p_id: j.id, p_ok: false, p_provider_id: null, p_failure: 'unknown step' }); failed++; continue }
    try {
      const r = await send(j.to, j.from, body)
      await store.rpc('reactivation_text_sent', { p_id: j.id, p_ok: r.ok, p_provider_id: r.id ?? null, p_failure: r.ok ? null : (r.error ?? 'send failed') })
      if (r.ok) sent++; else failed++
    } catch (e) {
      await store.rpc('reactivation_text_sent', { p_id: j.id, p_ok: false, p_provider_id: null, p_failure: String((e as Error)?.message || e).slice(0, 200) })
      failed++
    }
  }
  return { sent, failed, claimed: jobs.length }
}
