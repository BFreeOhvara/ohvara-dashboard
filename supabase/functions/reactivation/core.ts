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
