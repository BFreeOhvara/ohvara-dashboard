// ============================================================
// twilio-call — bridge call with recording
//
// Flow: rep clicks "Bridge Call" → this fn tells Twilio to call
// the rep's personal phone → rep picks up → Twilio connects them
// to the lead while recording both legs (dual-channel).
//
// Required Supabase secrets (set before going live):
//   TWILIO_ACCOUNT_SID   — Twilio account SID
//   TWILIO_AUTH_TOKEN    — Twilio auth token
//   TWILIO_PHONE_NUMBER  — Your Twilio number (e.g. +12345678900)
//
// Rep phone number is stored in profiles.phone (migration 045).
// ============================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const { repPhone, leadPhone } = await req.json()

  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN')
  const twilioPhone = Deno.env.get('TWILIO_PHONE_NUMBER')

  if (!accountSid || !authToken || !twilioPhone) {
    return new Response(JSON.stringify({ error: 'Twilio not configured' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!repPhone || !leadPhone) {
    return new Response(JSON.stringify({ error: 'repPhone and leadPhone are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Twilio calls the rep's phone first. When they pick up, TwiML connects
  // them to the lead while recording both channels independently.
  const twiml = [
    '<Response>',
    `  <Dial record="record-from-answer-dual-channel" callerId="${twilioPhone}">`,
    `    <Number>${leadPhone}</Number>`,
    '  </Dial>',
    '</Response>',
  ].join('')

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To:    repPhone,
        From:  twilioPhone,
        Twiml: twiml,
      }).toString(),
    }
  )

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    return new Response(
      JSON.stringify({ error: err.message || `Twilio error ${resp.status}` }),
      { status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const call = await resp.json()
  return new Response(
    JSON.stringify({ callSid: call.sid, status: call.status }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
