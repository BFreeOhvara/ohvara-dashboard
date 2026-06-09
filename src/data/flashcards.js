// 100 training flashcards — Objection Handling, Profile A Scripts, Product Knowledge
// Mastered state tracked in localStorage key: 'ohvara_flashcard_mastered'

export const FLASHCARDS = [

  // ═══════════════════════════════════════
  // CATEGORY 1: OBJECTION HANDLING (35 cards)
  // ═══════════════════════════════════════
  {
    id: 1, category: 'objection',
    front: '"I\'m not interested."',
    back: '"Totally understand — most people I call aren\'t at first. Quick question before I let you go — how are you handling calls when your guys are out on jobs right now?"'
  },
  {
    id: 2, category: 'objection',
    front: '"We already have someone for that."',
    back: '"Perfect — are they handling after-hours calls too, or just during the day? The reason I ask is most businesses we work with had someone and still had gaps."'
  },
  {
    id: 3, category: 'objection',
    front: '"I\'m too busy right now."',
    back: '"I hear you — that\'s actually exactly why I\'m calling. Takes 15 minutes to show you how we handle the calls so you don\'t have to. When\'s a better time this week?"'
  },
  {
    id: 4, category: 'objection',
    front: '"How did you get my number?"',
    back: '"Saw your job posting on Indeed for a receptionist — figured I\'d reach out directly. Do you have 2 minutes?"'
  },
  {
    id: 5, category: 'objection',
    front: '"What is this about?"',
    back: '"Saw you\'re hiring a receptionist on Indeed. We help [niche] companies handle those calls with AI so you don\'t have to hire someone. Worth a 15-minute conversation?"'
  },
  {
    id: 6, category: 'objection',
    front: '"We\'re not looking for anything right now."',
    back: '"Makes sense. Just curious — are you still getting calls you can\'t get to when you\'re out on jobs? That\'s usually why businesses reach out to us."'
  },
  {
    id: 7, category: 'objection',
    front: '"Send me an email."',
    back: '"Absolutely — before I do, quick question: what\'s the biggest challenge with your current phone coverage? Helps me make sure I send you the right info."'
  },
  {
    id: 8, category: 'objection',
    front: '"I can\'t afford it right now."',
    back: '"Understood. What are you paying for the receptionist you\'re hiring? Most of our clients spend less with us than they would on one hire — and we work 24/7."'
  },
  {
    id: 9, category: 'objection',
    front: '"We tried something like this before and it didn\'t work."',
    back: '"What happened with it? I ask because most of the time it comes down to setup — if the agent wasn\'t trained on your business specifically, it\'ll sound generic. Ours isn\'t."'
  },
  {
    id: 10, category: 'objection',
    front: '"I need to talk to my partner/wife first."',
    back: '"Of course. Would it make sense to set up a quick call with both of you? That way you get all your questions answered at once and don\'t have to play phone tag."'
  },
  {
    id: 11, category: 'objection',
    front: '"Is this a robot calling me?"',
    back: '"Ha — no, this is [name]. I\'m a real person. We build AI systems for businesses though — that\'s actually why I\'m calling. You guys hiring a receptionist?"'
  },
  {
    id: 12, category: 'objection',
    front: '"We handle our own calls fine."',
    back: '"Good to hear. How do you handle it after hours or when everyone\'s on a job? That\'s usually where we find the gaps."'
  },
  {
    id: 13, category: 'objection',
    front: '"I don\'t believe AI can do this properly."',
    back: '"Fair — most people feel that way before they hear it. Our agents sound completely natural. Can I play you a 30-second demo on this call?"'
  },
  {
    id: 14, category: 'objection',
    front: '"Call me back in a few months."',
    back: '"I can do that. Just so I call at the right time — is there something specific you\'re waiting on, or just want to get through the busy season first?"'
  },
  {
    id: 15, category: 'objection',
    front: '"We\'re too small for something like this."',
    back: '"Actually our best clients are one to three person operations — that\'s exactly who benefits most. Every call you miss is a job going somewhere else."'
  },
  {
    id: 16, category: 'objection',
    front: '"How much does it cost?"',
    back: '"Starts at $497 a month — less than two weeks of a full-time hire. But I\'d rather show you what\'s included first so it makes sense. You free for 15 minutes this week?"'
  },
  {
    id: 17, category: 'objection',
    front: '"I\'ll think about it."',
    back: '"Of course. What part are you most unsure about? Sometimes I can answer it right now and save you the time."'
  },
  {
    id: 18, category: 'objection',
    front: '"We use an answering service already."',
    back: '"How\'s that working for you? Most answering services just take messages — ours actually qualifies leads, books appointments, and follows up automatically."'
  },
  {
    id: 19, category: 'objection',
    front: '"I don\'t have time for a call."',
    back: '"15 minutes — I\'ll be fast. I just want to show you what other [niche] companies are using to stop losing jobs to voicemail. What does your Thursday look like?"'
  },
  {
    id: 20, category: 'objection',
    front: '"We\'re fully booked right now."',
    back: '"That\'s a good problem — what happens when you get even more calls than you can handle? Do you have a way to capture those leads for later?"'
  },
  {
    id: 21, category: 'objection',
    front: '"I handle all the calls myself."',
    back: '"Respect that. What happens when you\'re on a job site and a new lead calls? That\'s usually the one that goes to a competitor."'
  },
  {
    id: 22, category: 'objection',
    front: '"My wife/employee handles calls."',
    back: '"Got it. What happens when they\'re off or you get calls after hours? That\'s usually the gap we help fill."'
  },
  {
    id: 23, category: 'objection',
    front: '"I\'ve never heard of Ohvara."',
    back: '"We\'re relatively new — started specifically with [niche] companies in mind. That\'s actually why I\'m calling — wanted to get a few local businesses set up and get some testimonials. Interested in hearing more?"'
  },
  {
    id: 24, category: 'objection',
    front: '"Just leave a voicemail."',
    back: '"I appreciate it — I\'ll keep it quick right now instead. You guys still looking for a receptionist or did you find someone?"'
  },
  {
    id: 25, category: 'objection',
    front: '"We use [competitor]."',
    back: '"How\'s that going for you? The reason I ask — we specifically built this for [niche] businesses, so the agent knows your industry. Most generic tools don\'t."'
  },
  {
    id: 26, category: 'objection',
    front: '"I don\'t like AI."',
    back: '"Totally valid. What specifically concerns you about it? Some of our best clients said the same thing — usually it\'s about it sounding robotic. Happy to address that."'
  },
  {
    id: 27, category: 'objection',
    front: '"We just hired someone."',
    back: '"Congrats — how\'s onboarding going? We actually work alongside human staff really well. What\'s their schedule like for after-hours?"'
  },
  {
    id: 28, category: 'objection',
    front: '"What\'s your cancellation policy?"',
    back: '"Month to month — no contracts. If it\'s not working for you after 30 days, you cancel and pay nothing more. That\'s how confident we are."'
  },
  {
    id: 29, category: 'objection',
    front: '"Is there a contract?"',
    back: '"No contracts — month to month. We keep clients by being good, not by locking them in."'
  },
  {
    id: 30, category: 'objection',
    front: '"I need to see results first."',
    back: '"Makes sense. We offer a 30-day window — if you\'re not seeing calls handled and leads followed up, cancel. No questions. Want to set up a quick call to go over exactly what that looks like?"'
  },
  {
    id: 31, category: 'objection',
    front: '"My business is seasonal."',
    back: '"Perfect actually — you can pause during slow months and activate when busy season hits. Means you\'re never paying when you don\'t need it."'
  },
  {
    id: 32, category: 'objection',
    front: '"I don\'t want my customers talking to a robot."',
    back: '"Understandable. Our agents don\'t sound like robots — they sound like a professional receptionist. I can play you a sample call right now if you have 30 seconds."'
  },
  {
    id: 33, category: 'objection',
    front: '"We\'re a small family business."',
    back: '"That\'s exactly who we built this for. Family businesses can\'t always afford full-time staff — this gives you the coverage without the cost."'
  },
  {
    id: 34, category: 'objection',
    front: '"How long does setup take?"',
    back: '"48 hours from the time you answer 8 quick questions about your business. Most clients are live within 2 days of signing up."'
  },
  {
    id: 35, category: 'objection',
    front: '"What if the AI gets something wrong?"',
    back: '"Everything gets logged — you can see every call in your dashboard. And the agent is programmed to take a message and escalate anything it\'s unsure about rather than guess."'
  },

  // ═══════════════════════════════════════
  // CATEGORY 2: SCRIPTS & OPENERS (35 cards)
  // ═══════════════════════════════════════
  {
    id: 36, category: 'script',
    front: 'Roofing opener',
    back: '"Hey [name], this is [rep] — saw you guys are hiring a receptionist on Indeed. Quick question — how are you handling calls when your crew is up on a roof?"'
  },
  {
    id: 37, category: 'script',
    front: 'HVAC opener',
    back: '"Hey [name], saw you\'re looking for a receptionist on Indeed. When your techs are out on service calls — what happens to the calls coming in?"'
  },
  {
    id: 38, category: 'script',
    front: 'Electrical contractor opener',
    back: '"Hey [name], saw the job posting on Indeed. Electricians are usually on-site all day — are you losing calls when nobody\'s in the office?"'
  },
  {
    id: 39, category: 'script',
    front: 'Hotshot trucking opener',
    back: '"Hey [name], saw you\'re hiring on Indeed. Quick question — when you\'re hauling a load, what happens when a new load call comes in?"'
  },
  {
    id: 40, category: 'script',
    front: 'Tow truck opener',
    back: '"Hey [name], saw you guys are hiring. When you\'re out on a tow — are the calls going to voicemail or is someone catching them?"'
  },
  {
    id: 41, category: 'script',
    front: 'Landscaping opener',
    back: '"Hey [name], saw the Indeed post. When your crew\'s out on a job — how\'s the phone situation? Are leads getting through?"'
  },
  {
    id: 42, category: 'script',
    front: 'Concrete contractor opener',
    back: '"Hey [name], saw you\'re looking for a receptionist. When you\'re on a pour — what happens to the calls coming in for estimates?"'
  },
  {
    id: 43, category: 'script',
    front: 'Pressure washing opener',
    back: '"Hey [name], saw the job post. You guys doing residential, commercial, or both? Just trying to get a feel for your call volume."'
  },
  {
    id: 44, category: 'script',
    front: 'Pain question — missed calls',
    back: '"On a rough week, how many calls do you think go unanswered? Most guys I talk to are surprised when they actually count."'
  },
  {
    id: 45, category: 'script',
    front: 'Pain question — after hours',
    back: '"What happens at 7pm when a homeowner calls for a quote — does that go somewhere or just to voicemail?"'
  },
  {
    id: 46, category: 'script',
    front: 'Pain question — cost of a hire',
    back: '"What are you budgeting for the receptionist role — salary, taxes, benefits, everything in?"'
  },
  {
    id: 47, category: 'script',
    front: 'Pain question — lost jobs',
    back: '"Have you ever found out a job went to a competitor just because they answered and you didn\'t?"'
  },
  {
    id: 48, category: 'script',
    front: 'Pain question — dispatch chaos',
    back: '"When a new job comes in while you\'re already on one — what does that process look like right now?"'
  },
  {
    id: 49, category: 'script',
    front: 'Booking the call — direct ask',
    back: '"I\'d love to show you exactly how this works in 15 minutes. You free Thursday at 2 or would Friday morning work better?"'
  },
  {
    id: 50, category: 'script',
    front: 'Booking the call — soft ask',
    back: '"Would it make sense to jump on a quick call this week? I can show you what other [niche] companies in [city] are using."'
  },
  {
    id: 51, category: 'script',
    front: 'Transition from opener to pain',
    back: '"Yeah, that\'s exactly why I\'m calling. Before I tell you what we do — can I ask you a couple quick questions about your situation?"'
  },
  {
    id: 52, category: 'script',
    front: 'When they say they\'re busy',
    back: '"I\'ll be quick — 2 minutes. If it\'s not relevant, I\'ll let you go. Fair enough?"'
  },
  {
    id: 53, category: 'script',
    front: 'When they ask "what do you do?"',
    back: '"We build AI phone agents for [niche] companies — basically replaces the need to hire a receptionist. Your calls get answered 24/7 even when you\'re on a job."'
  },
  {
    id: 54, category: 'script',
    front: 'Referencing the Indeed post naturally',
    back: '"Saw you guys are actively looking for someone on Indeed — figured this might be worth a conversation before you go through the whole hiring process."'
  },
  {
    id: 55, category: 'script',
    front: 'Creating urgency',
    back: '"Most businesses we work with waited 3-4 months to get started. In that time they estimate losing 2-3 jobs a week to voicemail. Just something to consider."'
  },
  {
    id: 56, category: 'script',
    front: 'Social proof — niche specific',
    back: '"We work with a few roofing companies in [city] right now — they\'re averaging about 12 more answered calls a week since going live."'
  },
  {
    id: 57, category: 'script',
    front: 'ROI frame',
    back: '"The way I look at it — if we answer one job call you would have missed, that probably pays for a month of the service. Everything else is profit."'
  },
  {
    id: 58, category: 'script',
    front: 'When they\'re interested but hesitant',
    back: '"Sounds like it makes sense — what\'s the one thing holding you back from just jumping on a quick call to see if it fits?"'
  },
  {
    id: 59, category: 'script',
    front: 'Ending a dead call cleanly',
    back: '"Appreciate your time — I\'ll send over some info and maybe we can reconnect in a few weeks when timing\'s better. Sound good?"'
  },
  {
    id: 60, category: 'script',
    front: 'Voicemail script',
    back: '"Hey [name], this is [rep] from Ohvara. Saw you\'re hiring a receptionist on Indeed — calling because we might be able to save you that hire. Call me back at [number] when you get a chance."'
  },
  {
    id: 61, category: 'script',
    front: 'Call back opener (they called you back)',
    back: '"Hey [name]! Thanks for calling back — I was reaching out about your receptionist search on Indeed. You got a couple minutes?"'
  },
  {
    id: 62, category: 'script',
    front: 'When they ask "how did you get this number?"',
    back: '"Your business number was on the Indeed posting — I figured a direct call was faster than sending an application. Hope that\'s okay."'
  },
  {
    id: 63, category: 'script',
    front: 'Tonality tip — stay calm',
    back: 'Never match frustration. If they\'re short — slow down, lower your voice, stay warm. Calm is contagious on the phone.'
  },
  {
    id: 64, category: 'script',
    front: 'Tonality tip — sound like a peer',
    back: 'Talk to them like you\'re a business owner too, not like you\'re selling something. "I work with a lot of roofers and they tell me the same thing."'
  },
  {
    id: 65, category: 'script',
    front: 'When they give a one-word answer',
    back: 'Ask a follow-up: "Tell me more about that." Silence is okay. Let them fill it.'
  },
  {
    id: 66, category: 'script',
    front: 'When they\'re clearly not interested',
    back: '"No worries at all — appreciate you being straight with me. Good luck with the hire." Then hang up cleanly. Never beg.'
  },
  {
    id: 67, category: 'script',
    front: 'The 3 goals of every call',
    back: '1. Get them talking about their problem. 2. Connect the problem to what we solve. 3. Book the 15-min call. Nothing else.'
  },
  {
    id: 68, category: 'script',
    front: 'When to stop talking',
    back: 'After you ask a question — stop. Don\'t fill silence. Let them answer. The rep who talks less usually books more.'
  },
  {
    id: 69, category: 'script',
    front: 'How to handle a gatekeeper',
    back: '"Hey, is [owner name] around? ... I was calling about their Indeed posting for a receptionist." Keep it simple. Don\'t over-explain to the gatekeeper.'
  },
  {
    id: 70, category: 'script',
    front: 'Confirming the appointment',
    back: '"Perfect — so I\'ve got you down for Thursday at 2pm. I\'ll send a calendar invite to [email]. Does that work?"'
  },

  // ═══════════════════════════════════════
  // CATEGORY 3: PRODUCT KNOWLEDGE (30 cards)
  // ═══════════════════════════════════════
  {
    id: 71, category: 'product',
    front: 'What does the Basic package include?',
    back: 'AI Receptionist (24/7 inbound call handling) + Missed Call Text Back. $497 setup + $497/mo.'
  },
  {
    id: 72, category: 'product',
    front: 'What does the Pro package include?',
    back: 'Everything in Basic + Review Generation + Lead Follow-Up Automation + Appointment Reminders. $497 setup + $797/mo.'
  },
  {
    id: 73, category: 'product',
    front: 'What does the Premium package include?',
    back: 'Everything in Pro + AI Dispatcher + SMS Marketing. $497 setup + $1,297/mo.'
  },
  {
    id: 74, category: 'product',
    front: 'What does the Elite package include?',
    back: 'Everything in Premium + Professional Website + Multiple AI agents + Priority support + Custom reporting. $497 setup + $1,797/mo.'
  },
  {
    id: 75, category: 'product',
    front: 'What is the setup fee?',
    back: '$497 one-time setup fee on every package. Covers onboarding, agent configuration, and number provisioning.'
  },
  {
    id: 76, category: 'product',
    front: 'What does AI Receptionist do?',
    back: 'Answers inbound calls 24/7. Greets callers with the business name, qualifies them, takes messages, books appointments, and routes urgent calls.'
  },
  {
    id: 77, category: 'product',
    front: 'What does Missed Call Text Back do?',
    back: 'When a call goes unanswered, automatically sends a text within 60 seconds: "Hey, sorry we missed you — how can we help?" Captures leads that would have gone elsewhere.'
  },
  {
    id: 78, category: 'product',
    front: 'What does Review Generation do?',
    back: 'After a job is complete, automatically sends a text asking for a Google review. Increases review count without the owner having to ask manually.'
  },
  {
    id: 79, category: 'product',
    front: 'What does Lead Follow-Up Automation do?',
    back: 'When a new lead comes in and doesn\'t book, automatically follows up via SMS and email over 7 days. Most leads close on follow-up #3 or #4.'
  },
  {
    id: 80, category: 'product',
    front: 'What does AI Dispatcher do?',
    back: 'Handles dispatch calls — routes jobs to the right crew, confirms job details, sends notifications. Designed for trades businesses with multiple techs.'
  },
  {
    id: 81, category: 'product',
    front: 'What does SMS Marketing do?',
    back: 'Sends promotional SMS campaigns to past customers. Reactivates old leads. Great for slow season outreach.'
  },
  {
    id: 82, category: 'product',
    front: 'What does the Professional Website include?',
    back: 'A custom single-page website built for the business. Dark luxury aesthetic, mobile-optimized, Google SEO setup, AI chat widget, JSON-LD schema.'
  },
  {
    id: 83, category: 'product',
    front: 'How long does setup take?',
    back: '48 hours from when the client answers the onboarding questions. Most clients are live within 2 business days.'
  },
  {
    id: 84, category: 'product',
    front: 'Is there a contract?',
    back: 'No. Month to month. Cancel anytime. No cancellation fees.'
  },
  {
    id: 85, category: 'product',
    front: 'What happens when a client cancels?',
    back: 'Their AI agent deactivates, their portal access ends. They lose the service. No refunds on setup fee.'
  },
  {
    id: 86, category: 'product',
    front: 'What is the client portal?',
    back: 'A mobile app (installs on their phone) where they can see every call their AI handled, manage settings, see leads, and access features based on their tier.'
  },
  {
    id: 87, category: 'product',
    front: 'What phone number does the AI use?',
    back: 'We provision a local number in their area code. They forward their business number to it. Callers never know it\'s AI unless they ask.'
  },
  {
    id: 88, category: 'product',
    front: 'Does the AI sound like a robot?',
    back: 'No. It\'s powered by Retell AI with a natural voice model. Most callers can\'t tell it\'s AI. It uses the business name and sounds professional.'
  },
  {
    id: 89, category: 'product',
    front: 'What niches does Ohvara work with?',
    back: 'Any trades or field service business — roofing, HVAC, electrical, landscaping, concrete, pressure washing, hotshot trucking, tow trucks. Primarily Profile A businesses.'
  },
  {
    id: 90, category: 'product',
    front: 'What is the ROI of Basic ($497/mo)?',
    back: 'Replaces a $2,800+/mo receptionist. Client saves $2,300+/mo while getting 24/7 coverage the human never provided.'
  },
  {
    id: 91, category: 'product',
    front: 'What is the ROI of Pro ($797/mo)?',
    back: 'Replaces a $3,500+/mo receptionist + marketing assistant. Client saves $2,700+/mo and gets automated reviews and follow-up.'
  },
  {
    id: 92, category: 'product',
    front: 'What is the ROI of Premium ($1,297/mo)?',
    back: 'Replaces a $4,500+/mo receptionist + dispatcher. Client saves $3,200+/mo and gets full front office automation.'
  },
  {
    id: 93, category: 'product',
    front: 'What is the ROI of Elite ($1,797/mo)?',
    back: 'Replaces $6,000+/mo full office staff. Client gets everything plus a website and multiple AI agents.'
  },
  {
    id: 94, category: 'product',
    front: 'Which package for a one-person roofing company?',
    back: 'Basic or Pro. Basic if their main pain is missed calls. Pro if they also want reviews and follow-up. Labor cost under $3,500 → Basic. Over $3,500 → Pro.'
  },
  {
    id: 95, category: 'product',
    front: 'Which package for a hotshot company with 3 trucks?',
    back: 'Premium or Elite. They need dispatcher capabilities for routing loads. If they also want a website → Elite.'
  },
  {
    id: 96, category: 'product',
    front: 'What does the rep\'s job NOT include?',
    back: 'Pitching the product, explaining pricing, or closing. The rep ONLY books a 15-minute discovery call. Everything else is the closer\'s job.'
  },
  {
    id: 97, category: 'product',
    front: 'What is the discovery call?',
    back: 'A 15-minute call with the closer (Nate). Goal: understand the business pain. The closer then pitches the right package on a second call.'
  },
  {
    id: 98, category: 'product',
    front: 'What is the close call?',
    back: 'Second call with the closer. AI recommends the package based on discovery notes. Closer pitches, handles objections, and closes. Stripe link sent on verbal yes.'
  },
  {
    id: 99, category: 'product',
    front: 'What happens after the client pays?',
    back: 'Auto-provisioning fires: client record created, onboarding form sent, agent built, Twilio number provisioned, welcome email sent. Client is live in 48 hours.'
  },
  {
    id: 100, category: 'product',
    front: 'Ohvara\'s one-sentence pitch',
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
