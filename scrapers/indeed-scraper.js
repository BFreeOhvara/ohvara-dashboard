/**
 * indeed-scraper.js
 * Searches Indeed for businesses hiring receptionists / dispatchers / front-desk staff
 * in target niches, calculates monthly_labor_cost, and inserts leads into Supabase.
 *
 * Usage:
 *   node scrapers/indeed-scraper.js
 *
 * Environment (set in .env.local or shell):
 *   SUPABASE_URL          – your project URL
 *   SUPABASE_SERVICE_ROLE – service-role key (never exposed to client)
 *
 * Dependencies: playwright, @supabase/supabase-js
 *   npm install playwright @supabase/supabase-js
 *   npx playwright install chromium
 */

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env.local') })

const SUPABASE_URL  = process.env.SUPABASE_URL
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SEARCH_QUERIES = [
  // title → niche mapping
  { query: 'receptionist HVAC', niche: 'HVAC' },
  { query: 'dispatcher HVAC',   niche: 'HVAC' },
  { query: 'receptionist plumbing', niche: 'Plumbing' },
  { query: 'dispatcher plumbing',   niche: 'Plumbing' },
  { query: 'receptionist roofing',  niche: 'Roofing' },
  { query: 'receptionist landscaping', niche: 'Landscaping' },
  { query: 'front desk dental',        niche: 'Dental' },
  { query: 'receptionist law firm',    niche: 'Legal' },
  { query: 'receptionist auto repair', niche: 'Auto Repair' },
  { query: 'dispatcher pest control',  niche: 'Pest Control' },
  { query: 'receptionist physical therapy', niche: 'Physical Therapy' },
  { query: 'receptionist chiropractic',     niche: 'Chiropractic' },
  { query: 'dispatcher electrical contractor', niche: 'Electrical' },
]

const LOCATIONS = [
  'Dallas, TX',
  'Houston, TX',
  'San Antonio, TX',
  'Fort Worth, TX',
  'Austin, TX',
  'Oklahoma City, OK',
  'Tulsa, OK',
  'New Orleans, LA',
  'Baton Rouge, LA',
]

const MAX_PAGES_PER_QUERY = 3
const RESULTS_PER_PAGE   = 15

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse salary text like "$15–$20 an hour", "$18 an hour", "$50,000 a year"
 * Returns { min, max } in hourly; null if unparseable.
 */
function parseSalary(text) {
  if (!text) return null
  const clean = text.replace(/,/g, '').toLowerCase()

  // Hourly range: "$15 - $20 an hour" or "$15–$20/hr"
  const hourlyRange = clean.match(/\$(\d+(?:\.\d+)?)\s*[-–]\s*\$(\d+(?:\.\d+)?)\s*(an hour|\/hr|hour)/i)
  if (hourlyRange) {
    return { min: parseFloat(hourlyRange[1]), max: parseFloat(hourlyRange[2]) }
  }

  // Hourly single: "$18 an hour"
  const hourlySingle = clean.match(/\$(\d+(?:\.\d+)?)\s*(an hour|\/hr|hour)/i)
  if (hourlySingle) {
    const v = parseFloat(hourlySingle[1])
    return { min: v, max: v }
  }

  // Annual range: "$35,000–$45,000 a year"
  const annualRange = clean.match(/\$(\d+(?:\.\d+)?)\s*[-–]\s*\$(\d+(?:\.\d+)?)\s*(a year|\/yr|year)/i)
  if (annualRange) {
    const min = parseFloat(annualRange[1]) / 2080
    const max = parseFloat(annualRange[2]) / 2080
    return { min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100 }
  }

  // Annual single
  const annualSingle = clean.match(/\$(\d+(?:\.\d+)?)\s*(a year|\/yr|year)/i)
  if (annualSingle) {
    const v = parseFloat(annualSingle[1]) / 2080
    return { min: Math.round(v * 100) / 100, max: Math.round(v * 100) / 100 }
  }

  return null
}

/** monthly_labor_cost = ((hourly_min + hourly_max) / 2) * 160 */
function calcMonthlyLaborCost(salary) {
  if (!salary) return null
  const avg = (salary.min + salary.max) / 2
  return Math.round(avg * 160)
}

/** Build Indeed search URL */
function indeedUrl(query, location, start = 0) {
  const q = encodeURIComponent(query)
  const l = encodeURIComponent(location)
  return `https://www.indeed.com/jobs?q=${q}&l=${l}&start=${start}&fromage=30&sort=date`
}

/** Deduplicate: check if phone or business_name already in leads */
async function isDuplicate(businessName, phone) {
  const checks = []
  if (businessName) {
    checks.push(
      supabase.from('leads').select('id').ilike('business_name', businessName).limit(1)
    )
  }
  if (phone) {
    checks.push(
      supabase.from('leads').select('id').eq('phone', phone).limit(1)
    )
  }
  const results = await Promise.all(checks)
  return results.some(r => r.data && r.data.length > 0)
}

/** Insert a single lead */
async function insertLead(lead) {
  const dup = await isDuplicate(lead.business_name, lead.phone)
  if (dup) {
    console.log(`  [skip] duplicate: ${lead.business_name}`)
    return false
  }
  const { error } = await supabase.from('leads').insert([lead])
  if (error) {
    console.error(`  [error] inserting ${lead.business_name}:`, error.message)
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

async function scrapeQuery(page, searchConfig, location) {
  const leads = []
  const { query, niche } = searchConfig

  for (let pageNum = 0; pageNum < MAX_PAGES_PER_QUERY; pageNum++) {
    const start = pageNum * RESULTS_PER_PAGE
    const url = indeedUrl(query, location, start)
    console.log(`  Fetching: ${url}`)

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      // Wait for job cards to load
      await page.waitForSelector('[class*="jobCard"]', { timeout: 10000 }).catch(() => null)
      await page.waitForTimeout(1500 + Math.random() * 1000)
    } catch {
      console.log(`  [warn] page load timeout on page ${pageNum + 1}`)
      break
    }

    // Extract job cards
    const jobs = await page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="jobCard"], .job_seen_beacon, [data-testid="jobCard"]')
      return Array.from(cards).map(card => {
        const company   = card.querySelector('[data-testid="company-name"], .companyName')?.textContent?.trim()
        const title     = card.querySelector('[data-testid="jobTitle"], .jobTitle')?.textContent?.trim()
        const locationEl = card.querySelector('[data-testid="text-location"], .companyLocation')?.textContent?.trim()
        const salary    = card.querySelector('[data-testid="attribute_snippet_testid"], .salary-snippet, [class*="salary"]')?.textContent?.trim()
        const jobLink   = card.querySelector('a[data-jk], a[id^="job_"]')?.getAttribute('href')
        return { company, title, salary, location: locationEl, jobLink }
      }).filter(j => j.company)
    })

    if (jobs.length === 0) {
      console.log(`  No more results at start=${start}`)
      break
    }

    for (const job of jobs) {
      if (!job.company) continue

      const salary   = parseSalary(job.salary)
      const monthly  = calcMonthlyLaborCost(salary)

      // Extract city from location string
      const cityMatch = (job.location || location).match(/^([^,]+)/)
      const city = cityMatch ? cityMatch[1].trim() : location

      const lead = {
        business_name:      job.company,
        niche,
        city,
        monthly_labor_cost: monthly,
        hourly_min:         salary?.min ?? null,
        hourly_max:         salary?.max ?? null,
        job_title:          job.title,
        status:             'New',
        source:             'indeed',
        notes:              monthly
          ? `Hiring: ${job.title}. Est. monthly labor cost $${monthly.toLocaleString()}.`
          : `Hiring: ${job.title}. No salary listed.`,
        created_at: new Date().toISOString(),
      }
      leads.push(lead)
    }

    // Check for next page
    const hasNext = await page.$('[aria-label="Next Page"], [data-testid="pagination-page-next"]')
    if (!hasNext) break
  }

  return leads
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Starting Indeed scraper...')
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  })

  const page = await context.newPage()
  // Block images and fonts to speed up scraping
  await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}', route => route.abort())

  let totalInserted = 0
  let totalSkipped  = 0

  for (const location of LOCATIONS) {
    for (const searchConfig of SEARCH_QUERIES) {
      console.log(`\n[${location}] ${searchConfig.query}`)
      const leads = await scrapeQuery(page, searchConfig, location)
      console.log(`  Found ${leads.length} businesses`)

      for (const lead of leads) {
        const inserted = await insertLead(lead)
        if (inserted) {
          totalInserted++
          console.log(`  [+] ${lead.business_name} (${lead.city}) — $${lead.monthly_labor_cost ?? '?'}/mo`)
        } else {
          totalSkipped++
        }
      }

      // Polite delay between queries
      await page.waitForTimeout(2000 + Math.random() * 2000)
    }
  }

  await browser.close()
  console.log(`\n✓ Done. Inserted: ${totalInserted}, Skipped (dup): ${totalSkipped}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
