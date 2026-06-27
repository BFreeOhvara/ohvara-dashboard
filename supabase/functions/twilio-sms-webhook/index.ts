// twilio-sms-webhook — handles inbound SMS replies from clients
//
// Deploy WITHOUT jwt verification (Twilio calls this directly):
//   supabase functions deploy twilio-sms-webhook --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
// Twilio Console: set "A MESSAGE COMES IN" webhook to:
//   https://jjextitmbptoaolacocs.supabase.co/functions/v1/twilio-sms-webhook
//
// Supported keywords (case-insensitive): CANCEL, RESCHEDULE

import { createClient } from 'npm:@supabase/supabase-js'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { 'Content-Type': 'text/xml' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')

  try {
    const text = await req.text()
    const params = new URLSearchParams(text)
    const from = params.get('From') || ''
    const body = (params.get('Body') || '').trim().toUpperCase()

    if (!from) return twiml('')

    // Find the most recent active appointment for this phone number
    const { data: rows } = await supabase
      .from('appointments')
      .select(`
        id,
        rep_id,
        closer_id,
        leads!inner(phone, business_name)
      `)
      .in('status', ['pending', 'needs_rescheduling'])
      .eq('leads.phone', from)
      .order('scheduled_at', { ascending: false })
      .limit(1)

    const appt = rows?.[0]
    if (!appt) return twiml('')

    const businessName = (appt.leads as any)?.business_name || 'Client'

    if (body.includes('CANCEL')) {
      await supabase
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('id', appt.id)

      const notifRows = [
        appt.rep_id    && { profile_id: appt.rep_id,    type: 'appointment_cancelled', message: `${businessName} cancelled their appointment` },
        appt.closer_id && { profile_id: appt.closer_id, type: 'appointment_cancelled', message: `${businessName} cancelled their appointment` },
      ].filter(Boolean)

      if (notifRows.length > 0) {
        await supabase.from('notifications').insert(notifRows)
      }

      return twiml('')
    }

    if (body.includes('RESCHEDULE')) {
      await supabase
        .from('appointments')
        .update({ status: 'needs_rescheduling' })
        .eq('id', appt.id)

      const notifRows = [
        appt.rep_id    && { profile_id: appt.rep_id,    type: 'appointment_rescheduled', message: `${businessName} wants to reschedule` },
        appt.closer_id && { profile_id: appt.closer_id, type: 'appointment_rescheduled', message: `${businessName} wants to reschedule` },
      ].filter(Boolean)

      if (notifRows.length > 0) {
        await supabase.from('notifications').insert(notifRows)
      }

      return twiml('')
    }

    // Unrecognised keyword — acknowledge politely
    return twiml('<Message>Got it — we\'ll be in touch.</Message>')
  } catch (err) {
    console.error('[twilio-sms-webhook]', err)
    return twiml('')
  }
})
