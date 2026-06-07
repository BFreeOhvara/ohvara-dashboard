import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Called by the frontend when an appointment is scheduled or rescheduled.
// Cancels any existing pending reminders for this appointment, then
// creates three new ones at T-24h, T-1h, and T-10min.
//
// Body:
//   appointment_id  string  — required
//   scheduled_at    string  — ISO 8601 datetime — required unless cancel_all=true
//   lead_phone      string  — prospect's phone number
//   contact_name    string  — prospect's first name for SMS personalization
//   cancel_all      boolean — if true, cancels all pending reminders and returns

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { appointment_id, scheduled_at, lead_phone, contact_name, cancel_all } = await req.json()

  if (!appointment_id) {
    return new Response(JSON.stringify({ error: 'appointment_id required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Step 1: Cancel any existing pending reminders for this appointment
  const { error: cancelError } = await supabase
    .from('reminder_log')
    .update({ status: 'cancelled' })
    .eq('appointment_id', appointment_id)
    .eq('status', 'pending')

  if (cancelError) {
    return new Response(JSON.stringify({ error: cancelError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (cancel_all) {
    return new Response(JSON.stringify({ success: true, action: 'cancelled_all' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (!scheduled_at) {
    return new Response(JSON.stringify({ error: 'scheduled_at required when not cancelling' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const apptTime = new Date(scheduled_at)
  const firstName = contact_name?.split(' ')[0] || 'there'
  const timeDisplay = apptTime.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago'
  })

  // Step 2: Build the three reminder rows
  const reminders = [
    {
      appointment_id,
      scheduled_time: new Date(apptTime.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      channel: 'sms',
      message_body: `Hi ${firstName}, just a reminder — you have a call with the Ohvara team tomorrow at ${timeDisplay} CST. Reply STOP to opt out.`,
      status: 'pending',
    },
    {
      appointment_id,
      scheduled_time: new Date(apptTime.getTime() - 60 * 60 * 1000).toISOString(),
      channel: 'sms',
      message_body: `Hi ${firstName}, your call with Ohvara is in 1 hour at ${timeDisplay} CST. We're looking forward to connecting!`,
      status: 'pending',
    },
    {
      appointment_id,
      scheduled_time: new Date(apptTime.getTime() - 10 * 60 * 1000).toISOString(),
      channel: 'sms',
      message_body: `Hi ${firstName}, your Ohvara call starts in 10 minutes. We'll be ready when you are!`,
      status: 'pending',
    },
  ].filter(r => new Date(r.scheduled_time) > new Date()) // only schedule future reminders

  if (!reminders.length) {
    return new Response(JSON.stringify({ success: true, created: 0, note: 'Appointment is too soon for reminders' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const { error: insertError } = await supabase.from('reminder_log').insert(reminders)

  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({ success: true, created: reminders.length }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
