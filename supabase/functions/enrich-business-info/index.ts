/**
 * enrich-business-info Edge Function
 *
 * Prompt 46 — fire-and-forget business research lookup, called right after
 * a setter books an appointment (CallModal's handleDone, mirroring how
 * recommend-stack is already invoked from the same spot). Never blocks the
 * booking flow — the caller doesn't await this, and any failure here is
 * silent from the rep's perspective.
 *
 * Reuses the maps-scraper edge function's Text Search → Place Details
 * pattern. If the lead already has a place_id (Maps-sourced leads carry one
 * from migration 019), skips straight to Place Details instead of
 * re-searching.
 *
 * Requires: GOOGLE_MAPS_API_KEY in Supabase Edge Function secrets (already
 * set — same key the Maps scraper uses).
 *
 * Body params:
 *   leadId:       string  — required, the lead row to update
 *   businessName: string  — required if placeId not provided
 *   city:         string  — optional, improves search match quality
 *   placeId:      string  — optional, skips the Text Search step if known
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function resolvePlaceId(businessName: string, city: string | null, apiKey: string): Promise<string | null> {
  const query = encodeURIComponent(city ? `${businessName} ${city}` : businessName)
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${apiKey}`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  const data = await res.json()
  return data.results?.[0]?.place_id || null
}

async function getPlaceDetails(placeId: string, apiKey: string) {
  const fields = 'rating,user_ratings_total,website,business_status'
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${apiKey}`
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  const data = await res.json()
  return data.result || {}
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GOOGLE_MAPS_API_KEY not set' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { leadId, businessName, city = null, placeId: knownPlaceId = null } = await req.json()
    if (!leadId || (!businessName && !knownPlaceId)) {
      return new Response(JSON.stringify({ error: 'leadId and (businessName or placeId) required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const placeId = knownPlaceId || await resolvePlaceId(businessName, city, apiKey)
    if (!placeId) {
      return new Response(JSON.stringify({ skipped: true, reason: 'no place match found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const details = await getPlaceDetails(placeId, apiKey)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { error } = await supabase.from('leads').update({
      place_id:            placeId,
      google_rating:        details.rating ?? null,
      google_review_count:  details.user_ratings_total ?? null,
      has_website:          details.website ? true : false,
    }).eq('id', leadId)

    if (error) throw error

    return new Response(JSON.stringify({
      success: true,
      placeId,
      rating: details.rating ?? null,
      reviewCount: details.user_ratings_total ?? null,
      hasWebsite: !!details.website,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    // Fire-and-forget caller never sees this — logged server-side only.
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
