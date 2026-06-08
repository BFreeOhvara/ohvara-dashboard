/**
 * indeed-scraper Edge Function
 *
 * Searches Indeed for businesses hiring receptionists / dispatchers in target niches.
 * Parses salary from job listings to calculate monthly_labor_cost.
 * Returns results with deduplication flags (already_in_db).
 *
 * Called from Admin → Lead Scraper → Indeed tab.
 *
 * Body params:
 *   niches:       string[]  — e.g. ["HVAC", "Plumbing"]
 *   location:     string    — e.g. "Dallas, TX"
 *   minHourlyPay: number    — minimum hourly pay filter (default 12)
 *   maxResults:   number    — max results per niche (default 20)
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SEARCH_TERMS = ['receptionist', 'dispatcher', 'front desk', 'office manager']

function parseSalary(text: string): { min: number; max: number } | null {
  if (!text) return null
  const clean = text.replace(/,/g, '').toLowerCase()

  // Hourly range: "$15 - $20 an hour"
  const hrRange = clean.match(/\$(\d+(?:\.\d+)?)\s*[-–]\s*\$(\d+(?:\.\d+)?)\s*(an hour|\/hr|hour)/i)
  if (hrRange) return { min: parseFloat(hrRange[1]), max: parseFloat(hrRange[2]) }

  // Hourly single
  const hrSingle = clean.match(/\$(\d+(?:\.\d+)?)\s*(an hour|\/hr|hour)/i)
  if (hrSingle) { const v = parseFloat(hrSingle[1]); return { min: v, max: v } }

  // Annual range → convert to hourly
  const yrRange = clean.match(/\$(\d+(?:\.\d+)?)\s*[-–]\s*\$(\d+(?:\.\d+)?)\s*(a year|\/yr|year)/i)
  if (yrRange) {
    return {
      min: Math.round(parseFloat(yrRange[1]) / 2080 * 100) / 100,
      max: Math.round(parseFloat(yrRange[2]) / 2080 * 100) / 100,
    }
  }

  // Annual single
  const yrSingle = clean.match(/\$(\d+(?:\.\d+)?)\s*(a year|\/yr|year)/i)
  if (yrSingle) {
    const v = Math.round(parseFloat(yrSingle[1]) / 2080 * 100) / 100
    return { min: v, max: v }
  }

  return null
}

function calcMonthlyCost(salary: { min: number; max: number } | null): number | null {
  if (!salary) return null
  return Math.round(((salary.min + salary.max) / 2) * 160)
}

// Parse Indeed HTML to extract job cards
function parseIndeedHtml(html: string): Array<{
  company: string
  title: string
  location: string
  salary: string
  jobKey: string
}> {
  const results: Array<{ company: string; title: string; location: string; salary: string; jobKey: string }> = []

  // Extract job cards via regex (Indeed renders server-side HTML)
  const cardMatches = html.matchAll(/<div[^>]+data-jk="([^"]+)"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g)

  for (const match of cardMatches) {
    const jobKey  = match[1]
    const content = match[2]

    // Company name
    const companyMatch = content.match(/data-testid="company-name"[^>]*>([^<]+)</i)
      || content.match(/class="[^"]*companyName[^"]*"[^>]*>([^<]+)</i)
    const company = companyMatch?.[1]?.trim().replace(/&amp;/g, '&') || ''

    // Job title
    const titleMatch = content.match(/data-testid="jobTitle"[^>]*>[^>]*>([^<]+)</i)
      || content.match(/class="[^"]*jobTitle[^"]*"[^>]*>[^>]*>([^<]+)</i)
    const title = titleMatch?.[1]?.trim() || ''

    // Location
    const locMatch = content.match(/data-testid="text-location"[^>]*>([^<]+)</i)
      || content.match(/class="[^"]*companyLocation[^"]*"[^>]*>([^<]+)</i)
    const location = locMatch?.[1]?.trim() || ''

    // Salary
    const salaryMatch = content.match(/class="[^"]*salary-snippet[^"]*"[^>]*>([^<]+)</i)
      || content.match(/aria-label="[^"]*\$[^"]*"/)
    const salary = salaryMatch?.[1]?.trim() || ''

    if (company && jobKey) {
      results.push({ company, title, location, salary, jobKey })
    }
  }

  // Fallback: try JSON data embedded in page
  if (results.length === 0) {
    const jsonMatch = html.match(/"jobKeysWithInfo":\{([^}]+)\}/)
    if (!jsonMatch) {
      // Try window._initialData
      const initMatch = html.match(/window\._initialData\s*=\s*(\{.+?\});\s*<\/script>/s)
      if (initMatch) {
        try {
          const data = JSON.parse(initMatch[1])
          const jobs = data?.metaData?.mosaicProviderJobCardsModel?.results || []
          for (const job of jobs) {
            results.push({
              company: job.company || '',
              title:   job.title   || '',
              location: job.jobLocationCity ? `${job.jobLocationCity}, ${job.jobLocationState}` : '',
              salary:  job.salarySnippet?.salaryTextFormatted || '',
              jobKey:  job.jobkey || '',
            })
          }
        } catch { /* ignore parse errors */ }
      }
    }
  }

  return results
}

async function requireAdmin(req: Request): Promise<boolean> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return false
  const jwt = authHeader.replace('Bearer ', '')
  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { data: { user } } = await adminClient.auth.getUser(jwt)
  if (!user) return false
  const { data: profile } = await adminClient.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const isAdmin = await requireAdmin(req)
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { niches = ['HVAC'], location = 'Dallas, TX', minHourlyPay = 12, maxResults = 20 } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const allResults: Record<string, unknown>[] = []

    for (const niche of niches) {
      for (const term of SEARCH_TERMS) {
        const query    = encodeURIComponent(`${term} ${niche}`)
        const loc      = encodeURIComponent(location)
        const url      = `https://www.indeed.com/jobs?q=${query}&l=${loc}&fromage=14&sort=date`

        let html = ''
        try {
          const res = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5',
            },
            signal: AbortSignal.timeout(8000),
          })
          html = await res.text()
        } catch {
          continue // skip this term on fetch error
        }

        const jobs = parseIndeedHtml(html)

        for (const job of jobs.slice(0, maxResults)) {
          if (!job.company) continue

          const salary   = parseSalary(job.salary)
          const monthly  = calcMonthlyCost(salary)

          // Skip if below min pay
          if (salary && salary.min < minHourlyPay) continue

          // Dedup check
          const { data: existing } = await supabase
            .from('leads')
            .select('id')
            .ilike('business_name', `%${job.company.slice(0, 30)}%`)
            .limit(1)

          const cityMatch = (job.location || location).match(/^([^,]+)/)
          const city = cityMatch?.[1]?.trim() || location

          allResults.push({
            business_name:      job.company,
            niche,
            city,
            job_title:          job.title,
            monthly_labor_cost: monthly,
            hourly_min:         salary?.min ?? null,
            hourly_max:         salary?.max ?? null,
            source:             'indeed',
            status:             'New',
            notes:              monthly
              ? `Hiring: ${job.title}. Est. monthly labor cost $${monthly.toLocaleString()}.`
              : `Hiring: ${job.title}. No salary listed.`,
            already_in_db: !!(existing && existing.length > 0),
          })
        }
      }
    }

    // Deduplicate by business_name within results
    const seen = new Set<string>()
    const unique = allResults.filter(r => {
      const key = String(r.business_name).toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    return new Response(JSON.stringify({ results: unique, total: unique.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
