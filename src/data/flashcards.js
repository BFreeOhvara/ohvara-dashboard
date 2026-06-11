// 100 training flashcards — Objection Handling, Profile A Scripts, Product Knowledge
// Refreshed 2026-06-11: 4-status pipeline, current pricing ($497/$797/$1,297/$1,797
// + $497 setup), commission structure, and the 3 opener variations.
// Mastered state tracked in localStorage key: 'ohvara_flashcard_mastered'

export const FLASHCARDS = [

  // ═══════════════════════════════════════
  // CATEGORY 1: OBJECTION HANDLING (35 cards)
  // ═══════════════════════════════════════
  {
    id: 1, category: 'objection',
    front: '"I\'m not interested."',
    back: '"Totally fair — most owners say that until they see the missed-call math. One question and I\'ll let you go: what happens to a call you can\'t answer right now?"'
  },
  {
    id: 2, category: 'objection',
    front: '"We already have someone for that."',
    back: '"Nice — does that cover after-hours and weekends too? That\'s usually where the gap is. What happens to the 7pm emergency call?"'
  },
  {
    id: 3, category: 'objection',
    front: '"I\'m too busy right now."',
    back: '"That\'s exactly why I called. This takes 15 minutes and it\'s about getting you hours back, not taking them. When\'s better this week — Tuesday or Thursday?"'
  },
  {
    id: 4, category: 'objection',
    front: '"How did you get my number?"',
    back: '"Saw your job posting on Indeed for a receptionist — figured I\'d reach out directly. Do you have 2 minutes?"'
  },
  {
    id: 5, category: 'objection',
    front: '"What is this about?"',
    back: '"Saw you\'re hiring for the phones. We help [niche] companies handle those calls with AI so you don\'t have to hire someone. Worth a 15-minute conversation?"'
  },
  {
    id: 6, category: 'objection',
    front: '"We\'re not looking for anything right now."',
    back: '"Makes sense. Just curious — are you still getting calls you can\'t get to when you\'re out on jobs? That\'s usually why businesses end up talking to us."'
  },
  {
    id: 7, category: 'objection',
    front: '"Send me an email."',
    back: '"Happy to — but honestly the email won\'t mean much without the numbers. Let\'s grab 15 minutes and I\'ll walk you through it live. Tuesday or Thursday?"'
  },
  {
    id: 8, category: 'objection',
    front: '"I can\'t afford it right now."',
    back: '"Understood. What were you planning to pay the receptionist you\'re hiring? Most clients spend less with us than one hire — and we answer 24/7."'
  },
  {
    id: 9, category: 'objection',
    front: '"We tried something like this before and it didn\'t work."',
    back: '"What happened with it? Usually it comes down to setup — if the agent wasn\'t trained on your business specifically, it sounds generic. Ours isn\'t."'
  },
  {
    id: 10, category: 'objection',
    front: '"I need to talk to my partner/wife first."',
    back: '"Of course. Would it make sense to set up a quick call with both of you? You get every question answered at once and skip the phone tag."'
  },
  {
    id: 11, category: 'objection',
    front: '"Is this a robot calling me?" / "Is this AI?"',
    back: '"Ha — no, I\'m real. But funny you ask, because the AI we set up sounds this natural. That\'s kind of the point. Got 2 minutes?"'
  },
  {
    id: 12, category: 'objection',
    front: '"My customers want to talk to a real person."',
    back: '"They want their call ANSWERED. Right now some of them get voicemail. Would they rather leave a message, or talk to something that books their job instantly?"'
  },
  {
    id: 13, category: 'objection',
    front: '"AI can\'t handle my business — it\'s too complicated."',
    back: '"The agent is trained on YOUR business — your services, your pricing, your scheduling rules. It only handles what you tell it to and passes the rest to you."'
  },
  {
    id: 14, category: 'objection',
    front: '"What if the AI says something wrong?"',
    back: '"It only works from the script and info you approve. And every call is recorded and transcribed, so you can review anything. It never improvises pricing or promises."'
  },
  {
    id: 15, category: 'objection',
    front: '"Just text me the details."',
    back: '"Sure — what\'s the best number? And while I have you: roughly how many calls a week go to voicemail when the crew\'s out? I\'ll include the math for that."'
  },
  {
    id: 16, category: 'objection',
    front: '"How much does it cost?" (on the rep call)',
    back: 'Don\'t pitch pricing — that\'s the closer\'s job. "Depends on what you actually need — that\'s exactly what the 15-minute call figures out. Worst case you learn what your missed calls cost."'
  },
  {
    id: 17, category: 'objection',
    front: '"We don\'t miss that many calls."',
    back: '"Maybe — most owners guess low. Quick math: even 5 missed calls a week, if 2 are real jobs at $400, that\'s over $3K a month. Want to see your real number?"'
  },
  {
    id: 18, category: 'objection',
    front: '"I already use an answering service."',
    back: '"How\'s that working? Most answering services just take messages. Ours actually books the job into your calendar and texts the customer back. Big difference."'
  },
  {
    id: 19, category: 'objection',
    front: '"Call me back next month."',
    back: '"I can do that — but the calls you\'re missing don\'t wait. How about 15 minutes this week so you at least know the number you\'re losing? Then you decide."'
  },
  {
    id: 20, category: 'objection',
    front: '"I just posted that job, I want a real hire."',
    back: '"Totally get it. While you\'re interviewing — which takes most owners 4-6 weeks — we can cover the phones starting this week. A lot of clients end up not needing the hire."'
  },
  {
    id: 21, category: 'objection',
    front: '"You\'re the fifth person to call me today."',
    back: '"Then I\'ll be the fastest. One question: when your crew\'s on a roof and the phone rings, who answers it? ... That\'s the whole reason I called."'
  },
  {
    id: 22, category: 'objection',
    front: '"I don\'t trust AI with my customers."',
    back: '"Fair. That\'s why we set it up so you hear the recordings from day one. Most owners stop checking after a week — it handles calls better than a rushed guy on a ladder."'
  },
  {
    id: 23, category: 'objection',
    front: '"My niece/my wife handles the phones."',
    back: '"Perfect — so someone IS on it. What happens when they\'re unavailable, or after 6pm? We\'re usually the backup that catches what humans can\'t."'
  },
  {
    id: 24, category: 'objection',
    front: '"Is this one of those spam call centers?"',
    back: '"Nope — small team, and I called you specifically because you\'re hiring for the phones. That posting is why this is relevant. Two minutes?"'
  },
  {
    id: 25, category: 'objection',
    front: 'Prospect goes silent / one-word answers.',
    back: 'Ask an easy, concrete question to restart them: "How many guys do you have out on jobs right now?" People answer questions about their own business.'
  },
  {
    id: 26, category: 'objection',
    front: 'Prospect is angry about being cold called.',
    back: '"You\'re right, and I\'ll be 10 seconds: you\'re hiring for the phones, we replace that hire with AI for less. If that\'s ever interesting, I\'ll leave you my number." Stay calm, never argue.'
  },
  {
    id: 27, category: 'objection',
    front: '"We\'re slow right now, we don\'t need more calls."',
    back: '"That\'s exactly when a missed call hurts most — every job counts when it\'s slow. And when it picks back up, you\'ll be covered. Worth 15 minutes?"'
  },
  {
    id: 28, category: 'objection',
    front: '"What\'s the catch?"',
    back: '"No catch — flat monthly rate, no contracts. If it doesn\'t book you more jobs than it costs, you cancel. That\'s the whole deal."'
  },
  {
    id: 29, category: 'objection',
    front: '"I had a bad experience with a marketing agency."',
    back: '"We\'re not marketing — we don\'t promise leads. We answer the calls you\'re ALREADY getting and stop them from going to voicemail. Different problem."'
  },
  {
    id: 30, category: 'objection',
    front: 'Second objection on the same call.',
    back: 'Let go gracefully — two objections means not now. "No problem, I\'ll let you run. If the phones ever get away from you, you\'ve got my number." Mark Follow-Up with a reason, or Not Interested.'
  },
  {
    id: 31, category: 'objection',
    front: '"Will this replace my office manager?"',
    back: '"No — it takes the phone interruptions OFF her plate so she can do everything else. Most office managers love it. The dispatcher version even handles scheduling calls."'
  },
  {
    id: 32, category: 'objection',
    front: '"How is this different from my voicemail?"',
    back: '"Voicemail loses the customer — 8 out of 10 callers won\'t leave a message, they call your competitor. Ours answers live, books the job, and texts them a confirmation."'
  },
  {
    id: 33, category: 'objection',
    front: '"I need to think about it."',
    back: '"Totally fine — what specifically do you want to think over? Usually I can answer it right now in 30 seconds and save you the mental load."'
  },
  {
    id: 34, category: 'objection',
    front: '"We only take referral work, we don\'t need the phone."',
    back: '"Referrals still call you. When a referral hits voicemail, that\'s a warm job walking away. That\'s the most expensive missed call there is."'
  },
  {
    id: 35, category: 'objection',
    front: 'The golden rule of objection handling.',
    back: 'Acknowledge, reframe, ask ONE more question. Never argue. One objection handled well earns the close — two objections means let go gracefully and log the outcome.'
  },

  // ═══════════════════════════════════════
  // CATEGORY 2: SCRIPTS & OPENERS (35 cards)
  // ═══════════════════════════════════════
  {
    id: 36, category: 'script',
    front: 'Opener #1 — Indeed phone/receptionist lead. First two lines.',
    back: '"Hey, is this [Business Name]? [First name]? Perfect — I\'ll be quick, I know you\'re mid-day." Then: "I was looking at your Indeed listing for the receptionist position — how\'s that search going?"'
  },
  {
    id: 37, category: 'script',
    front: 'Opener #2 — Indeed dispatcher/coordinator lead. Key question.',
    back: '"I saw you\'re looking for a dispatcher — is that because scheduling and routing calls is eating up your day?" They posted the job because they\'re drowning. Let THEM say it.'
  },
  {
    id: 38, category: 'script',
    front: 'Opener #3 — Maps lead (no website / low reviews). Key question.',
    back: '"I was looking at your Google listing — are you the owner? Quick question: when someone finds you on Google and wants to reach out, where are they going right now?"'
  },
  {
    id: 39, category: 'script',
    front: 'Which opener for a lead with source = Google Maps?',
    back: 'Opener #3 — the Google listing angle. They don\'t know they have a problem until you make them picture a customer who can\'t find a website calling the competitor instead.'
  },
  {
    id: 40, category: 'script',
    front: 'The fallback line when there\'s no Indeed listing to reference.',
    back: '"I work with [niche] owners in [city] — quick question, are you the one who handles the phones when the crew\'s out on jobs?"'
  },
  {
    id: 41, category: 'script',
    front: 'What is the rep\'s ONLY goal on the call?',
    back: 'Book the 15-minute discovery call. Nothing else. No pitching, no pricing, no product explanation. Surface pain, book the call, get off the phone.'
  },
  {
    id: 42, category: 'script',
    front: 'Why are scripts question-based instead of pitch-based?',
    back: 'Questions make the prospect describe their own problem — a problem THEY said out loud is real to them. A pitch is something to argue with; their own words aren\'t.'
  },
  {
    id: 43, category: 'script',
    front: 'The 3 discovery questions, in order.',
    back: '1) "When a customer calls and everyone\'s on a job — what happens to that call?" 2) "Roughly how many calls a week go to voicemail?" 3) "How many leave a message vs. call the next company?"'
  },
  {
    id: 44, category: 'script',
    front: 'Pain amplification — the quick math line.',
    back: '"If you\'re missing 8 calls a week and even 3 are real jobs at, what, $400 each? That\'s close to $5K a month walking to a competitor." Always use THEIR numbers from discovery.'
  },
  {
    id: 45, category: 'script',
    front: 'Why use the prospect\'s numbers instead of your own?',
    back: 'A number they gave you is a number they believe. Your numbers are sales talk; their numbers are facts they\'ve already admitted.'
  },
  {
    id: 46, category: 'script',
    front: 'The after-hours pain question.',
    back: '"What happens when someone calls at 7pm with a burst pipe?" — after-hours and weekends are where even businesses with office staff lose jobs.'
  },
  {
    id: 47, category: 'script',
    front: 'The close — exact ask.',
    back: '"Let\'s do a quick 15-minute call this week — I\'ll show you exactly how many calls you\'re missing and what they\'re worth. Does Tuesday afternoon or Thursday morning work better?"'
  },
  {
    id: 48, category: 'script',
    front: 'Why offer two specific times instead of "when works for you?"',
    back: 'Two options makes choosing easy and keeps control. Open-ended scheduling stalls into "I\'ll check my calendar" — which means never.'
  },
  {
    id: 49, category: 'script',
    front: 'After they pick a time — the confirmation sequence.',
    back: '"Perfect — [day] at [time]. You\'ll get a text reminder. What\'s the best cell for that?" Confirm number, confirm time, END THE CALL. Don\'t keep selling after the yes.'
  },
  {
    id: 50, category: 'script',
    front: 'Biggest mistake after the prospect says yes to the meeting.',
    back: 'Continuing to talk. Every extra sentence is a chance for them to back out. Confirm and get off the phone.'
  },
  {
    id: 51, category: 'script',
    front: 'Tone rule for Profile A (trades & field services).',
    back: 'Direct, no-nonsense, peer-to-peer. Talk like someone who knows job sites, not like a telemarketer. Slow down, lower your tone.'
  },
  {
    id: 52, category: 'script',
    front: 'The goal of the opener (first 10 seconds).',
    back: 'Survive. Sound like a peer, not a telemarketer. The opener\'s only job is to earn the next 30 seconds — not to pitch.'
  },
  {
    id: 53, category: 'script',
    front: 'Profile A opening question (general).',
    back: '"How many calls do you think you\'re missing while your guys are out on jobs?"'
  },
  {
    id: 54, category: 'script',
    front: 'What do you do while the prospect answers a discovery question?',
    back: 'Shut up and listen. Every question should make the problem bigger in THEIR head. You\'re not telling them they have a problem — they\'re telling you.'
  },
  {
    id: 55, category: 'script',
    front: 'Mark the outcome: owner said "call me Thursday after 3."',
    back: 'Follow-Up — set the date/time to Thursday and the reason ("asked for Thursday after 3"). It returns to YOUR list on that date with the amber badge.'
  },
  {
    id: 56, category: 'script',
    front: 'Mark the outcome: rang six times, nobody picked up.',
    back: 'No Answer. It stays visible in your No Answer tab today, then enters the 24-hour pool and gets redistributed to an active rep tomorrow.'
  },
  {
    id: 57, category: 'script',
    front: 'Mark the outcome: owner said "never call this number again."',
    back: 'Not Interested — permanent do-not-contact. The lead is removed forever and the scrapers will never re-import it. Use it for real refusals, not soft brush-offs.'
  },
  {
    id: 58, category: 'script',
    front: 'Mark the outcome: booked the 15-minute call for Tuesday 2pm.',
    back: 'Appointment Booked — set the appointment date and time in the modal. It goes straight to the closer pipeline with your notes and the scheduled time.'
  },
  {
    id: 59, category: 'script',
    front: 'Soft brush-off ("not right now") vs. hard no — which status?',
    back: 'Soft brush-off → Follow-Up with a reason and a date. Hard no ("stop calling") → Not Interested. Not Interested is permanent — don\'t burn a lead that was just busy.'
  },
  {
    id: 60, category: 'script',
    front: 'What goes in Pre-Call Notes vs. Call Notes?',
    back: 'Pre-Call Notes: research before dialing — who owns it, reviews, hiring posts. Call Notes: what happened on the call — pain points, who answered, best time to retry.'
  },
  {
    id: 61, category: 'script',
    front: 'Why mention their Indeed posting in the first 15 seconds?',
    back: 'It\'s WHY the call is relevant. They\'re actively trying to solve this exact problem — referencing the posting flips you from cold caller to someone answering their ad.'
  },
  {
    id: 62, category: 'script',
    front: 'The Maps lead pitch angle (no website).',
    back: 'A customer who finds them on Google and can\'t find a website calls the competitor with one. We bundle a professional website + AI phone coverage so every search becomes a call that gets answered.'
  },
  {
    id: 63, category: 'script',
    front: 'What the rep NEVER does on Call 1.',
    back: 'Never pitches the product, never quotes pricing, never explains packages. That\'s the closer\'s job on Call 2. Reps gather pain and book — that\'s it.'
  },
  {
    id: 64, category: 'script',
    front: 'How to handle "what does it cost?" without quoting.',
    back: '"Depends on what you actually need — that\'s what the 15-minute call figures out. The guy who runs those will show you the exact math against what a hire costs."'
  },
  {
    id: 65, category: 'script',
    front: 'Best line when the owner picks up annoyed mid-job.',
    back: '"Sounds like you\'re mid-job — I\'ll be 20 seconds. You\'re hiring for the phones; we fix that without a hire. Can I grab you Tuesday for 15 minutes instead?"'
  },
  {
    id: 66, category: 'script',
    front: 'Gatekeeper answers (office manager, spouse). What\'s the move?',
    back: 'Be straight, no tricks: "It\'s about the receptionist position you posted — is the owner the right person for that?" Gatekeepers pass along relevant calls.'
  },
  {
    id: 67, category: 'script',
    front: 'Voicemail — leave one or not?',
    back: 'Keep it under 15 seconds if you do: name, "about the receptionist posting", callback number. Then mark No Answer — the pipeline handles the retry automatically.'
  },
  {
    id: 68, category: 'script',
    front: 'How many dials before a lead is "worked" for the day?',
    back: 'One real attempt logged with an honest outcome beats three rushed redials. Work the list, log every outcome — the pipeline brings leads back at the right time.'
  },
  {
    id: 69, category: 'script',
    front: 'The "second ask" — they dodge the first booking attempt.',
    back: 'Answer their stall, then ask again with the same two-times format: "So like I said — Tuesday afternoon or Thursday morning?" Most bookings happen on the second ask.'
  },
  {
    id: 70, category: 'script',
    front: 'Daily rhythm: what does a full rep day look like?',
    back: '150 leads in the batch, dial through the New tab, log every outcome honestly, hit the Follow-Ups when they return. Target: 3-5 booked appointments a day.'
  },

  // ═══════════════════════════════════════
  // CATEGORY 3: PRODUCT KNOWLEDGE (30 cards)
  // ═══════════════════════════════════════
  {
    id: 71, category: 'product',
    front: 'What does Ohvara sell?',
    back: 'AI phone agents for small businesses — a 24/7 AI receptionist/dispatcher that answers calls, books jobs, and texts customers back. Sold as a monthly subscription.'
  },
  {
    id: 72, category: 'product',
    front: 'The four packages and monthly prices.',
    back: 'Basic $497/mo · Pro $797/mo · Premium $1,297/mo · Elite $1,797/mo. Every package also has a $497 one-time setup fee.'
  },
  {
    id: 73, category: 'product',
    front: 'The setup fee — amount and rule.',
    back: '$497, one-time, on every package, no exceptions. Always presented as separate from the monthly price.'
  },
  {
    id: 74, category: 'product',
    front: 'What\'s in Basic ($497/mo)?',
    back: 'AI Receptionist with 24/7 inbound call handling + Missed Call Text Back. For owner-operators missing calls who need basic coverage.'
  },
  {
    id: 75, category: 'product',
    front: 'What\'s in Pro ($797/mo)?',
    back: 'Everything in Basic + Review Generation, Lead Follow-Up Automation, and Appointment Reminders. For growing businesses that want reviews and follow-up too.'
  },
  {
    id: 76, category: 'product',
    front: 'What\'s in Premium ($1,297/mo)?',
    back: 'Everything in Pro + AI Dispatcher and SMS Marketing. For established businesses automating the full front office.'
  },
  {
    id: 77, category: 'product',
    front: 'What\'s in Elite ($1,797/mo)?',
    back: 'Everything in Premium + a professional website, multiple AI agents (up to 5 lines), priority support, and a custom reporting dashboard.'
  },
  {
    id: 78, category: 'product',
    front: 'ROI anchor for Basic.',
    back: 'Basic at $497/mo replaces a $2,800+/mo receptionist. Always anchor against the cost of the human hire, never against competitors.'
  },
  {
    id: 79, category: 'product',
    front: 'ROI anchors for Pro, Premium, and Elite.',
    back: 'Pro replaces a $3,500+/mo receptionist + marketing assistant. Premium replaces $4,500+/mo receptionist + dispatcher. Elite replaces $6,000+/mo full office staff.'
  },
  {
    id: 80, category: 'product',
    front: 'Why is Elite priced at $1,797 specifically?',
    back: 'It stays under the $2K psychological barrier and keeps a clean staircase: $497 → $797 → $1,297 → $1,797 — each step is a $300-500 jump.'
  },
  {
    id: 81, category: 'product',
    front: 'The two-call close — who does what?',
    back: 'Call 1 (rep): question-based pain discovery, book the 15-minute call. Call 2 (closer): reviews the pain, AI recommends the package, pitches, closes, sends Stripe links.'
  },
  {
    id: 82, category: 'product',
    front: 'How many Stripe links per close, and what are they?',
    back: 'Two, generated the moment a tier is recommended: one for the $497 setup fee, one for the monthly subscription. Sent immediately — never deferred.'
  },
  {
    id: 83, category: 'product',
    front: 'Setter commission.',
    back: '50% of the setup fee = $248.50 per CLOSED deal. Paid only when the closer closes — not on bookings. No recurring cut. At 3 closes/week that\'s ~$3,000/month.'
  },
  {
    id: 84, category: 'product',
    front: 'Closer (Nate) commission.',
    back: '50% of the setup fee ($248.50) + 50% of monthly recurring, forever. Nate owns the client relationship from close onward — all client questions go to him.'
  },
  {
    id: 85, category: 'product',
    front: 'Brayden\'s cut.',
    back: '0% of setup, 50% of monthly recurring. He owns all the tech — agents, dashboard, infrastructure. Income is 100% recurring.'
  },
  {
    id: 86, category: 'product',
    front: 'On a Pro close ($797/mo), who gets what?',
    back: 'Setup $497: setter $248.50 + Nate $248.50. Monthly $797: Brayden $398.50 + Nate $398.50 — every month the client stays.'
  },
  {
    id: 87, category: 'product',
    front: 'Profile A — the niches we call.',
    back: 'Trades & field services: roofing, HVAC, electrical, landscaping, concrete, pressure washing, hotshot trucking, towing, oilfield services, transportation.'
  },
  {
    id: 88, category: 'product',
    front: 'Why are Indeed leads warm, not cold?',
    back: 'They posted a job for a receptionist or dispatcher — they\'re already problem-aware and actively paying to solve it. We\'re a faster, cheaper answer to the exact problem they posted about.'
  },
  {
    id: 89, category: 'product',
    front: 'What makes a Google Maps lead a fit?',
    back: 'A Profile A business with no website and fewer than 50 reviews. They\'re invisible online — web agency bundle + AI phone coverage is the pitch.'
  },
  {
    id: 90, category: 'product',
    front: 'The 4 call outcomes in the dashboard.',
    back: 'Appointment Booked (green) → closer pipeline with a scheduled time. No Answer (gray) → 24hr pool, redistributed. Not Interested (red) → permanent do-not-contact. Follow-Up (amber) → returns to you on your chosen date.'
  },
  {
    id: 91, category: 'product',
    front: 'What happens to a No Answer lead after you mark it?',
    back: 'It stays in your No Answer tab for the rest of the day, then sits in a 24-hour shared pool and gets redistributed to a random active rep as a fresh New lead.'
  },
  {
    id: 92, category: 'product',
    front: 'What happens to a Follow-Up lead?',
    back: 'It leaves your daily batch and comes back to YOUR list on the date you chose, flagged amber with your reason — so you call with full context.'
  },
  {
    id: 93, category: 'product',
    front: 'What happens to a Not Interested lead?',
    back: 'Permanent do-not-contact. It never re-enters any batch, and the scrapers dedupe against it forever. That\'s why it\'s only for hard refusals.'
  },
  {
    id: 94, category: 'product',
    front: 'Where do your 150 daily leads come from?',
    back: 'Auto-assigned every night: yesterday\'s unworked New leads roll over first, then fresh leads from the pool (Indeed + Google Maps scrapers) top you up to 150.'
  },
  {
    id: 95, category: 'product',
    front: 'How fast is a client live after paying?',
    back: 'About 48 hours: payment → onboarding form → agent built and trained on their business → phone number provisioned → live.'
  },
  {
    id: 96, category: 'product',
    front: 'What does Missed Call Text Back do?',
    back: 'If a call somehow slips through, the customer instantly gets a text: "Sorry we missed you — what do you need?" The lead is saved instead of lost to a competitor.'
  },
  {
    id: 97, category: 'product',
    front: 'What is the discovery call?',
    back: 'A 15-minute call with the closer (Nate). Goal: understand the business pain. The closer then pitches the right package — that\'s the close, not the discovery.'
  },
  {
    id: 98, category: 'product',
    front: 'What does the AI Dispatcher (Premium+) handle?',
    back: 'Scheduling and routing calls — the coordination work a human dispatcher does: booking jobs into the calendar, routing urgent calls, confirming appointments by text.'
  },
  {
    id: 99, category: 'product',
    front: 'Contract terms — what do you tell a worried owner?',
    back: 'Month to month, no long-term contracts. If it doesn\'t book more jobs than it costs, they cancel. The product has to earn its keep every month.'
  },
  {
    id: 100, category: 'product',
    front: 'Ohvara\'s one-sentence pitch.',
    back: '"We replace the receptionist you\'re about to hire with an AI that works 24/7 for a fraction of the cost."'
  },
]

export const CATEGORY_LABELS = {
  objection: 'Objection Handling',
  script:    'Scripts & Openers',
  product:   'Product Knowledge',
}

export const CATEGORY_COLORS = {
  objection: 'var(--danger)',
  script:    'var(--accent)',
  product:   'var(--success)',
}
