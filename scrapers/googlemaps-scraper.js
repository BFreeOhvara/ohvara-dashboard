/**
 * googlemaps-scraper.js
 * Searches Google Maps for businesses in target niches across Texas / Oklahoma / Louisiana.
 * Filters: < 50 reviews. Flags businesses with no website.
 * Inserts results into Supabase leads table.
 *
 * Usage:
 *   node scrapers/googlemaps-scraper.js
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

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const TARGET_CITIES = [
  // Texas
  'Dallas TX',
  'Fort Worth TX',
  'Houston TX',
  'San Antonio TX',
  'Austin TX',
  'Lubbock TX',
  'Amarillo TX',
  'Waco TX',
  'Midland TX',
  'Tyler TX',
  // Oklahoma
  'Oklahoma City OK',
  'Tulsa OK',
  'Norman OK',
  'Edmond OK',
  'Broken Arrow OK',
  // Louisiana
  'New Orleans LA',
  'Baton Rouge LA',
  'Shreveport LA',
  'Lafayette LA',
  'Lake Charles LA',
]

const NICHE_QUERIES = [
  { query: 'HVAC company',              niche: 'HVAC' },
  { query: 'plumbing company',          niche: 'Plumbing' },
  { query: 'roofing contractor',        niche: 'Roofing' },
  { query: 'landscaping company',       niche: 'Landscaping' },
  { query: 'dental office',             niche: 'Dental' },
  { query: 'law firm',                  niche: 'Legal' },
  { query: 'auto repair shop',          niche: 'Auto Repair' },
  { query: 'pest control company',      niche: 'Pest Control' },
  { query: 'physical therapy clinic',   niche: 'Physical Therapy' },
  { query: 'chiropractic office',       niche: 'Chiropractic' },
  { query: 'electrical contractor',     niche: 'Electrical' },
]

const MAX_RESULTS_PER_SEARCH = 20  // scroll through the sidebar to get up to this many
const MIN_REVIEWS_THRESHOLD  = 50  // only keep businesses with fewer than this many reviews

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build Google Maps search URL */
function mapsUrl(query, city) {
  return `https://www.google.com/maps/search/${encodeURIComponent(`${query} in ${city}`)}`
}

/** Parse review count from text like "(48)", "48 reviews", "(1.2K)" */
function parseReviewCount(text) {
  if (!text) return null
  const clean = text.replace(/[(),\s]/g, '').toLowerCase()
  if (clean.endsWith('k')) return parseFloat(clean) * 1000
  const n = parseInt(clean, 10)
  return isNaN(n) ? null : n
}

/** Deduplicate: check if phone or business_name already in leads */
async function isDuplicate(businessName, phone) {
  const checks = []
  if (businessName) {
    checks.push(supabase.from('leads').select('id').ilike('business_name', businessName).limit(1))
  }
  if (phone) {
    checks.push(supabase.from('leads').select('id').eq('phone', phone).limit(1))
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

async function scrapeSearch(page, query, niche, city) {
  const url = mapsUrl(query, city)
  const leads = []

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(2500 + Math.random() * 1000)
  } catch {
    console.log(`  [warn] page load failed: ${url}`)
    return leads
  }

  // Wait for results panel
  const panelSel = '[role="feed"], div[aria-label*="Results"], [class*="section-listbox"]'
  try {
    await page.waitForSelector(panelSel, { timeout: 8000 })
  } catch {
    console.log(`  [warn] no results panel found`)
    return leads
  }

  // Scroll to load up to MAX_RESULTS_PER_SEARCH listings
  const scrollContainer = await page.$(panelSel)
  if (scrollContainer) {
    for (let i = 0; i < Math.ceil(MAX_RESULTS_PER_SEARCH / 7); i++) {
      await scrollContainer.evaluate(el => el.scrollBy(0, 600))
      await page.waitForTimeout(800)
    }
  }

  // Extract listing cards
  const listingItems = await page.$$('[jstcache] a[href*="/maps/place/"], [data-result-index] a[href*="maps/place"]')

  // Collect unique hrefs (each card usually has 2 links with same href)
  const hrefs = new Set()
  for (const el of listingItems) {
    const href = await el.getAttribute('href').catch(() => null)
    if (href) hrefs.add(href)
  }

  // Scrape each listing detail
  for (const href of Array.from(hrefs).slice(0, MAX_RESULTS_PER_SEARCH)) {
    try {
      await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 25000 })
      await page.waitForTimeout(1500 + Math.random() * 500)

      const details = await page.evaluate(() => {
        // Business name
        const name = document.querySelector('h1[class*="DUwDvf"], h1[data-attrid*="title"]')?.textContent?.trim()
          || document.querySelector('h1')?.textContent?.trim()

        // Phone
        const phoneEl = document.querySelector('[data-item-id*="phone"], [aria-label*="Phone:"]')
        const phone = phoneEl?.getAttribute('aria-label')?.replace(/^Phone:\s*/i, '').trim()
          || phoneEl?.textContent?.trim()

        // Website
        const websiteEl = document.querySelector('[data-item-id*="authority"], a[aria-label*="Website"]')
        const website = websiteEl?.getAttribute('href') || null

        // Rating + review count
        const ratingEl = document.querySelector('[aria-label*="stars"], [class*="fontBodyMedium"] span[aria-label]')
        const ratingText = ratingEl?.getAttribute('aria-label') || ''
        const ratingMatch = ratingText.match(/(\d+(?:\.\d+)?)\s*star/)
        const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null

        const reviewsEl = document.querySelector('[aria-label*="reviews"], [class*="fontBodyMedium"] button[aria-label*="review"]')
        const reviewsText = reviewsEl?.getAttribute('aria-label') || reviewsEl?.textContent || ''
        const reviewsMatch = reviewsText.match(/([\d,]+(?:\.\d+)?[Kk]?)\s*(?:Google\s*)?review/)
        const reviewsRaw = reviewsMatch ? reviewsMatch[1] : null

        // Address
        const addrEl = document.querySelector('[data-item-id*="address"], button[aria-label*="Address:"], [class*="rogA2c"]')
        const address = addrEl?.getAttribute('aria-label')?.replace(/^Address:\s*/i, '').trim()
          || addrEl?.textContent?.trim()

        return { name, phone, website, rating, reviewsRaw, address }
      })

      if (!details.name) continue

      const reviewCount = parseReviewCount(details.reviewsRaw)

      // Filter: skip if >= MIN_REVIEWS_THRESHOLD
      if (reviewCount !== null && reviewCount >= MIN_REVIEWS_THRESHOLD) {
        console.log(`  [filter] ${details.name} (${reviewCount} reviews — too established)`)
        continue
      }

      const noWebsite = !details.website

      const lead = {
        business_name: details.name,
        niche,
        city: city.replace(/ [A-Z]{2}$/, '').trim(),
        phone:         details.phone || null,
        website:       details.website || null,
        rating:        details.rating || null,
        review_count:  reviewCount,
        status:        'New',
        source:        'google_maps',
        notes:         noWebsite
          ? `No website detected — strong AI receptionist candidate. Reviews: ${reviewCount ?? 'unknown'}. Address: ${details.address || 'n/a'}`
          : `Reviews: ${reviewCount ?? 'unknown'}. Address: ${details.address || 'n/a'}`,
        created_at: new Date().toISOString(),
      }

      leads.push(lead)
    } catch (err) {
      console.log(`  [warn] failed to scrape listing: ${err.message?.slice(0, 60)}`)
    }
  }

  return leads
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Starting Google Maps scraper...')

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  })

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
    geolocation: { longitude: -97.7431, latitude: 30.2672 }, // Austin TX
    permissions: ['geolocation'],
  })

  const page = await context.newPage()

  // Block tracking pixels and fonts
  await page.route('**/*.{png,jpg,jpeg,gif,webp,woff,woff2,ttf}', route => route.abort())
  await page.route('**/analytics**', route => route.abort())

  let totalInserted = 0
  let totalSkipped  = 0
  let totalFiltered = 0

  for (const city of TARGET_CITIES) {
    for (const { query, niche } of NICHE_QUERIES) {
      console.log(`\n[${city}] ${query}`)

      const leads = await scrapeSearch(page, query, niche, city)
      console.log(`  Scraped: ${leads.length} leads (pre-insert)`)

      for (const lead of leads) {
        const inserted = await insertLead(lead)
        if (inserted) {
          totalInserted++
          const noWebTag = !lead.website ? ' [NO WEBSITE]' : ''
          console.log(`  [+] ${lead.business_name} (${lead.review_count ?? '?'} reviews)${noWebTag}`)
        } else {
          totalSkipped++
        }
      }

      // Polite pause between searches
      await page.waitForTimeout(3000 + Math.random() * 2000)
    }
  }

  await browser.close()
  console.log(`\n✓ Done.`)
  console.log(`  Inserted: ${totalInserted}`)
  console.log(`  Skipped (duplicate): ${totalSkipped}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
