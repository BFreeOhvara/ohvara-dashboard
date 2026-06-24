// ============================================================
// create-commission-payout — auto-create a pending rep payout on close (Prompt 55)
//
// Called from the closer's AppointmentCard when a deal is marked closed.
// Fetches the appointment server-side (never trusts a client-sent amount),
// computes 10% of the deal total, and inserts a pending commission_payouts
// row for the booking rep. Uses the service role to insert, since the closer
// can't write another rep's payout row under RLS. Idempotent per appointment.
//
// Deploy WITH jwt verification (default — the closer is authenticated):
//   supabase functions deploy create-commission-payout --project-ref jjextitmbptoaolacocs
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const COMMISSION_RATE = 0.10 // 10% of the deal total — North Star commission math

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing Authorization header' }, 401)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: { user }, error: authError } = await admin.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authError || !user) return json({ error: 'Invalid or expired token' }, 401)

  const { data: caller } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (caller?.role !== 'closer' && caller?.role !== 'admin') {
    return json({ error: 'Forbidden — closer or admin only' }, 403)
  }

  const { appointment_id } = await req.json().catch(() => ({}))
  if (!appointment_id) return json({ error: 'appointment_id is required' }, 400)

  // Idempotent: never double-create for the same appointment (handleComplete
  // can fire more than once).
  const { data: existing } = await admin
    .from('commission_payouts')
    .select('id')
    .eq('appointment_id', appointment_id)
    .maybeSingle()
  if (existing) return json({ success: true, payout_id: existing.id, alreadyExisted: true })

  // Authoritative deal total from the appointment row, with the lead's
  // formula price as a fallback when the closer didn't enter a deal_value.
  const { data: appt } = await admin
    .from('appointments')
    .select('id, rep_id, deal_value, lead_id')
    .eq('id', appointment_id)
    .single()
  if (!appt) return json({ error: 'Appointment not found' }, 404)
  if (!appt.rep_id) return json({ error: 'Appointment has no booking rep' }, 422)

  let dealTotal = Number(appt.deal_value) || 0
  if (dealTotal <= 0 && appt.lead_id) {
    const { data: lead } = await admin
      .from('leads')
      .select('custom_monthly_price')
      .eq('id', appt.lead_id)
      .single()
    dealTotal = Number(lead?.custom_monthly_price) || 0
  }

  const dealValueCents = Math.round(dealTotal * 100)
  const amountCents = Math.round(dealValueCents * COMMISSION_RATE)
  if (amountCents <= 0) {
    return json({ error: 'Deal total is zero — no payout created', skipped: true }, 200)
  }

  const { data: inserted, error: insertError } = await admin
    .from('commission_payouts')
    .insert({
      rep_profile_id: appt.rep_id,
      appointment_id: appt.id,
      amount_cents: amountCents,
      deal_value_cents: dealValueCents,
      status: 'pending',
    })
    .select('id')
    .single()
  if (insertError) return json({ error: insertError.message }, 500)

  return json({ success: true, payout_id: inserted.id, amount_cents: amountCents })
})
