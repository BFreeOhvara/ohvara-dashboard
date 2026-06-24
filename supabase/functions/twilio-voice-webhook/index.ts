// ============================================================
// twilio-voice-webhook — TwiML for the browser WebRTC call
//
// The TwiML App (TWILIO_TWIML_APP_SID) points its Voice URL here.
// When the rep's browser Device calls device.connect({ params:{ To } }),
// Twilio POSTs here; we return TwiML that dials the lead from the
// Twilio number and records both channels.
//
// Deploy WITHOUT jwt verification (Twilio calls this directly, no auth):
//   supabase functions deploy twilio-voice-webhook --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
// TwiML App Voice URL (set in Twilio console):
//   https://jjextitmbptoaolacocs.supabase.co/functions/v1/twilio-voice-webhook
//
// Required Supabase secret:
//   TWILIO_PHONE_NUMBER — the callerId shown to the lead (e.g. +12345678900)
//
// Recording status callbacks POST to the /recording subpath — for now
// they just log (no DB storage until the Phase 2 AI grading pipeline).
// ============================================================

const xmlHeaders = { 'Content-Type': 'text/xml' }

function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { headers: xmlHeaders })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // Recording status callback — Twilio POSTs recording metadata here.
  // No DB storage yet (Phase 2); log and ack so Twilio stops retrying.
  if (url.pathname.endsWith('/recording')) {
    try {
      const form = await req.formData()
      console.log('[twilio-voice-webhook] recording callback:', {
        recordingSid: form.get('RecordingSid'),
        recordingUrl: form.get('RecordingUrl'),
        callSid: form.get('CallSid'),
        status: form.get('RecordingStatus'),
        duration: form.get('RecordingDuration'),
      })
    } catch (_e) {
      console.log('[twilio-voice-webhook] recording callback (unparseable body)')
    }
    return new Response('ok', { status: 200 })
  }

  // Main voice handler — Twilio POSTs form-encoded call params.
  if (req.method !== 'POST') {
    return twiml('<Response><Hangup/></Response>')
  }

  let to = ''
  try {
    const form = await req.formData()
    // `To` is the param passed from device.connect({ params: { To } }).
    to = String(form.get('To') || '').trim()
  } catch (_e) {
    to = ''
  }

  if (!to) {
    // No destination — never leave the leg hanging.
    return twiml('<Response><Hangup/></Response>')
  }

  const callerId = Deno.env.get('TWILIO_PHONE_NUMBER') || ''
  const recordingCb = `${url.origin}${url.pathname.replace(/\/$/, '')}/recording`

  // Escape the dialed number for XML safety (digits/+ only in practice).
  const safeTo = to.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const body =
    '<Response>' +
    `<Dial record="record-from-answer-dual-channel" recordingStatusCallback="${recordingCb}"` +
    (callerId ? ` callerId="${callerId}"` : '') +
    '>' +
    `<Number>${safeTo}</Number>` +
    '</Dial>' +
    '</Response>'

  return twiml(body)
})
