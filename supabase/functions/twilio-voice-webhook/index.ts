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
// Required Supabase secrets:
//   TWILIO_PHONE_NUMBER — the callerId shown to the lead (e.g. +12345678900)
//
// Recording status callbacks POST to the /recording subpath and trigger
// the grade-call edge function (Deepgram transcription + Claude Haiku grading).
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js'

const xmlHeaders = { 'Content-Type': 'text/xml' }

function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { headers: xmlHeaders })
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // Recording status callback — Twilio POSTs recording metadata here.
  // On completed recordings: store the URL on the calls row (by CallSid),
  // then fire grade-call async to transcribe + grade.
  if (url.pathname.endsWith('/recording')) {
    try {
      const form = await req.formData()
      const recordingSid = String(form.get('RecordingSid') || '')
      const recordingUrl = String(form.get('RecordingUrl') || '')
      const callSid      = String(form.get('CallSid')      || '')
      const status       = String(form.get('RecordingStatus') || '')

      console.log('[twilio-voice-webhook] recording callback:', { recordingSid, callSid, status })

      if (status === 'completed' && callSid && recordingUrl) {
        const admin = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        )
        // Store recording metadata on the calls row.
        await admin
          .from('calls')
          .update({ twilio_recording_sid: recordingSid, twilio_recording_url: recordingUrl })
          .eq('twilio_call_sid', callSid)

        // Fire grade-call — fire-and-forget, never awaited.
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/grade-call`, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            Authorization:   `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({ callSid, recordingUrl, recordingSid }),
        }).catch(err => console.error('[twilio-voice-webhook] grade-call invoke failed:', err))
      }
    } catch (err) {
      console.error('[twilio-voice-webhook] recording callback error:', err)
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
