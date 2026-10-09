import { createClient } from 'npm:@supabase/supabase-js'
import Anthropic from 'npm:@anthropic-ai/sdk'

// Prompt 728 — a carrier's policyholder service hours, so Book a call only
// offers times the carrier the client is leaving is open (the Fulfillment
// call is a 3-way call with that carrier).
//
// POST { carrier_id } or { name }, plus admin-only { force: true } ("Look up
// again") and { model } (lookup quality checks).
//   1. Cached: the row has hours checked under 180 days ago -> returned as is.
//   2. Otherwise one live lookup, claimed on the row (hours_lookup_at) so two
//      agents picking the same new carrier at once trigger one lookup; the
//      second caller waits for the first and gets its answer.
//   3. The lookup asks Claude, with the web search tool, for the carrier's
//      existing-policyholder line for individual life insurance: phone, open
//      and close per weekday, time zone and the page it read them on. The
//      answer is validated; anything that fails (20 s timeout, no answer, bad
//      zone or times) saves Mon–Fri 9–5 ET as 'fallback' so booking is never
//      blocked, and the carrier shows on the admin list to fix.
//
// Not stubbed by DEMO_MODE on purpose: a stubbed answer would put fake hours
// in the cache. CARRIER_LOOKUP_LIVE=false switches the live lookup off, which
// behaves as "lookup failed". Secrets: ANTHROPIC_API_KEY (never logged).
//
// Migration 133: app_settings.carrier_lookup_live gates the lookup for AGENTS
// (off until Brayden has checked lookup quality from the admin Carrier hours
// page; admins always look up). While it's off, an agent's pick of a carrier
// with no hours gets Mon–Fri 9–5 ET back for that booking, not saved, so the
// carrier is still looked up once the switch is on. A saved 'fallback' is
// only trusted for FALLBACK_DAYS, then looked up again.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const CACHE_DAYS = 180
const FALLBACK_DAYS = 7
const LOOKUP_MS = 20_000
const CLAIM_STALE_MS = 90_000
const DEFAULT_MODEL = Deno.env.get('CARRIER_LOOKUP_MODEL') || 'claude-haiku-5-5'
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5']
const LIVE = (Deno.env.get('CARRIER_LOOKUP_LIVE') ?? 'true').toLowerCase() !== 'false'

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
type Day = typeof DAYS[number]
type Hours = Record<Day, { open: string; close: string } | null>

const FALLBACK: { hours: Hours; tz: string } = {
  tz: 'America/New_York',
  hours: {
    mon: { open: '09:00', close: '17:00' }, tue: { open: '09:00', close: '17:00' }, wed: { open: '09:00', close: '17:00' },
    thu: { open: '09:00', close: '17:00' }, fri: { open: '09:00', close: '17:00' }, sat: null, sun: null,
  },
}

// US zones only. Abbreviations are mapped, anything else fails validation.
const US_ZONES = new Set([
  'America/New_York', 'America/Detroit', 'America/Indiana/Indianapolis', 'America/Kentucky/Louisville',
  'America/Chicago', 'America/Denver', 'America/Boise', 'America/Phoenix', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu', 'America/Puerto_Rico',
])
const ZONE_ALIASES: Record<string, string> = {
  ET: 'America/New_York', EST: 'America/New_York', EDT: 'America/New_York', EASTERN: 'America/New_York',
  CT: 'America/Chicago', CST: 'America/Chicago', CDT: 'America/Chicago', CENTRAL: 'America/Chicago',
  MT: 'America/Denver', MST: 'America/Denver', MDT: 'America/Denver', MOUNTAIN: 'America/Denver',
  PT: 'America/Los_Angeles', PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles', PACIFIC: 'America/Los_Angeles',
}

const FIELDS = 'id, name, aliases, service_phone, hours, hours_tz, hours_source_url, hours_status, hours_checked_at, hours_lookup_at, sort_rank'

const REPORT_TOOL = {
  name: 'report_hours',
  description: 'Report the carrier\'s customer service line for existing individual life insurance policyholders. Call this exactly once, at the end.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['found', 'phone', 'time_zone', 'open_days', 'source_url', 'note'],
    properties: {
      found: { type: 'boolean', description: 'true only if a page stated the hours of this line.' },
      phone: { type: 'string', description: 'The service phone number, or "" if none was found.' },
      time_zone: { type: 'string', description: 'IANA zone the hours are in, e.g. America/Chicago. "" if not found.' },
      open_days: {
        type: 'array',
        description: 'One entry per day the line is open. Leave out closed days.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['day', 'open', 'close'],
          properties: {
            day: { type: 'string', enum: [...DAYS] },
            open: { type: 'string', description: '24-hour HH:MM, e.g. 08:30' },
            close: { type: 'string', description: '24-hour HH:MM, e.g. 17:00' },
          },
        },
      },
      source_url: { type: 'string', description: 'The URL of the page the hours were read on.' },
      note: { type: 'string', description: 'One short line: which line/department this is, or why nothing was found.' },
    },
  },
} as const

const SYSTEM = `You look up US life insurance carriers' customer service hours for a booking tool.

Find the phone line an EXISTING policyholder of an INDIVIDUAL life insurance policy calls to service or cancel their policy (often called customer service, policyholder service, policy service, or life insurance service). Not the new-business, agent/producer, annuity-only, group/employer, claims-only or sales line, unless the carrier lists only one line for everyone.

Search the web, preferring the carrier's own contact page. Read the hours exactly as published. If the page gives the hours without a time zone, use the zone of the carrier's service center or headquarters and say so in the note. Times are 24-hour HH:MM. Closed days are left out.

Finish by calling report_hours once. If you cannot find published hours for that line, call report_hours with found=false. Never guess hours.`

function hhmm(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim())
  if (!m) return null
  const h = +m[1], min = +m[2]
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null
  return h * 60 + min
}
const pad = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

// The model's answer -> { hours, tz, phone, url } or an error string.
function validate(a: any): { hours: Hours; tz: string; phone: string | null; url: string; note: string } | string {
  if (!a || a.found !== true) return `not found${a?.note ? `: ${a.note}` : ''}`
  const rawTz = String(a.time_zone || '').trim()
  const tz = US_ZONES.has(rawTz) ? rawTz : ZONE_ALIASES[rawTz.toUpperCase()]
  if (!tz) return `bad time zone "${rawTz}"`
  const hours = Object.fromEntries(DAYS.map(d => [d, null])) as Hours
  for (const e of a.open_days || []) {
    const o = hhmm(e?.open), c = hhmm(e?.close)
    if (!DAYS.includes(e?.day) || o == null || c == null) return `bad times for ${e?.day}`
    if (c <= o) return `close before open on ${e.day}`
    hours[e.day as Day] = { open: pad(o), close: pad(c) }
  }
  if (!['mon', 'tue', 'wed', 'thu', 'fri'].some(d => hours[d as Day])) return 'no weekday open'
  const url = String(a.source_url || '').trim()
  if (!/^https?:\/\/\S+\.\S+/.test(url)) return 'no source URL'
  const phone = String(a.phone || '').trim() || null
  return { hours, tz, phone, url, note: String(a.note || '') }
}

async function lookup(name: string, aliases: string[], model: string) {
  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!LIVE) return { error: 'live lookup is off (CARRIER_LOOKUP_LIVE=false)' }
  if (!key) return { error: 'ANTHROPIC_API_KEY is not set' }

  const client = new Anthropic({ apiKey: key, maxRetries: 0 })
  const signal = AbortSignal.timeout(LOOKUP_MS)
  // Dynamic-filtering web search is for Sonnet; Haiku takes the basic tool.
  const search = model.startsWith('claude-haiku')
    ? { type: 'web_search_20250305', name: 'web_search', max_uses: 4 }
    : { type: 'web_search_20260209', name: 'web_search', max_uses: 4 }
  const aka = aliases.length ? ` (also known as: ${aliases.slice(0, 6).join(', ')})` : ''
  const messages: any[] = [{
    role: 'user',
    content: `Carrier: ${name}${aka}. Find its existing-policyholder customer service line for individual life insurance and report it.`,
  }]
  const usage = { input_tokens: 0, output_tokens: 0, web_search_requests: 0 }

  try {
    // pause_turn: the server-side search loop paused; send the turn back to resume.
    for (let i = 0; i < 4; i++) {
      const res: any = await client.messages.create({
        model,
        max_tokens: 4000,
        system: SYSTEM,
        tools: [search, REPORT_TOOL] as any,
        tool_choice: { type: 'auto' },
        output_config: { effort: 'low' },
        messages,
      } as any, { signal })
      usage.input_tokens += res.usage?.input_tokens || 0
      usage.output_tokens += res.usage?.output_tokens || 0
      usage.web_search_requests += res.usage?.server_tool_use?.web_search_requests || 0

      const call = (res.content || []).find((b: any) => b.type === 'tool_use' && b.name === 'report_hours')
      if (call) return { answer: call.input, usage, model }
      if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue }
      if (res.stop_reason === 'refusal') return { error: 'refused', usage, model }
      return { error: `no report (stop: ${res.stop_reason})`, usage, model }
    }
    return { error: 'search did not finish', usage, model }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { error: signal.aborted ? 'timed out after 20 s' : `API error: ${msg.slice(0, 200)}`, usage, model }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '')
  const { data: { user } } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } }
  if (!user) return json({ error: 'Sign in first' }, 401)
  const { data: me } = await admin.from('profiles').select('role, is_active').eq('id', user.id).maybeSingle()
  if (!me?.is_active || !['agent', 'admin'].includes(me.role)) return json({ error: 'Agents and admins only' }, 403)
  const isAdmin = me.role === 'admin'

  let body: any = {}
  try { body = await req.json() } catch { /* empty */ }
  const force = isAdmin && body.force === true
  const model = isAdmin && MODELS.includes(body.model) ? body.model : DEFAULT_MODEL

  // Find the row (by id, or by name / alias; a new name is added as pending).
  let row: any = null
  if (body.carrier_id) {
    const { data } = await admin.from('carriers').select(FIELDS).eq('id', body.carrier_id).maybeSingle()
    row = data
  } else if (typeof body.name === 'string' && body.name.trim().length >= 2) {
    const name = body.name.trim().replace(/\s+/g, ' ').slice(0, 80)
    const { data: all } = await admin.from('carriers').select(FIELDS)
    const low = name.toLowerCase()
    row = (all || []).find((c: any) => c.name.toLowerCase() === low)
      || (all || []).find((c: any) => (c.aliases || []).some((a: string) => a.toLowerCase() === low))
    if (!row) {
      const { data } = await admin.from('carriers').insert({ name, is_active: true, hours_status: 'pending' }).select(FIELDS).single()
      row = data
    }
  }
  if (!row) return json({ error: 'Carrier not found' }, 404)

  const maxDays = row.hours_status === 'fallback' ? FALLBACK_DAYS : CACHE_DAYS
  const fresh = row.hours && row.hours_checked_at && Date.now() - new Date(row.hours_checked_at).getTime() < maxDays * 864e5
  if (fresh && !force) return json({ carrier: strip(row), cached: true })

  // Agents only trigger the live lookup once an admin has switched it on.
  if (!isAdmin) {
    const { data: settings } = await admin.from('app_settings').select('carrier_lookup_live').eq('id', 1).maybeSingle()
    if (!settings?.carrier_lookup_live) {
      const carrier = row.hours ? strip(row) : { ...strip(row), hours: FALLBACK.hours, hours_tz: FALLBACK.tz, hours_status: 'fallback' }
      return json({ carrier, lookup_off: true })
    }
  }

  // Claim the lookup. Someone else holding a recent claim -> wait for theirs.
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS).toISOString()
  const { data: claimed } = await admin.from('carriers')
    .update({ hours_lookup_at: new Date().toISOString(), ...(row.hours ? {} : { hours_status: 'pending' }) })
    .eq('id', row.id)
    .or(`hours_lookup_at.is.null,hours_lookup_at.lt.${staleBefore}`)
    .select(FIELDS)
  if (!claimed?.length) {
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 1000))
      const { data } = await admin.from('carriers').select(FIELDS).eq('id', row.id).single()
      if (data && !data.hours_lookup_at) return json({ carrier: strip(data), waited: true })
    }
    const { data } = await admin.from('carriers').select(FIELDS).eq('id', row.id).single()
    return json({ carrier: strip(data), waited: true, still_checking: true })
  }

  const result: any = await lookup(row.name, row.aliases || [], model)
  const checked = result.answer ? validate(result.answer) : (result.error as string)
  const now = new Date().toISOString()
  let update: Record<string, unknown>
  let error: string | null = null
  if (typeof checked !== 'string') {
    update = {
      hours: checked.hours, hours_tz: checked.tz, hours_source_url: checked.url, hours_status: 'ai',
      hours_checked_at: now, hours_lookup_at: null, ...(checked.phone ? { service_phone: checked.phone } : {}),
    }
  } else if (row.hours) {
    // Already had hours (stale cache or an admin re-check): keep them.
    error = checked
    update = { hours_lookup_at: null }
  } else {
    error = checked
    update = {
      hours: FALLBACK.hours, hours_tz: FALLBACK.tz, hours_source_url: null, hours_status: 'fallback',
      hours_checked_at: now, hours_lookup_at: null,
    }
  }
  const { data: saved, error: saveErr } = await admin.from('carriers').update(update).eq('id', row.id).select(FIELDS).single()
  if (saveErr) return json({ error: saveErr.message }, 500)
  return json({
    carrier: strip(saved), looked_up: true, error,
    ...(isAdmin ? { model: result.model, usage: result.usage, note: typeof checked === 'string' ? null : checked.note, raw: result.answer ?? null } : {}),
  })
})

function strip(c: any) {
  if (!c) return c
  const { hours_lookup_at, ...rest } = c
  return { ...rest, checking: !!hours_lookup_at }
}
