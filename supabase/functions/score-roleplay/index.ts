// Scores a rep's roleplay call transcript using Claude.
// Takes the conversation transcript and returns structured feedback.
//
// Prompt 316(c) — root cause of "grading doesn't match the script" was NOT a
// bug in how scoring runs; it's that the grading prompt below hardcoded a
// STALE summary of what a good call looks like, frozen from before Prompt
// 309/312/315 reworked the live script. It told Claude the rep should "ask
// pain questions (missed calls, after-hours coverage, cost of a hire)" —
// three specific probes to check off — when the real discoveryScript.js
// opener (src/lib/discoveryScript.js) asks ONE broad, non-presumptive gate
// question and stops at the FIRST confirmed pain angle, of which there are
// 5 (calls slipping, scheduling chaos, slow response, unreliable coverage,
// cost of hiring) — "after-hours coverage" isn't even one of them. A rep who
// followed the real script correctly (one broad question, stop at one
// confirmed pain) would read to the old rubric as having under-asked. The
// rubric also never mentioned Vitals (3 numbers) or Pain Amplification (the
// dollar-math + "does it matter" check) as distinct steps, or that Handoff
// only ever throws exactly one objection. Rewritten below to match the
// actual current flow instead of a frozen paraphrase of it — score
// dimensions (opener/painDiscovery/objectionHandling/bookingAsk/tone) are
// unchanged, only the description of what "good" means per dimension.
//
// Prompt 317 — discoveryScript.js's money question is no longer one fixed
// missed-calls ask for every angle: after a pain is confirmed, the rep now
// asks a shared urgency question (Urgency Check) that bridges to the Indeed
// listing, THEN a money question that branches by which specific angle was
// named. Calls-slipping/slow-response/unreliable-coverage still share the
// old Vitals math unchanged; scheduling chaos gets its own double-booking/
// wasted-time question and pain-amplification line (time and a bounced
// customer, not a dollar figure); cost-of-hiring skips a numbers-ask
// entirely and reflects the prospect's OWN already-posted labor cost back at
// them. The old rubric only described the calls-based path as if it were
// the only one — grading a rep who correctly took the scheduling or
// cost-of-hiring branch against calls-based Vitals language would read as a
// miss. painDiscovery's description below now covers Urgency Check + all
// three money-question variants, not just the calls-based one.
//
// Prompt 318 — Urgency Check itself is no longer one fixed bridge line. It's
// adaptive: a primary line always fires ("how long's this been going on?"),
// and a conditional follow-up (one of two variants) only fires if that
// answer doesn't already cover duration plus some sense of ongoing cost or
// timeline. A rep who correctly skips the follow-up because the prospect's
// first answer already covered it is doing it right, not asking fewer
// questions than they should — the old "same question regardless" framing
// would have read a clean single-question pass as under-asking.
//
// Prompt 319 — the Money Question stage (calls-shaped/scheduling variants
// only, not hiring-cost) now opens with a one-beat yes/no confirm ("are you
// actually missing calls?" / "is scheduling actually the main headache?")
// before the quantifying question, since a prospect can land on an angle
// loosely at the opener gate and then say no when asked to actually quantify
// it. A rep who gets a "no" here and correctly re-asks a short "is it more
// X or Y" instead of forcing a number is doing real pain-discovery, not
// missing a beat — score it the same as (or better than) a rep who never hit
// a "no" at all. Only score it down if the rep pushes ahead and forces a
// number anyway after a prospect denies the gate.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TranscriptEntry {
  role: 'agent' | 'user'
  content: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { transcript } = await req.json() as { transcript: TranscriptEntry[] }

    if (!transcript?.length) {
      return new Response(
        JSON.stringify({ error: 'No transcript provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const demoMode = Deno.env.get('DEMO_MODE') === 'true'
    const anthropicKey = demoMode ? null : Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) {
      if (demoMode) {
        // DEMO_MODE — realistic pre-baked score, no Anthropic call, same shape as the live path.
        return new Response(
          JSON.stringify({
            scores: { opener: 2, painDiscovery: 2, objectionHandling: 1, bookingAsk: 2, tone: 2 },
            total: 9,
            maxTotal: 12,
            summary: 'Solid call — clean opener and good pain discovery. Objection handling felt a little rushed; slow down and let the prospect finish before pivoting to the close.',
            tips: ['Pause after pain questions instead of filling silence', 'Acknowledge the objection before reframing it', 'Confirm the booked time back to the prospect explicitly'],
            highlights: ['Referenced the Indeed posting naturally in the opener', 'Asked about after-hours coverage, not just missed calls'],
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      // Return a default score if Claude isn't available
      return new Response(
        JSON.stringify({
          scores: { opener: 1, painDiscovery: 1, objectionHandling: 1, bookingAsk: 1, tone: 1 },
          total: 5,
          maxTotal: 12,
          summary: 'Call completed. Set ANTHROPIC_API_KEY to enable AI scoring.',
          tips: ['Configure ANTHROPIC_API_KEY in Edge Function secrets for detailed feedback.'],
          notScored: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Format transcript for Claude
    const formatted = transcript
      .map(t => `${t.role === 'user' ? 'REP' : 'PROSPECT'}: ${t.content}`)
      .join('\n')

    const prompt = `You are a sales coach reviewing a cold call roleplay transcript, grading against our team's actual current script — not a generic cold-call rubric.

The rep was calling a prospect (Mike, HVAC owner) who was advertising for a receptionist on Indeed. The real script the rep is trained on has 5 stages, in this order:

1. Opener — confirm the business, reference the Indeed posting, then ask ONE broad, non-presumptive gate question about how they handle calls day-to-day (never a leading "you're missing calls, right?"). The rep should stop probing as soon as ONE pain angle is confirmed — any of: calls slipping through, scheduling chaos, slow response, unreliable coverage, or cost of hiring. Continuing to drill for more after one lands is a mistake, not a strength; a genuinely solid "we've got it covered, no gap" answer is a valid call-ending outcome, not a rep failure.
2. Urgency Check — adaptive, not a fixed single line. The rep always asks a primary question tying urgency to the fact they're already hiring for this ("how long's this been going on?"). A follow-up question (either about what's happening in the meantime, or how soon they want the role filled) only gets asked if the prospect's first answer was thin — didn't already establish duration plus some sense of ongoing cost or timeline. A rep who correctly skips the follow-up because the first answer already covered it should score the SAME as one who asked it and got a thin answer — don't penalize skipping it as under-asking, and don't penalize asking both back-to-back regardless of the answer as over-asking only if the first answer was genuinely thin.
3. Money Question (branches by angle, all three variants are correct — do not penalize a rep for asking a different money question than you expected):
   - Calls slipping / slow response / unreliable coverage: a one-beat yes/no confirm ("are you actually missing calls?") before quantifying — required, don't dock a rep for asking it. On a "yes," exactly 3 Vitals numbers (monthly call volume, missed/mishandled calls per day, average ticket value), then a Pain Amplification line stating the dollar cost (monthly/annual) plainly, then a single question checking whether it matters to the prospect. On a "no," the rep should re-ask a short "is it more X or Y" instead of forcing a number — this is a correct pain-discovery recovery, not a missed beat; only dock points if the rep forces a number in anyway after a genuine denial.
   - Scheduling chaos: same confirm-first pattern ("is scheduling actually the main headache?") before its own quantifying question about how many appointments get double-booked/mixed up per month and how much time gets burned untangling the calendar, then a pain-amplification line about lost time and a bounced customer — NOT a dollar figure, this angle is intentionally not calls-based. Same rule on a "no": re-asking instead of forcing a number is correct.
   - Cost of hiring: no confirm gate and no numbers-ask at all — the rep should reflect the prospect's own already-posted labor cost back at them rather than asking them to state a number. A rep correctly skipping straight to that reflection here is doing it right, not skipping a step.
4. Handoff & Book — the rep hands off to "our team," pitches the AI receptionist in plain terms, and handles exactly ONE objection if one comes up (info-first, no time this week, who-is-this, cost, or general hesitation are all valid real objections — handling any one of them well is a pass, the transcript won't contain all of them in a single call).
5. Close — confirm the picked day/time back, get a callback number, stop talking. A short, clean close is correct, not incomplete.

Score this call on each dimension (integers only), judged against the ACTUAL flow above, not a generic sales-call template:

TRANSCRIPT:
${formatted}

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "scores": {
    "opener": <0-2>,
    "painDiscovery": <0-3>,
    "objectionHandling": <0-2>,
    "bookingAsk": <0-2>,
    "tone": <0-3>
  },
  "total": <sum, 0-12>,
  "maxTotal": 12,
  "summary": "<2-3 sentence honest assessment>",
  "tips": ["<specific tip 1>", "<specific tip 2>", "<specific tip 3>"],
  "highlights": ["<thing they did well>", "<another good thing>"]
}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      throw new Error(`Claude API error: ${await res.text()}`)
    }

    const completion = await res.json()
    const text = completion.content?.[0]?.text || '{}'

    let scoreData
    try {
      scoreData = JSON.parse(text)
    } catch {
      // Fallback if Claude returns something non-JSON
      scoreData = {
        scores: { opener: 1, painDiscovery: 1, objectionHandling: 1, bookingAsk: 1, tone: 1 },
        total: 5,
        maxTotal: 12,
        summary: 'Call completed. Analysis unavailable.',
        tips: ['Keep practicing — consistency is key.'],
        highlights: [],
      }
    }

    return new Response(
      JSON.stringify(scoreData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[score-roleplay]', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
