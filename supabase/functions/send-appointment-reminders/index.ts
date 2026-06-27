import { createClient } from 'npm:@supabase/supabase-js'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TWILIO_SID   = Deno.env.get('TWILIO_ACCOUNT_SID')
const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')
const TWILIO_FROM  = Deno.env.get('TWILIO_PHONE_NUMBER')
const STUB_MODE    = !TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago',
  })
}

async function sendSms(to: string, body: string): Promise<boolean> {
  if (STUB_MODE) {
    console.log(`[send-appointment-reminders] STUB SMS to ${to}: ${body}`)
    return true
  }
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: TWILIO_FROM!, Body: body }),
    }
  )
  if (!res.ok) {
    console.warn(`[send-appointment-reminders] Twilio error ${res.status}:`, await res.text())
    return false
  }
  return true
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const now = new Date()
    const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000) // 25h ahead

    // Fetch upcoming pending/needs_rescheduling appointments with lead phone
    const { data: appts, error } = await supabase
      .from('appointments')
      .select('id, scheduled_at, sms_24h_sent, sms_1h_sent, sms_10min_sent, leads(phone)')
      .in('status', ['pending', 'needs_rescheduling'])
      .gt('scheduled_at', now.toISOString())
      .lte('scheduled_at', windowEnd.toISOString())

    if (error) throw error

    let sent = 0

    for (const appt of appts ?? []) {
      const phone = (appt.leads as any)?.phone
      if (!phone) continue

      const apptTime = new Date(appt.scheduled_at).getTime()
      const diffMin  = (apptTime - now.getTime()) / 60000
      const updates: Record<string, boolean> = {}

      // 24h window: 23h55m – 24h5m (1435–1445 min)
      if (!appt.sms_24h_sent && diffMin >= 1435 && diffMin <= 1445) {
        const ok = await sendSms(
          phone,
          `Hi! Just a reminder — your call with the Ohvara team is scheduled for tomorrow at ${formatTime(appt.scheduled_at)}. Reply CANCEL to cancel or RESCHEDULE to have someone reach out.`
        )
        if (ok) updates.sms_24h_sent = true
      }

      // 1h window: 55–65 min
      if (!appt.sms_1h_sent && diffMin >= 55 && diffMin <= 65) {
        const ok = await sendSms(
          phone,
          `Your Ohvara call is in 1 hour at ${formatTime(appt.scheduled_at)}. Reply CANCEL to cancel or RESCHEDULE to reschedule.`
        )
        if (ok) updates.sms_1h_sent = true
      }

      // 10min window: 5–15 min
      if (!appt.sms_10min_sent && diffMin >= 5 && diffMin <= 15) {
        const ok = await sendSms(
          phone,
          `Your Ohvara call starts in 10 minutes. Reply CANCEL if you can't make it.`
        )
        if (ok) updates.sms_10min_sent = true
      }

      if (Object.keys(updates).length > 0) {
        await supabase.from('appointments').update(updates).eq('id', appt.id)
        sent++
      }
    }

    return new Response(
      JSON.stringify({ checked: appts?.length ?? 0, sent }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[send-appointment-reminders]', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
