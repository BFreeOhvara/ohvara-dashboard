// Setter training flashcards — video-specific content (Prompt 177, 2026-06-30).
// 48 cards across 8 categories: one per training video.
// Replaces the old generic 6-category deck (Pipeline/Discovery/Objections/Booking/Niches/Mindset).
// Mastered state tracked in localStorage key: 'ohvara_flashcard_mastered'

export const FLASHCARDS = [

  // ═══════════════════════════════════════
  // CATEGORY 1: AI RECEPTIONIST (Video 1 — What an AI Receptionist Does)
  // ═══════════════════════════════════════
  {
    id: 1, category: 'ai-receptionist',
    front: 'How do you put a dollar value on one missed call a day?',
    back: 'Multiply missed calls/day × average ticket price × days per year — e.g. 1 missed call/day at $300/ticket ≈ $100K/year in lost revenue.',
  },
  {
    id: 2, category: 'ai-receptionist',
    front: "What's the simplest way to describe what an AI receptionist is?",
    back: "A highly conversational AI voice agent that sounds human enough most callers can't tell it's not a person.",
  },
  {
    id: 3, category: 'ai-receptionist',
    front: "What's the difference between a templated AI receptionist and a custom one?",
    back: 'Templated (e.g. RingCentral, GoHighLevel) is plug-and-play but generic; custom (built on platforms like Retell AI or Vapi) is tailored to the business but needs technical expertise, usually via an agency.',
  },
  {
    id: 4, category: 'ai-receptionist',
    front: 'Does an AI receptionist have to replace human staff?',
    back: 'No — a business owner can choose full AI coverage 24/7, or AI only as overflow when humans can\'t get to the phone (busy hours, after hours).',
  },
  {
    id: 5, category: 'ai-receptionist',
    front: 'Why is voicemail considered a lost cause compared to an AI receptionist?',
    back: "Most callers won't leave a voicemail — they just call the next business that actually answers.",
  },
  {
    id: 6, category: 'ai-receptionist',
    front: 'Roughly what does usage-based AI receptionist pricing look like?',
    back: 'Raw cost is around $0.12/minute; agencies typically charge a flat monthly rate (e.g. ~$200/mo for a set number of minutes) plus an overage rate per minute beyond that.',
  },

  // ═══════════════════════════════════════
  // CATEGORY 2: TONALITY (Video 2 — Tonality & Delivery)
  // ═══════════════════════════════════════
  {
    id: 7, category: 'tonality',
    front: 'What three things do you need to establish in the first four seconds of a call?',
    back: "That you're sharp, enthusiastic, and an expert in your field.",
  },
  {
    id: 8, category: 'tonality',
    front: 'Roughly how much of communication impact comes from tonality and body language versus the actual words?',
    back: 'About 90% combined (tonality + body language), only about 10% from the words themselves.',
  },
  {
    id: 9, category: 'tonality',
    front: 'Is charisma something you\'re born with?',
    back: "No — it's a learnable skill built from effective tonality, appropriate body language, and not saying things that undercut you.",
  },
  {
    id: 10, category: 'tonality',
    front: 'What two things does a prospect need to feel for rapport to form?',
    back: 'That you genuinely care about them, and that you\'re "just like them" — a sense of commonality/connection.',
  },
  {
    id: 11, category: 'tonality',
    front: 'Why does using deliberate tonality give you more control of a conversation?',
    back: "It forces the listener to unconsciously work to figure out what you really mean, pulling them into engaging with you instead of tuning out.",
  },
  {
    id: 12, category: 'tonality',
    front: "What's the risk of having no tonality at all when you speak?",
    back: "People mentally check out — without vocal emphasis there's nothing pulling their attention into what you're saying.",
  },

  // ═══════════════════════════════════════
  // CATEGORY 3: DISCOVERY (Video 3 — The Discovery Script)
  // ═══════════════════════════════════════
  {
    id: 13, category: 'discovery',
    front: 'What\'s the purpose of a clarifying/probing question like "how do you mean by that?"',
    back: "It gets the prospect to go deeper than a surface answer and reveal what's really driving the problem.",
  },
  {
    id: 14, category: 'discovery',
    front: "Why repeat a prospect's own emotional word back to them (e.g. \"stressed\")?",
    back: "It invites them to elaborate on that feeling instead of staying vague, opening them up.",
  },
  {
    id: 15, category: 'discovery',
    front: 'What does asking "how long has that been going on for?" accomplish?',
    back: "It gets the prospect to relive how long the problem has been affecting them, deepening the felt pain.",
  },
  {
    id: 16, category: 'discovery',
    front: 'Why pause after asking something like "...has that had an impact on you"?',
    back: "The pause forces a deeper, more considered answer instead of a reflexive one.",
  },
  {
    id: 17, category: 'discovery',
    front: 'Name an open-ended discovery question that works across any industry.',
    back: 'Examples: "What\'s causing this to happen?" / "What\'s prompting you to look into changing this now?" / "What would it mean for you to solve this problem?"',
  },
  {
    id: 18, category: 'discovery',
    front: 'Why ask discovery questions before pitching at all?',
    back: "Surfacing the prospect's real pain and emotions first builds urgency — pitching cold gets ignored, pitching after pain is surfaced gets attention.",
  },

  // ═══════════════════════════════════════
  // CATEGORY 4: GATEKEEPER (Video 4 — Getting Past the Gatekeeper)
  // ═══════════════════════════════════════
  {
    id: 19, category: 'gatekeeper',
    front: "What's the actual goal when a gatekeeper answers the phone?",
    back: "Get past them to the decision-maker (owner or exec) — only someone who can act on your offer is worth pitching.",
  },
  {
    id: 20, category: 'gatekeeper',
    front: 'Why avoid a formal self-introduction like "Hi, this is [name] calling from [company]"?',
    back: 'It signals "sales call" instantly and gives the gatekeeper an easy reason to screen you out.',
  },
  {
    id: 21, category: 'gatekeeper',
    front: 'What tone should you use when asking for the decision-maker?',
    back: "Casual and familiar — as if you already have a relationship with them, not overly professional or scripted.",
  },
  {
    id: 22, category: 'gatekeeper',
    front: 'What should you do immediately after asking your question to the gatekeeper?',
    back: "Pause and let them respond — talking more to fill the silence undercuts your control of the call.",
  },
  {
    id: 23, category: 'gatekeeper',
    front: 'Why does over-explaining yourself to a gatekeeper hurt you?',
    back: "It reads as nervous or salesy, the opposite of sounding like someone who belongs on that call.",
  },
  {
    id: 24, category: 'gatekeeper',
    front: 'What\'s the underlying principle behind sounding "casual" instead of "professional" on a cold open?',
    back: "People are more guarded around anything that looks polished/sales-like — casual reads as safe and familiar.",
  },

  // ═══════════════════════════════════════
  // CATEGORY 5: OBJECTIONS (Video 5 — Handling Objections)
  // ═══════════════════════════════════════
  {
    id: 25, category: 'objections',
    front: 'Why do prospects give objections like "I need to think about it" or "send me more info"?',
    back: "They're stuck in a frame where they feel no real urgency to change.",
  },
  {
    id: 26, category: 'objections',
    front: 'What are the two emotional drivers that cause someone to actually change?',
    back: 'Pain (current) and fear of future pain.',
  },
  {
    id: 27, category: 'objections',
    front: "What's a \"consequence question\" used for?",
    back: 'To walk the prospect through what happens if they do nothing — chaining "and then what happens?" deeper until it hits something personal (family, career, identity).',
  },
  {
    id: 28, category: 'objections',
    front: "What's an \"identity frame\" reframe?",
    back: "Contrasting the prospect against people who never fixed the problem and got stuck, so they don't want to identify with that outcome.",
  },
  {
    id: 29, category: 'objections',
    front: 'Why use a concerned tone when asking a tough question like "how can I tell you this without you getting upset?"',
    back: "It seeds doubt — the prospect senses you know something they don't, which lowers their guard.",
  },
  {
    id: 30, category: 'objections',
    front: "What's the underlying mistake of rebuttal-style objection handling?",
    back: "It argues with the prospect's existing frame instead of reframing how they see the problem altogether.",
  },

  // ═══════════════════════════════════════
  // CATEGORY 6: QUALIFYING (Video 6 — Qualifying the Prospect)
  // ═══════════════════════════════════════
  {
    id: 31, category: 'qualifying',
    front: "What's the basic household-income idea for qualifying someone financially?",
    back: "Their income + spouse's income should comfortably exceed what's needed to afford the payment, since the product is meant to pay for itself over time.",
  },
  {
    id: 32, category: 'qualifying',
    front: "Why doesn't existing debt automatically disqualify a prospect?",
    back: "If their income comfortably covers the payment and the product itself improves their results/income, the payment isn't a real cash-flow problem.",
  },
  {
    id: 33, category: 'qualifying',
    front: 'What approach works well when qualifying someone around money?',
    back: "Ask like a coach — about their history and relationship with money/success — rather than just demanding numbers.",
  },
  {
    id: 34, category: 'qualifying',
    front: "What should you do if a prospect clearly can't afford the offer?",
    back: "Qualify them out quickly and move to the next lead rather than spending time trying to make it work.",
  },
  {
    id: 35, category: 'qualifying',
    front: "What's the benefit of moving fast through unqualified leads?",
    back: "It keeps your overall call efficiency high — a few extra minutes either way doesn't change a clearly unqualified outcome.",
  },
  {
    id: 36, category: 'qualifying',
    front: "Why ask about someone's past relationship with money/success before pitching price?",
    back: "It surfaces whether they see themselves as someone who invests in solving problems, which shapes how you frame the offer.",
  },

  // ═══════════════════════════════════════
  // CATEGORY 7: BOOKING (Video 7 — Booking & Handoff)
  // ═══════════════════════════════════════
  {
    id: 37, category: 'booking',
    front: "Why have the prospect's info pulled up before calling them back?",
    back: "Re-asking questions they already answered on a form makes them feel like you're wasting their time.",
  },
  {
    id: 38, category: 'booking',
    front: "What's the disconnect between how setters and prospects view pushiness?",
    back: "Far more prospects perceive salespeople as pushy than salespeople think they are — there's a real gap in self-awareness here.",
  },
  {
    id: 39, category: 'booking',
    front: 'When is it actually okay to get a little more assertive in a call?',
    back: "After you've built rapport, shown value, and qualified the prospect — not before.",
  },
  {
    id: 40, category: 'booking',
    front: 'Why ask "do you have two minutes?" instead of not asking at all?',
    back: "It's a small, easy yes that respects their time, especially with warmer prospects expecting your call.",
  },
  {
    id: 41, category: 'booking',
    front: 'Why assume the appointment instead of asking "would you like to move forward?"',
    back: "Asking gives them an easy opening to say no, even if they were close to yes.",
  },
  {
    id: 42, category: 'booking',
    front: 'When is the best moment to ask for a referral?',
    back: "When the prospect is expressing gratitude — that's when they're most open to recommending you.",
  },

  // ═══════════════════════════════════════
  // CATEGORY 8: TIME MANAGEMENT (Video 8 — Time Management & Call Discipline)
  // ═══════════════════════════════════════
  {
    id: 43, category: 'time-management',
    front: "What's the most common reason reps fail to hit their numbers, per this training?",
    back: "Not laziness — a lack of structure, reacting to whatever comes up instead of planning the day.",
  },
  {
    id: 44, category: 'time-management',
    front: 'Why are morning dial blocks considered the most valuable call time?',
    back: "Prospects haven't filled up their day with meetings yet, so connect rates are higher.",
  },
  {
    id: 45, category: 'time-management',
    front: 'Why dedicate a specific block to sourcing instead of doing it whenever?',
    back: "It's easy to skip when unstructured, but it's what builds tomorrow's pipeline.",
  },
  {
    id: 46, category: 'time-management',
    front: "What's the value of a few minutes of passive learning (e.g. listening to top rep calls) over lunch?",
    back: "Low-effort exposure to what's working, without taking deep focus away from active calling/selling time.",
  },
  {
    id: 47, category: 'time-management',
    front: 'Why end the day with a short reflection on what worked?',
    back: "Without reviewing, activity doesn't turn into improvement — you repeat the same mistakes.",
  },
  {
    id: 48, category: 'time-management',
    front: "What's the core mindset shift behind a structured day?",
    back: "You don't need to work longer — you need to work intentionally, protecting call blocks like they're meetings.",
  },
]

export const CATEGORY_LABELS = {
  'ai-receptionist': 'AI Receptionist',
  'tonality':        'Tonality',
  'discovery':       'Discovery',
  'gatekeeper':      'Gatekeeper',
  'objections':      'Objections',
  'qualifying':      'Qualifying',
  'booking':         'Booking',
  'time-management': 'Time Management',
}

export const CATEGORY_COLORS = {
  'ai-receptionist': 'var(--info)',
  'tonality':        'var(--accent)',
  'discovery':       'var(--success)',
  'gatekeeper':      'var(--warning)',
  'objections':      'var(--danger)',
  'qualifying':      'var(--purple, var(--accent))',
  'booking':         'var(--teal, var(--success))',
  'time-management': 'var(--orange, var(--warning))',
}
