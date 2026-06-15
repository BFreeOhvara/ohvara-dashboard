/**
 * indeed-scraper — pure parsing logic
 *
 * Kept free of Deno globals and supabase imports so it can be unit-tested
 * with Node (`node --test parse.test.ts`). index.ts imports from here and
 * layers on auth, the supabase client, and the Google Places join.
 */

// ── Allowed job titles (only these pass through) ─────────────────────────────
// 'customer service' intentionally matches "Customer Service Representative", etc.
// Titles map to the stack products (review gen, lead follow-up, reminders,
// AI dispatcher, SMS reactivation) — see index history.
export const ALLOWED_JOB_TITLES = [
  'receptionist', 'dispatcher', 'office manager', 'administrative assistant',
  'customer service', 'front desk', 'scheduler', 'answering service',
  'call center', 'phone support', 'office coordinator', 'bookkeeper',
  'customer support',
  'marketing assistant', 'social media coordinator', 'reputation manager',
  'lead coordinator', 'sales support',
  'appointment coordinator', 'scheduling coordinator', 'job coordinator',
  'booking coordinator',
  'logistics coordinator', 'route coordinator', 'operations coordinator',
  'estimator assistant',
  'customer retention', 'outreach coordinator',
]

export function isTitleAllowed(title: string): boolean {
  const lower = title.toLowerCase()
  return ALLOWED_JOB_TITLES.some(t => lower.includes(t))
}

// ── Profile A niches — the only verticals we sell into ───────────────────────
export const PROFILE_A_NICHES = [
  'roofing', 'hvac', 'electrical', 'landscaping', 'concrete',
  'pressure washing', 'hotshot trucking', 'towing', 'oilfield',
  'transportation', 'plumbing', 'pest control', 'pool service',
]

// ── Niche detection from company + job title ─────────────────────────────────
// Keyword order matters: more specific keywords ('hotshot', 'tow') must be
// checked before generic ones ('truck'). All values are Profile A niches.
export const NICHE_KEYWORDS: Record<string, string> = {
  'hvac': 'hvac', 'air conditioning': 'hvac', 'heating': 'hvac', 'cooling': 'hvac',
  'plumb': 'plumbing', 'electric': 'electrical', 'roof': 'roofing',
  'landscap': 'landscaping', 'lawn': 'landscaping',
  'concrete': 'concrete',
  'pressure wash': 'pressure washing', 'power wash': 'pressure washing',
  'hotshot': 'hotshot trucking', 'hot shot': 'hotshot trucking',
  'tow': 'towing',
  'oilfield': 'oilfield', 'oil field': 'oilfield',
  'truck': 'transportation', 'freight': 'transportation',
  'logistic': 'transportation', 'transport': 'transportation',
  'pest': 'pest control', 'pool': 'pool service',
}

export function detectNiche(text: string): string {
  const lower = text.toLowerCase()
  for (const [keyword, niche] of Object.entries(NICHE_KEYWORDS)) {
    if (lower.includes(keyword)) return niche
  }
  return 'other'
}

// ── Parse hourly/annual salary text → hourly range ───────────────────────────
export function parseSalary(comp: string | null): { min: number | null; max: number | null } {
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

// A lead-ready record. Field names match the `leads` table columns so the
// LeadScraper import can insert it directly (after the Places join fills
// phone + place_id). Display-only extras (already_in_db, compensation,
// hourly_*) are stripped at import by toLeadRow().
export interface IndeedLead {
  business_name:      string
  job_title:          string
  posting_title:      string
  posting_snippet:    string | null
  source_url:         string
  location:           string
  city:               string
  state:              string
  niche:              string
  compensation:       string | null
  hourly_min:         number | null
  hourly_max:         number | null
  monthly_labor_cost: number | null
  source:             'indeed'
  status:             'New'
  phone:              string | null
  place_id:           string | null
  already_in_db:      boolean
}

// Deduplication check — never re-scrape businesses already in the pipeline.
// Match on business_name + city (case-insensitive). Rows without a city in
// the DB fall back to a name-only match.
export function isAlreadyInDb(
  company: string, city: string,
  existingKeys: Set<string>, existingNamesNoCity: Set<string>,
): boolean {
  const name = company.toLowerCase().trim()
  return existingKeys.has(`${name}|${(city || '').toLowerCase().trim()}`)
    || existingNamesNoCity.has(name)
}

// Truncate a description to a tidy snippet for the rep's opener.
function toSnippet(raw: string | null): string | null {
  if (!raw) return null
  const clean = raw.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  return clean.length > 280 ? clean.slice(0, 277).trimEnd() + '…' : clean
}

// ── Parse the markdown text returned by the MCP search_jobs tool ─────────────
export function parseMcpText(
  text: string,
  existingKeys: Set<string>, existingNamesNoCity: Set<string>,
): IndeedLead[] {
  const jobs: IndeedLead[] = []
  const blocks = text.split(/\n\s*\n/).filter(b => b.includes('**Job Title:**'))

  for (const block of blocks) {
    const get = (label: string) => {
      const m = block.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]+)`))
      return m ? m[1].trim() : null
    }
    // Description/snippet may wrap multiple lines — capture up to the next
    // **Label:** or the end of the block.
    const getBlock = (labels: string) => {
      const m = block.match(new RegExp(`\\*\\*(?:${labels}):\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*|$)`, 'i'))
      return m ? m[1].trim() : null
    }

    const company  = get('Company')
    const title    = get('Job Title')
    const location = get('Location')
    const comp     = get('Compensation')
    const jobUrl   = get('View Job URL')
    const snippet  = toSnippet(getBlock('Description|Snippet|Summary|Job Description'))
    if (!company || !location) continue

    const locParts  = location.split(',').map((s: string) => s.trim())
    const city      = locParts[0] || location
    const state     = locParts[1] || 'TX'
    const salary    = parseSalary(comp)
    const monthly   = salary.min !== null && salary.max !== null
      ? Math.round(((salary.min + salary.max) / 2) * 160) : null

    const jobTitle = title || 'Dispatcher/Receptionist'
    if (!isTitleAllowed(jobTitle)) continue

    const niche = detectNiche((company || '') + ' ' + jobTitle)
    if (!PROFILE_A_NICHES.includes(niche)) continue

    jobs.push({
      business_name: company,
      job_title: jobTitle,
      posting_title: title || jobTitle,
      posting_snippet: snippet,
      source_url: jobUrl || '',
      location, city, state,
      compensation: comp, hourly_min: salary.min, hourly_max: salary.max,
      monthly_labor_cost: monthly,
      niche,
      source: 'indeed',
      status: 'New',
      phone: null,
      place_id: null,
      already_in_db: isAlreadyInDb(company, city, existingKeys, existingNamesNoCity),
    })
  }
  return jobs
}
