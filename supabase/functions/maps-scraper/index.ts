/**
 * maps-scraper Edge Function
 *
 * Searches Google Maps Places API for businesses in target niches.
 * Filters: < maxReviews reviews.
 * Flags no-website businesses as web agency candidates.
 *
 * Requires: GOOGLE_MAPS_API_KEY in Supabase Edge Function secrets.
 *
 * Body params:
 *   niches:      string[]  — e.g. ["HVAC", "Plumbing"]
 *   cities:      string[]  — e.g. ["Dallas, TX", "Houston, TX"]
 *   maxReviews:  number    — filter businesses under this count (default 50)
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type PlaceResult = {
  business_name:     string
  phone:             string | null
  website:           string | null
  city:              string
  niche:             string
  rating:            number | null
  review_count:      number | null
  no_website:        boolean
  source:            string
  status:            string
  notes:             string | null
  already_in_db:     boolean
  place_id:          string
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

async function getPlaceDetails(placeId: string, apiKey: string): Promise<{ phone?: string; website?: string }> {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,website&key=${apiKey}`
    const res  = await fetch(url, { signal: AbortSignal.timeout(5000) })
    const data = await res.json()
    return {
      phone:   data.result?.formatted_phone_number || undefined,
      website: data.result?.website || undefined,
    }
  } catch {
    return {}
  }
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

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({
        error: 'GOOGLE_MAPS_API_KEY not set in Edge Function secrets',
        setup: 'Add GOOGLE_MAPS_API_KEY in Supabase Dashboard → Edge Functions → Secrets',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { niches = ['HVAC'], cities = ['Dallas, TX'], maxReviews = 50 } = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const results: PlaceResult[] = []
    const seenPlaceIds = new Set<string>()

    for (const city of cities) {
      for (const niche of niches) {
        const queryStr = encodeURIComponent(`${niche} near ${city}`)
        const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${queryStr}&key=${apiKey}`

        let places: Record<string, unknown>[] = []
        try {
          const res  = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) })
          const data = await res.json()

          // Surface API key / quota errors immediately instead of silently returning 0 results
          if (data.status === 'REQUEST_DENIED' || data.status === 'INVALID_REQUEST') {
            return new Response(JSON.stringify({
              error: `Google Maps API error: ${data.status}`,
              detail: data.error_message || data.status,
              setup: 'Ensure GOOGLE_MAPS_API_KEY in Supabase Edge Function secrets is a valid key with Places API enabled (Google Cloud Console → APIs & Services → Enable "Places API")',
            }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
          }

          places = data.results || []
        } catch {
          continue
        }

        for (const place of places as Array<Record<string, unknown>>) {
          const reviewCount = (place.user_ratings_total as number) || 0

          // Filter: skip if too many reviews (too established)
          if (reviewCount >= maxReviews) continue

          const placeId = place.place_id as string
          if (!placeId || seenPlaceIds.has(placeId)) continue
          seenPlaceIds.add(placeId)

          // Get phone + website from place details
          const details = await getPlaceDetails(placeId, apiKey)
          const noWebsite = !details.website

          const cityName = city.replace(/,?\s*[A-Z]{2}$/, '').trim()

          // Deduplication check — never re-scrape businesses already in the
          // pipeline. Match on place_id when available, fallback to
          // business_name + city (case-insensitive). A lead row with ANY
          // status (not_interested, booked, or anything active) blocks
          // re-insertion.
          const { data: byPlaceId } = await supabase
            .from('leads')
            .select('id')
            .eq('place_id', placeId)
            .limit(1)
          let alreadyInDb = !!(byPlaceId && byPlaceId.length > 0)
          if (!alreadyInDb) {
            const { data: byNameCity } = await supabase
              .from('leads')
              .select('id')
              .ilike('business_name', String(place.name || ''))
              .ilike('city', cityName)
              .limit(1)
            alreadyInDb = !!(byNameCity && byNameCity.length > 0)
          }

          const notes = noWebsite
            ? `No website — web agency candidate. Reviews: ${reviewCount}. Address: ${place.formatted_address}`
            : `Reviews: ${reviewCount}. Address: ${place.formatted_address}`

          results.push({
            business_name: String(place.name || ''),
            phone:         details.phone || null,
            website:       details.website || null,
            city:          cityName,
            niche,
            rating:        (place.rating as number) || null,
            review_count:  reviewCount,
            no_website:    noWebsite,
            source:        'google_maps',
            status:        'New',
            notes,
            already_in_db: alreadyInDb,
            place_id:      placeId,
          })
        }
      }
    }

    return new Response(JSON.stringify({ results, total: results.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
