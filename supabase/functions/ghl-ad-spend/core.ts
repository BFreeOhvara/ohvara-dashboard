// ghl-ad-spend logic (Prompt 858), with the database, key and network passed
// in so tests run without Supabase or GoHighLevel. No Deno APIs, so node
// --test loads it. BUILT, NOT DEPLOYED, SWITCHED OFF.
//
// Daily (cron, x-ohvara-cron), with {"action":"run"}: for each of the last
// DAYS_BACK days (Central time, ending yesterday; Meta keeps attributing for a
// few days, so each day is re-pulled and replaced, never added twice), ask
// GHL's Ad Manager for every Meta campaign's spend, impressions, clicks and
// leads that day, and save them through ghl_ad_spend_save (migration 232):
// campaign list + ad_spend_daily rows, stamped with the agent the campaign is
// mapped to on the Connect page. One Meta campaign per agent, so spend per
// agent = spend per campaign.
//
// Endpoint (GHL API v2, Ad Manager "Get reporting list", Version v3, scope
// adPublishing.readonly, Private Integration token allowed):
//   GET /ad-publishing/facebook/reporting/list?locationId&listType=campaigns
//       &startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&type=AD_MANAGER
// One day per call (start = end), because this endpoint returns one total per
// campaign for the window. GHL marks it deprecated in favour of
// /reporting/rows (Version v4), whose docs were not public when this was
// written: the URL lives in api.ts so swapping is one file.
//
// Does nothing unless ghl_settings.ad_spend_enabled is on (default OFF).
// Feeding the agents' lead-spend ledger (money) is a second switch,
// ad_spend_bills_agents, checked inside the database function. Logs carry
// error text only.
export const DAYS_BACK = 3
export const TZ = 'America/Chicago'

type DbError = { message: string; code?: string } | null
export type Settings = { ad_spend_enabled: boolean; location_id: string | null }
export type SpendRow = {
  campaign_id: string; campaign_name: string | null; fb_campaign_id: string | null; status: string | null
  date: string; spend_cents: number; impressions: number; clicks: number; leads: number
}
export type Report = { ok: true; rows: SpendRow[] } | { ok: false; status: number; error: string }
export type SyncStatus = 'ok' | 'error' | 'off' | 'not_configured'
export type Deps = {
  apiKey: string | undefined
  secrets?(): Promise<{ apiKey?: string | undefined }> // P939: the key saved on the Connect page; wins over apiKey (the env fallback)
  settings(): PromiseLike<{ data: Settings | null; error: DbError }>
  report(key: string, locationId: string, day: string): Promise<Report>
  save(rows: SpendRow[], status: SyncStatus, error: string | null): PromiseLike<{ data: unknown; error: DbError }>
  now(): Date
  log(msg: string): void
}

// YYYY-MM-DD of `d` in Central time.
export function centralDay(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}
// The days to pull: yesterday and the back - 1 days before it, oldest first.
export function daysToPull(now: Date, back = DAYS_BACK) {
  const base = Date.parse(`${centralDay(now)}T12:00:00Z`)
  return Array.from({ length: back }, (_, i) => new Date(base - (back - i) * 864e5).toISOString().slice(0, 10))
}

const num = (v: unknown) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) && n > 0 ? n : 0 }
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null)

// One campaign item from "Get reporting list" → a spend row. Metrics arrive as strings; spend is dollars.
// leads = Meta lead actions (results.lead, else conversions), not GHL's CDP-attributed "leads".
// deno-lint-ignore no-explicit-any
export function toRow(item: any, day: string): SpendRow | null {
  const id = str(item?._id) ?? str(item?.campaignId) ?? str(item?.id)
  if (!id) return null
  const r = item?.results
  const leads = r && typeof r === 'object' && 'lead' in r ? num(r.lead) : num(item?.conversions)
  return {
    campaign_id: id, campaign_name: str(item?.name) ?? str(item?.campaignName), fb_campaign_id: str(item?.fbCampaignId),
    status: str(item?.publishingStatus), date: day,
    spend_cents: Math.round(num(item?.spend) * 100), impressions: Math.round(num(item?.impressions)),
    clicks: Math.round(num(item?.clicks)), leads: Math.round(leads),
  }
}
// deno-lint-ignore no-explicit-any
export function rowsOf(data: any, day: string): SpendRow[] {
  const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : Array.isArray(data?.data) ? data.data : []
  return items.map((x: unknown) => toRow(x, day)).filter((x: SpendRow | null): x is SpendRow => !!x)
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export async function run(deps: Deps): Promise<Record<string, unknown>> {
  const { data: st, error } = await deps.settings()
  if (error) { deps.log(`[ghl-ad-spend] settings ${error.message}`); return { error: 'settings' } }
  if (!st?.ad_spend_enabled) return { skipped: 'off' }
  if (deps.secrets) deps = { ...deps, apiKey: (await deps.secrets()).apiKey || deps.apiKey }
  if (!deps.apiKey || !st.location_id) {
    await deps.save([], 'not_configured', !deps.apiKey ? 'GHL is not connected: no API key saved on the Connect page' : 'No location ID on the Connect page')
    return { skipped: 'not_configured' }
  }
  const rows: SpendRow[] = []
  const days = daysToPull(deps.now())
  for (const day of days) {
    const r = await deps.report(deps.apiKey, st.location_id, day)
    if (!r.ok) {
      const why = (r.status === 401 || r.status === 403 ? 'GHL refused the key (it needs adPublishing.readonly)' : `GHL ${r.status}: ${r.error}`).slice(0, 300)
      deps.log(`[ghl-ad-spend] ${day} ${why}`)
      // Keep the days that came back; the next run re-pulls the missed one.
      await deps.save(rows, 'error', why)
      return { error: why, days, rows: rows.length }
    }
    rows.push(...r.rows)
  }
  const saved = await deps.save(rows, 'ok', null)
  if (saved.error) { deps.log(`[ghl-ad-spend] save ${saved.error.message}`); return { error: 'save' } }
  return { ok: true, days, rows: rows.length, saved: saved.data }
}

export async function handle(req: Request, deps: Deps & { isCron(req: Request): Promise<boolean> }): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!(await deps.isCron(req))) return new Response('Unauthorized', { status: 401 })
  let body: { action?: string } = {}
  try { body = await req.json() } catch { body = {} }
  if (body.action !== 'run') return json({ error: 'unknown action' }, 400)
  const out = await run(deps)
  return json(out, out.error === 'settings' || out.error === 'save' ? 500 : 200)
}
