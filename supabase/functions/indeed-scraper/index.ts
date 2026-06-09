/**
 * indeed-scraper Edge Function — v2
 *
 * Calls mcp.indeed.com/claude/mcp (official Indeed MCP endpoint) using
 * INDEED_MCP_TOKEN set in Supabase Edge Function secrets.
 *
 * To get INDEED_MCP_TOKEN:
 *   Option A — Indeed Publisher API: developer.indeed.com → apply for access
 *   Option B — Claude.ai integrations page → Settings → Integrations →
 *              Indeed → copy the OAuth token shown there
 *
 * MCP protocol: JSON-RPC 2.0 over HTTPS (Streamable HTTP transport)
 *   POST https://mcp.indeed.com/claude/mcp
 *   Authorization: Bearer <token>
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Niche detection from company + job title ─────────────────────────────────
const NICHE_KEYWORDS: Record<string, string> = {
  'hvac': 'hvac', 'air conditioning': 'hvac', 'heating': 'hvac', 'cooling': 'hvac',
  'plumb': 'plumbing', 'electric': 'electrical', 'roof': 'roofing',
  'landscap': 'landscaping', 'tow': 'tow truck', 'truck': 'trucking',
  'pest': 'pest control', 'pool': 'pool service',
}

function detectNiche(text: string): string {
  const lower = text.toLowerCase()
  for (const [keyword, niche] of Object.entries(NICHE_KEYWORDS)) {
    if (lower.includes(keyword)) return niche
  }
  return 'other'
}

// ── Parse hourly/annual salary text → hourly range ───────────────────────────
function parseSalary(comp: string | null): { min: number | null; max: number | null } {
  if (!comp) return { min: null, max: null }
  const clean = comp.replace(/,/g, '').toLowerCase()
  const hrRange = clean.match(/\$(\d+(?:\.\d+)?)\s*[-–]\s*\$(\d+(?:\.\d+)?)\s*(?:an hour|\/hr)/i)
  if (hrRange) return { min: parseFloat(hrRange[1]), max: parseFloat(hrRange[2]) }
  const hrSingle = clean.match(/\$(\d+(?:\.\d+)?)\s*(?:an hour|\/hr)/i)
  if (hrSingle) { const v = parseFloat(hrSingle[1]); return { min: v, max: v } }
  const yrRange = clean.match(/\$(\d+(?:\.\d+)?)\s*[-–]\s*\$(\d+(?:\.\d+)?)\s*(?:a year|\/yr)/i)
  if (yrRange) return {
    min: Math.round(parseFloat(yrRange[1]) / 2080 * 100) / 100,
    max: Math.round(parseFloat(yrRange[2]) / 2080 * 100) / 100,
  }
  const yrSingle = clean.match(/\$(\d+(?:\.\d+)?)\s*(?:a year|\/yr)/i)
  if (yrSingle) {
    const v = Math.round(parseFloat(yrSingle[1]) / 2080 * 100) / 100
    return { min: v, max: v }
  }
  return { min: null, max: null }
}

// ── Parse the markdown text returned by the MCP tool ────────────────────────
interface JobResult {
  company: string; title: string; location: string
  city: string; state: string; compensation: string | null
  hourly_min: number | null; hourly_max: number | null
  monthly_labor_cost: number | null; job_url: string; niche: string
  already_in_db: boolean
}

function parseMcpText(text: string, existingNames: Set<string>): JobResult[] {
  const jobs: JobResult[] = []
  const blocks = text.split(/\n\s*\n/).filter(b => b.includes('**Job Title:**'))

  for (const block of blocks) {
    const get = (label: string) => {
      const m = block.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]+)`))
      return m ? m[1].trim() : null
    }
    const company  = get('Company')
    const title    = get('Job Title')
    const location = get('Location')
    const comp     = get('Compensation')
    const jobUrl   = get('View Job URL')
    if (!company || !location) continue

    const locParts  = location.split(',').map((s: string) => s.trim())
    const city      = locParts[0] || location
    const state     = locParts[1] || 'TX'
    const salary    = parseSalary(comp)
    const monthly   = salary.min !== null && salary.max !== null
      ? Math.round(((salary.min + salary.max) / 2) * 160) : null

    jobs.push({
      company, title: title || 'Dispatcher/Receptionist', location, city, state,
      compensation: comp, hourly_min: salary.min, hourly_max: salary.max,
      monthly_labor_cost: monthly, job_url: jobUrl || '',
      niche: detectNiche((company || '') + ' ' + (title || '')),
      already_in_db: existingNames.has(company.toLowerCase().trim()),
    })
  }
  return jobs
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

    const mcpToken = Deno.env.get('INDEED_MCP_TOKEN')
    if (!mcpToken) {
      return new Response(JSON.stringify({
        results: [], total: 0, notConfigured: true,
        message: 'INDEED_MCP_TOKEN not set. Add it in Supabase Dashboard → Edge Functions → Secrets. ' +
                 'Get the token from: developer.indeed.com (Publisher API) or your Claude.ai integrations page.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: existing } = await supabase.from('leads').select('business_name')
    const existingNames = new Set((existing || []).map((l: { business_name: string }) =>
      l.business_name.toLowerCase().trim()))

    const allJobs: JobResult[] = []

    for (const niche of niches.slice(0, 5)) {
      try {
        const res = await fetch('https://mcp.indeed.com/claude/mcp', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${mcpToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', method: 'tools/call', id: 1,
            params: { name: 'search_jobs', arguments: { search: `receptionist dispatcher ${niche}`, location, country_code: 'US' } },
          }),
          signal: AbortSignal.timeout(15_000),
        })

        if (!res.ok) { console.warn(`[indeed] ${niche} → ${res.status}`); continue }
        const data = await res.json()
        // MCP returns text in result.content[0].text OR result (string)
        const text = (data?.result?.content?.[0]?.text) || (typeof data?.result === 'string' ? data.result : '')
        allJobs.push(...parseMcpText(String(text), existingNames).slice(0, maxResults))
      } catch (err) {
        console.warn(`[indeed] ${niche} failed:`, err)
      }
    }

    // Deduplicate by company name
    const seen = new Set<string>()
    const unique = allJobs.filter(j => {
      const key = j.company.toLowerCase().trim()
      if (seen.has(key)) return false
      seen.add(key); return true
    })

    return new Response(JSON.stringify({ results: unique, total: unique.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[indeed-scraper]', msg)
    return new Response(JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
