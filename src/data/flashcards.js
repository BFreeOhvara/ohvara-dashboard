// Setter training flashcards — rewritten 2026-06-12 for setter-only knowledge.
// 48 cards across 6 categories: pipeline, discovery, objections, booking,
// niches, mindset. No pricing, packages, commissions, or closer-side info —
// the setter's job is pain discovery and booking the 15-minute call, period.
// Mastered state tracked in localStorage key: 'ohvara_flashcard_mastered'

export const FLASHCARDS = [

  // ═══════════════════════════════════════
  // CATEGORY 1: PIPELINE (8 cards)
  // ═══════════════════════════════════════
  {
    id: 1, category: 'pipeline',
    front: 'The 4 call outcomes you can set after a dial.',
    back: 'Appointment Booked (green), No Answer (gray), Not Interested (red), Follow-Up (amber). Every completed dial gets one — log it honestly and the pipeline handles the rest.'
  },
  {
    id: 2, category: 'pipeline',
    front: 'What happens to a lead after you mark No Answer?',
    back: 'It stays visible in your No Answer tab for the rest of the day, then enters a 24-hour pool and gets redistributed to a random active rep as a fresh New lead.'
  },
  {
    id: 3, category: 'pipeline',
    front: 'What happens to a lead after you mark Follow-Up?',
    back: 'It leaves your daily batch and returns to YOUR list on the date and time you chose, flagged amber with the reason you wrote — so you call back with full context.'
  },
  {
    id: 4, category: 'pipeline',
    front: 'What happens to a lead after you mark Not Interested?',
    back: 'It stays in your Not Interested tab for the rest of the day, then archives permanently at end of day. It never re-enters any batch and is never contacted again — so only use it for hard refusals.'
  },
  {
    id: 5, category: 'pipeline',
    front: 'Soft brush-off ("not right now") vs. hard no ("stop calling") — which status?',
    back: 'Soft brush-off → Follow-Up with a date and reason. Hard no → Not Interested. Not Interested is permanent — don\'t burn a lead that was just busy today.'
  },
  {
    id: 6, category: 'pipeline',
    front: 'What happens when you mark Appointment Booked?',
    back: 'Set the appointment date and time in the modal. The lead goes straight to the closer\'s pipeline with your notes and the scheduled time — your part is done.'
  },
  {
    id: 7, category: 'pipeline',
    front: 'Where do your 150 daily leads come from?',
    back: 'Auto-assigned every night: your unworked New leads roll over first, then fresh leads from the pool top you up to 150. Returned Follow-Ups arrive on their scheduled day.'
  },
  {
    id: 8, category: 'pipeline',
    front: 'Pre-Call Notes vs. Call Notes — what goes where?',
    back: 'Pre-Call Notes: research before you dial — who owns it, reviews, hiring posts. Call Notes: what happened on the call — pain points, who answered, best time to retry.'
  },

  // ═══════════════════════════════════════
  // CATEGORY 2: DISCOVERY (8 cards)
  // ═══════════════════════════════════════
  {
    id: 9, category: 'discovery',
    front: 'The first discovery question, word for word.',
    back: '"When a customer calls and everyone\'s on a job — what happens to that call?" Then be quiet and let them answer.'
  },
  {
    id: 10, category: 'discovery',
    front: 'The second discovery question.',
    back: '"Roughly how many calls a week would you say go to voicemail?" You\'re getting them to put their own number on the problem.'
  },
  {
    id: 11, category: 'discovery',
    front: 'The third discovery question.',
    back: '"And of those, how many do you think actually leave a message versus just calling the next company on the list?" This makes the lost-job cost real.'
  },
  {
    id: 12, category: 'discovery',
    front: 'The after-hours question — and why it works.',
    back: '"What happens when someone calls at 7pm with an emergency?" After-hours and weekends are where even businesses with office help lose jobs — almost nobody has that covered.'
  },
  {
    id: 13, category: 'discovery',
    front: 'Why ask questions instead of explaining the problem to them?',
    back: 'A problem THEY describe out loud is real to them. If you tell them, it\'s sales talk they can argue with. Every question should make the problem bigger in their head.'
  },
  {
    id: 14, category: 'discovery',
    front: 'What are you listening for while they answer?',
    back: 'Pain signals: missed calls, voicemail, jobs lost to competitors, after-hours gaps, "my wife handles the phones", hiring struggles. Write them down — they go in your call notes.'
  },
  {
    id: 15, category: 'discovery',
    front: 'They give you a number ("we miss maybe 8 calls a week"). What do you do with it?',
    back: 'Reflect it back as money using THEIR numbers: "So if even 3 of those 8 are real jobs at $400 each — that\'s thousands a month walking to a competitor." A number they gave you is a number they believe.'
  },
  {
    id: 16, category: 'discovery',
    front: 'What does a good open-ended question look like?',
    back: 'Starts with "what", "how", or "who" and can\'t be answered yes/no. "Who handles the phones when the crew\'s out?" beats "Do you miss calls?" — one starts a story, the other ends one.'
  },

  // ═══════════════════════════════════════
  // CATEGORY 3: OBJECTIONS (8 cards)
  // ═══════════════════════════════════════
  {
    id: 17, category: 'objections',
    front: '"I\'m not interested."',
    back: '"Totally fair — most owners say that until they see the missed-call math. One question and I\'ll let you go: what happens to a call you can\'t answer right now?"'
  },
  {
    id: 18, category: 'objections',
    front: '"I\'m too busy right now."',
    back: '"That\'s exactly why I called — this is about getting you hours back, not taking them. Let\'s grab 15 minutes this week instead: Tuesday or Thursday?"'
  },
  {
    id: 19, category: 'objections',
    front: '"Send me an email."',
    back: '"Happy to — but the email won\'t mean much without your numbers. Let\'s do 15 minutes live and you\'ll actually see what your missed calls cost. Tuesday or Thursday?"'
  },
  {
    id: 20, category: 'objections',
    front: '"How did you get my number?" / "What is this about?"',
    back: 'Be straight: "Saw your posting on Indeed for the receptionist position — figured I\'d reach out directly. How\'s that search going?" The posting is WHY your call is relevant.'
  },
  {
    id: 21, category: 'objections',
    front: '"How much does it cost?"',
    back: 'Never quote — redirect to the booking: "Depends on what you actually need — that\'s exactly what the 15-minute call figures out. Worst case, you learn what your missed calls are costing you."'
  },
  {
    id: 22, category: 'objections',
    front: '"We already have someone for that."',
    back: '"Nice — does that cover after-hours and weekends too? That\'s usually where the gap is. What happens to the 7pm emergency call?"'
  },
  {
    id: 23, category: 'objections',
    front: '"Call me back next month."',
    back: '"I can do that — but the calls you\'re missing don\'t wait. How about 15 minutes this week so you at least know the number? Then you decide." If they hold firm: Follow-Up with a date.'
  },
  {
    id: 24, category: 'objections',
    front: 'The golden rule when you hit an objection.',
    back: 'Acknowledge, reframe, ask ONE more question — never argue. One objection handled well earns the booking ask. TWO objections means let go gracefully and log Follow-Up or Not Interested.'
  },

  // ═══════════════════════════════════════
  // CATEGORY 4: BOOKING (8 cards)
  // ═══════════════════════════════════════
  {
    id: 25, category: 'booking',
    front: 'Your ONLY goal on every call.',
    back: 'Book the 15-minute call. Nothing else. No pitching, no pricing, no product explanation. Surface pain, book the call, get off the phone.'
  },
  {
    id: 26, category: 'booking',
    front: 'The booking ask, word for word.',
    back: '"Let\'s do a quick 15-minute call this week — I\'ll show you exactly how many calls you\'re missing and what they\'re worth. Does Tuesday afternoon or Thursday morning work better?"'
  },
  {
    id: 27, category: 'booking',
    front: 'Why offer two specific times instead of "when works for you?"',
    back: 'Two options makes choosing easy and keeps control. Open-ended scheduling stalls into "I\'ll check my calendar" — which means never.'
  },
  {
    id: 28, category: 'booking',
    front: 'They dodge your first booking ask. What now?',
    back: 'Answer their stall, then ask again with the same two-times format: "So like I said — Tuesday afternoon or Thursday morning?" Most bookings happen on the SECOND ask.'
  },
  {
    id: 29, category: 'booking',
    front: 'They said yes. The confirmation sequence.',
    back: '"Perfect — [day] at [time]. You\'ll get a text reminder. What\'s the best cell for that?" Confirm the number, confirm the time, end the call.'
  },
  {
    id: 30, category: 'booking',
    front: 'The biggest mistake right after they say yes.',
    back: 'Continuing to talk. Every extra sentence is a chance for them to back out. Confirm and get off the phone.'
  },
  {
    id: 31, category: 'booking',
    front: 'How do you describe the 15-minute call when they ask what it is?',
    back: '"A quick call where we put a real number on what your missed calls are costing — and you see if it\'s worth fixing. No commitment either way."'
  },
  {
    id: 32, category: 'booking',
    front: 'Right after booking — what do you do in the dashboard?',
    back: 'Mark Appointment Booked, set the exact date and time they agreed to, and write what pain they admitted in the call notes. The next call runs off YOUR notes.'
  },

  // ═══════════════════════════════════════
  // CATEGORY 5: NICHES (8 cards)
  // ═══════════════════════════════════════
  {
    id: 33, category: 'niches',
    front: 'Roofing — their day, and why they miss calls.',
    back: 'Crews are on roofs from morning to dark; the owner is often up there too or driving between estimates. Nobody can grab a phone on a roof — and storm season doubles the call volume overnight.'
  },
  {
    id: 34, category: 'niches',
    front: 'HVAC — their day, and why they miss calls.',
    back: 'Techs spend the day in attics and crawlspaces; summer and winter bring emergency surges. A homeowner with no AC in July calls down the list until someone answers — voicemail loses the job.'
  },
  {
    id: 35, category: 'niches',
    front: 'Electrical — their day, and why they miss calls.',
    back: 'The owner is usually the lead electrician — hands inside a panel, on a ladder, or mid-inspection. Calls come in while they\'re physically unable to answer, and callbacks happen after dinner if at all.'
  },
  {
    id: 36, category: 'niches',
    front: 'Landscaping — their day, and why they miss calls.',
    back: 'Outdoor crews running route schedules with mowers and blowers going — they literally can\'t hear the phone. Spring rush means quotes pile up, and the slowest to respond loses the yard.'
  },
  {
    id: 37, category: 'niches',
    front: 'Concrete — their day, and why they miss calls.',
    back: 'A pour can\'t be paused — once the truck arrives it\'s hours of committed work, often starting at dawn. Calls during a pour go straight to voicemail, and big jobs book with whoever picks up.'
  },
  {
    id: 38, category: 'niches',
    front: 'Pressure washing — their day, and why they miss calls.',
    back: 'Usually a solo operator or tiny crew, on a ladder or running a loud rig in gloves. Most jobs are quoted by phone — a missed call IS a missed job, same day, to the next guy on Google.'
  },
  {
    id: 39, category: 'niches',
    front: 'Hotshot trucking — their day, and why they miss calls.',
    back: 'Owner-operators driving long hauls — they can\'t (and legally shouldn\'t) answer while hauling. But loads get booked by phone, so every missed call while driving is lost revenue.'
  },
  {
    id: 40, category: 'niches',
    front: 'Towing — their day, and why they miss calls.',
    back: 'Tow calls are NOW or never — a stranded driver calls the next company within a minute. Demand runs 24/7, drivers are mid-hookup on a highway shoulder, and one missed dispatch call is a lost tow.'
  },

  // ═══════════════════════════════════════
  // CATEGORY 6: MINDSET (8 cards)
  // ═══════════════════════════════════════
  {
    id: 41, category: 'mindset',
    front: 'The tone rule for calling trades & field-service owners.',
    back: 'Direct, no-nonsense, peer-to-peer. Talk like someone who knows job sites, not like a telemarketer. They respect straight talk and hang up on scripts.'
  },
  {
    id: 42, category: 'mindset',
    front: 'Pacing — the two physical adjustments before you speak.',
    back: 'Slow down and lower your tone. Fast and high-pitched reads as nervous telemarketer; slow and low reads as a busy equal who has a reason to call.'
  },
  {
    id: 43, category: 'mindset',
    front: 'How to use the script without sounding robotic.',
    back: 'Know the QUESTIONS cold, not the sentences. Study each section until you can deliver it from memory in your own words — reading kills calls in the first five seconds.'
  },
  {
    id: 44, category: 'mindset',
    front: 'Active listening — what it actually means on a call.',
    back: 'Ask, then shut up. Don\'t plan your next line while they talk — react to what they actually said and use their exact words back. People keep talking to someone who heard them.'
  },
  {
    id: 45, category: 'mindset',
    front: 'The prospect goes silent or gives one-word answers.',
    back: 'Ask an easy, concrete question about their own business: "How many guys do you have out on jobs right now?" People always answer questions about their own world.'
  },
  {
    id: 46, category: 'mindset',
    front: 'Silence after you ask a question — what do you do?',
    back: 'Nothing. Let it sit. Silence means they\'re thinking, and whoever speaks first usually concedes. Filling the gap answers your own question for them and lets them off the hook.'
  },
  {
    id: 47, category: 'mindset',
    front: 'How to think about rejection.',
    back: 'A "no" isn\'t about you — they\'re rejecting an interruption, not a person. Log the honest outcome, take one breath, dial the next lead. The list resets tomorrow either way.'
  },
  {
    id: 48, category: 'mindset',
    front: 'The numbers mindset for a full rep day.',
    back: 'It\'s a volume game: 150 leads, every dial logged honestly, 3-5 bookings is a great day. Consistency beats intensity — the rep who dials every day beats the rep who binges and burns out.'
  },
]

export const CATEGORY_LABELS = {
  pipeline:   'Pipeline',
  discovery:  'Discovery',
  objections: 'Objections',
  booking:    'Booking',
  niches:     'Niches',
  mindset:    'Mindset',
}

export const CATEGORY_COLORS = {
  pipeline:   'var(--info)',
  discovery:  'var(--accent)',
  objections: 'var(--danger)',
  booking:    'var(--success)',
  niches:     'var(--warning)',
  mindset:    'var(--text-secondary)',
}
