import { createClient } from 'npm:@supabase/supabase-js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Runs every minute via pg_cron.
// Finds pending reminders due to be sent, sends them via Twilio SMS,
// and updates their status.
//
// WIRE-THIS: Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
// in Supabase Edge Function secrets once Twilio account is provisioned.
// See src/lib/twilio.js for full Twilio setup instructions.

const TWILIO_STUB_MODE = !Deno.env.get('TWILIO_ACCOUNT_SID')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const now = new Date().toISOString()

  // Fetch due reminders (scheduled_time <= now, status = pending)
  // Join to appointments to get lead phone number
  const { data: due, error: fetchError } = await supabase
    .from('reminder_log')
    .select(`
      id,
      appointment_id,
      message_body,
      appointments!inner(
        id,
        leads!inner(phone, contact_name)
      )
    `)
    .eq('status', 'pending')
    .lte('scheduled_time', now)
    .limit(50) // process in batches to stay within function timeout

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (!due?.length) {
    return new Response(JSON.stringify({ processed: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const results = await Promise.all(due.map(async (reminder) => {
    const phone = (reminder.appointments as any)?.leads?.phone
    const body = reminder.message_body

    if (!phone) {
      // No phone number — mark as failed
      await supabase
        .from('reminder_log')
        .update({ status: 'failed', send_time: now, error_message: 'No phone number on lead' })
        .eq('id', reminder.id)
      return { id: reminder.id, status: 'failed', reason: 'no_phone' }
    }

    if (TWILIO_STUB_MODE) {
      // WIRE-THIS: Twilio not configured — marking as sent (stub)
      // In production this will send a real SMS
      await supabase
        .from('reminder_log')
        .update({ status: 'sent', send_time: now, error_message: 'STUB: Twilio not configured' })
        .eq('id', reminder.id)
      return { id: reminder.id, status: 'stub' }
    }

    // Send real SMS via Twilio
    try {
      const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID')!
      const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN')!
      const fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER')!

      const formData = new URLSearchParams({
        To: phone,
        From: fromNumber,
        Body: body || '',
      })

      const twilioResp = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString(),
        }
      )

      const twilioData = await twilioResp.json()

      if (twilioData.sid) {
        await supabase
          .from('reminder_log')
          .update({ status: 'sent', send_time: now, twilio_message_sid: twilioData.sid })
          .eq('id', reminder.id)
        return { id: reminder.id, status: 'sent', sid: twilioData.sid }
      } else {
        throw new Error(twilioData.message || 'Twilio error')
      }
    } catch (err: any) {
      await supabase
        .from('reminder_log')
        .update({ status: 'failed', send_time: now, error_message: err.message })
        .eq('id', reminder.id)
      return { id: reminder.id, status: 'failed', error: err.message }
    }
  }))

  return new Response(JSON.stringify({ processed: results.length, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
