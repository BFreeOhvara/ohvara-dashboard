/**
 * indeed-scraper Edge Function — v3
 *
 * Calls mcp.indeed.com/claude/mcp (official Indeed MCP endpoint) using
 * INDEED_MCP_TOKEN set in Supabase Edge Function secrets, then JOINS each
 * posting to a Google Places lookup (reusing maps-scraper's getPlaceDetails
 * mechanism) to attach phone + place_id — producing lead-ready records.
 *
 * To get INDEED_MCP_TOKEN:
 *   Option A — Indeed Publisher/Partner API: developer.indeed.com → apply
 *   Option B — Claude.ai integrations page → Settings → Integrations →
 *              Indeed → copy the OAuth token shown there
 *
 * MCP protocol: JSON-RPC 2.0 over HTTPS (Streamable HTTP transport)
 *   POST https://mcp.indeed.com/claude/mcp
 *   Authorization: Bearer <token>
 *
 * The Places join is server-side ON PURPOSE: GOOGLE_MAPS_API_KEY is a
 * Supabase secret and must never reach the browser, so this cannot live in
 * the LeadScraper UI import step.
 *
 * Pure parsing/filtering logic lives in ./parse.ts (Node-unit-tested).
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import { parseMcpText, PROFILE_A_NICHES, type IndeedLead } from './parse.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Admin auth ────────────────────────────────────────────────────────────────
async function requireAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization')
  if (!auth) return false
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: { user } } = await admin.auth.getUser(auth.replace('Bearer ', ''))
  if (!user) return false
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin'
}

// ── Google Places join — phone + place_id per posting ────────────────────────
// Mirrors maps-scraper: Text Search (business + city) → first place_id →
// Place Details (formatted_phone_number). Returns nulls on any miss so a
// posting without a Places match still becomes a (phone-less) lead.
async function placesLookup(
  business: string, city: string, state: string, apiKey: string,
): Promise<{ phone: string | null; place_id: string | null }> {
  try {
    const where = [city, state].filter(Boolean).join(', ')
    const query = encodeURIComponent(`${business} ${where}`.trim())
    const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${apiKey}`
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) })
    const searchData = await searchRes.json()
    const placeId = searchData?.results?.[0]?.place_id as string | undefined
    if (!placeId) return { phone: null, place_id: null }

    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number&key=${apiKey}`
    const detailsRes = await fetch(detailsUrl, { signal: AbortSignal.timeout(5000) })
    const detailsData = await detailsRes.json()
    return {
      phone: detailsData?.result?.formatted_phone_number || null,
      place_id: placeId,
    }
  } catch {
    return { phone: null, place_id: null }
  }
}

// Cap total Places lookups per run to bound latency + Google quota.
const MAX_PLACES_LOOKUPS = 30

// ── Main ──────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    if (!await requireAdmin(req)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { niches = ['HVAC', 'Plumbing', 'Electrical'], location = 'Dallas, TX', maxResults = 20 }
      = await req.json()

    // Clamp requested niches to Profile A only
    const validNiches = niches.filter((n: string) => PROFILE_A_NICHES.includes(n.toLowerCase()))
    const searchNiches = validNiches.length ? validNiches : ['hvac', 'plumbing', 'electrical']

    const mcpToken = Deno.env.get('INDEED_MCP_TOKEN')
    if (!mcpToken) {
      return new Response(JSON.stringify({
        results: [], total: 0, notConfigured: true,
        message: 'INDEED_MCP_TOKEN not set. Add it in Supabase Dashboard → Edge Functions → Secrets. ' +
                 'Get the token from: developer.indeed.com (Publisher API) or your Claude.ai integrations page.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Deduplication check — never re-scrape businesses already in the pipeline.
    // The whole leads table counts: not_interested, booked, and every active
    // status all block re-insertion.
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: existing } = await supabase.from('leads').select('business_name, city')
    const existingKeys = new Set<string>()
    const existingNamesNoCity = new Set<string>()
    for (const l of (existing || []) as { business_name: string; city: string | null }[]) {
      const name = (l.business_name || '').toLowerCase().trim()
      if (!name) continue
      if (l.city) existingKeys.add(`${name}|${l.city.toLowerCase().trim()}`)
      else existingNamesNoCity.add(name)
    }

    const allJobs: IndeedLead[] = []

    for (const niche of searchNiches.slice(0, 5)) {
      try {
        const res = await fetch('https://mcp.indeed.com/claude/mcp', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${mcpToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', method: 'tools/call', id: 1,
            params: {
              name: 'search_jobs',
              arguments: {
                // Search across all allowed office/phone titles, scoped to the niche.
                // parseMcpText + isTitleAllowed enforce the full title list on results.
                search: `receptionist or dispatcher or "office manager" or "front desk" or scheduler or "administrative assistant" or "customer service" or "call center" or bookkeeper ${niche}`,
                location,
                country_code: 'US',
              },
            },
          }),
          signal: AbortSignal.timeout(15_000),
        })

        if (!res.ok) { console.warn(`[indeed] ${niche} → ${res.status}`); continue }
        const data = await res.json()
        // MCP returns text in result.content[0].text OR result (string)
        const text = (data?.result?.content?.[0]?.text) || (typeof data?.result === 'string' ? data.result : '')
        allJobs.push(...parseMcpText(String(text), existingKeys, existingNamesNoCity).slice(0, maxResults))
      } catch (err) {
        console.warn(`[indeed] ${niche} failed:`, err)
      }
    }

    // Deduplicate by company name
    const seen = new Set<string>()
    const unique = allJobs.filter(j => {
      const key = j.business_name.toLowerCase().trim()
      if (seen.has(key)) return false
      seen.add(key); return true
    })

    // ── Places join: attach phone + place_id to fresh leads ──────────────────
    // Only fresh (not already-in-db) leads, capped to bound quota/latency.
    const mapsKey = Deno.env.get('GOOGLE_MAPS_API_KEY')
    if (mapsKey) {
      let used = 0
      for (const job of unique) {
        if (job.already_in_db || used >= MAX_PLACES_LOOKUPS) continue
        used++
        const { phone, place_id } = await placesLookup(job.business_name, job.city, job.state, mapsKey)
        job.phone = phone
        job.place_id = place_id
      }
    } else {
      console.warn('[indeed] GOOGLE_MAPS_API_KEY not set — returning leads without phone/place_id')
    }

    return new Response(JSON.stringify({ results: unique, total: unique.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[indeed-scraper]', msg)
    return new Response(JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
