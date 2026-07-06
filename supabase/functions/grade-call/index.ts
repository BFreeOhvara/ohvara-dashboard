// grade-call — transcribe a Twilio call recording via Deepgram, then grade it
// with Claude Haiku and write the results back to the calls row.
//
// Invoked fire-and-forget by twilio-voice-webhook on RecordingStatus=completed.
//
// Deploy WITHOUT jwt verification (webhook-triggered, no user auth):
//   supabase functions deploy grade-call --no-verify-jwt --project-ref jjextitmbptoaolacocs
//
// Required Supabase secrets (in addition to SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN  — fetch the MP3 from Twilio
//   DEEPGRAM_API_KEY                       — transcription (~$9/rep/month at typical volume)
//   ANTHROPIC_API_KEY                      — Haiku grading

import { createClient } from 'npm:@supabase/supabase-js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const GRADES = ['F', 'D', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'] as const
type Grade = typeof GRADES[number]

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const body = await req.json().catch(() => ({}))
  const { callSid, recordingUrl, recordingSid } = body as {
    callSid?: string
    recordingUrl?: string
    recordingSid?: string
  }

  if (!callSid) return json({ error: 'callSid is required' }, 400)
  if (!recordingUrl) return json({ error: 'recordingUrl is required' }, 400)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Find calls row by twilio_call_sid — set by CallModal on Done.
  // If the recording callback fires before Done, this row won't exist yet.
  const { data: callRow } = await admin
    .from('calls')
    .select('id, rep_id, lead:leads ( business_name ), rep:profiles!rep_id ( notification_prefs )')
    .eq('twilio_call_sid', callSid)
    .maybeSingle()

  if (!callRow) {
    console.error('[grade-call] No calls row for callSid:', callSid)
    return json({ error: 'Call not found — rep may not have hit Done yet' }, 404)
  }

  // ── 1. Fetch the MP3 from Twilio ─────────────────────────────────────────
  let transcript = ''
  try {
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!
    const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN')!
    const credentials = btoa(`${accountSid}:${authToken}`)

    const audioRes = await fetch(`${recordingUrl}.mp3`, {
      headers: { Authorization: `Basic ${credentials}` },
    })
    if (!audioRes.ok) {
      throw new Error(`Twilio recording fetch failed: ${audioRes.status} ${audioRes.statusText}`)
    }
    const audioBytes = await audioRes.arrayBuffer()

    // ── 2. Transcribe via Deepgram nova-2 ──────────────────────────────────
    const dgKey = Deno.env.get('DEEPGRAM_API_KEY')!
    const dgRes = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&language=en',
      {
        method: 'POST',
        headers: { Authorization: `Token ${dgKey}`, 'Content-Type': 'audio/mpeg' },
        body: audioBytes,
      },
    )
    if (!dgRes.ok) {
      const errText = await dgRes.text().catch(() => '')
      throw new Error(`Deepgram error: ${dgRes.status} ${errText.slice(0, 200)}`)
    }
    const dgData = await dgRes.json()
    transcript = dgData?.results?.channels?.[0]?.alternatives?.[0]?.transcript || ''
  } catch (err) {
    console.error('[grade-call] Transcription failed:', err)
    await admin.from('calls').update({
      twilio_recording_sid: recordingSid ?? null,
      twilio_recording_url: recordingUrl ?? null,
      transcript: null,
      grade: null,
      graded_at: new Date().toISOString(),
    }).eq('id', callRow.id)
    return json({ error: 'Transcription failed' }, 500)
  }

  // ── 3. Grade via Claude Haiku ────────────────────────────────────────────
  let grade: Grade = 'C'
  let feedbackGood    = 'Called and made contact.'
  let feedbackImprove = 'Focus on asking more discovery questions before going for the booking.'

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (anthropicKey && transcript.trim().length > 30) {
    try {
      const prompt = `You are a sales coach grading a cold call by an appointment setter for an AI automation service.

The setter's goal: deliver a clean opener, ask pain discovery questions (missed calls, response speed, staff cost), handle objections professionally, and book a 15-minute meeting with the business owner.

TRANSCRIPT:
${transcript.slice(0, 4000)}

Grade this call on these criteria:
- Opener quality (confident, not robotic)
- Discovery questions asked (calls missed, avg ticket, current setup)
- Objection handling (professional, not pushy)
- Close attempt (did they go for the booking?)

Return ONLY valid JSON with no markdown fences:
{
  "grade": "<one of: F, D, C, C+, B-, B, B+, A-, A, A+>",
  "feedback_good": "<one concise sentence: what they did well>",
  "feedback_improve": "<one concise sentence: the single most impactful thing to do better next call>"
}`

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key':         anthropicKey,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        body: JSON.stringify({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 250,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (res.ok) {
        const completion = await res.json()
        const rawText = completion.content?.[0]?.text?.trim() || '{}'
        const parsed = JSON.parse(rawText)
        if (GRADES.includes(parsed.grade as Grade)) grade = parsed.grade as Grade
        if (typeof parsed.feedback_good    === 'string' && parsed.feedback_good)    feedbackGood    = parsed.feedback_good
        if (typeof parsed.feedback_improve === 'string' && parsed.feedback_improve) feedbackImprove = parsed.feedback_improve
      }
    } catch (err) {
      console.error('[grade-call] Grading failed (using defaults):', err)
    }
  }

  // ── 4. Write grade back to calls row ────────────────────────────────────
  await admin.from('calls').update({
    twilio_recording_sid: recordingSid ?? null,
    twilio_recording_url: recordingUrl ?? null,
    transcript,
    grade,
    feedback_good:    feedbackGood,
    feedback_improve: feedbackImprove,
    graded_at:        new Date().toISOString(),
  }).eq('id', callRow.id)

  // ── 5. Insert bell notification for the rep (Prompt 226 — respect Settings
  //       > Notifications toggle; empty/missing = enabled, matching the
  //       opt-out default used everywhere else this category list is gated) ──
  const notifPrefs = (callRow.rep as { notification_prefs?: Record<string, boolean> } | null)?.notification_prefs
  if (notifPrefs?.call_graded !== false) {
    const bizName = (callRow.lead as { business_name?: string } | null)?.business_name || 'your call'
    await admin.from('notifications').insert({
      profile_id: callRow.rep_id,
      type: 'call_graded',
      message: `Your call with ${bizName} was graded: ${grade}`,
      data: {
        call_id:          callRow.id,
        grade,
        feedback_good:    feedbackGood,
        feedback_improve: feedbackImprove,
      },
    })
  }

  console.log('[grade-call] Done —', callRow.id, grade)
  return json({ success: true, call_id: callRow.id, grade })
})
