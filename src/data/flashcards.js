// Setter training flashcards — video-specific content (Prompt 178, 2026-06-30).
// 48 cards across 8 categories: one per training video.
// Short cue/term front + short phrase back (rewritten per Brayden — full Q&A was too hard to memorize).
// Mastered state tracked in localStorage key: 'ohvara_flashcard_mastered'

export const FLASHCARDS = [

  // ═══════════════════════════════════════
  // CATEGORY 1: AI RECEPTIONIST (Video 1 — What an AI Receptionist Does)
  // ═══════════════════════════════════════
  {
    id: 1, category: 'ai-receptionist',
    front: 'Missed call math',
    back: 'Calls missed/day × ticket price × days/yr',
  },
  {
    id: 2, category: 'ai-receptionist',
    front: 'AI receptionist',
    back: 'Human-sounding AI phone agent',
  },
  {
    id: 3, category: 'ai-receptionist',
    front: 'Templated vs custom',
    back: 'Templated = plug-in generic; custom = agency-built, tailored',
  },
  {
    id: 4, category: 'ai-receptionist',
    front: 'Full AI vs overflow',
    back: '24/7 AI, or AI only when human can\'t answer',
  },
  {
    id: 5, category: 'ai-receptionist',
    front: 'Voicemail problem',
    back: 'Callers don\'t leave one — they call a competitor',
  },
  {
    id: 6, category: 'ai-receptionist',
    front: 'Pricing model',
    back: '~$0.12/min raw; agencies charge flat rate + overage',
  },

  // ═══════════════════════════════════════
  // CATEGORY 2: TONALITY (Video 2 — Tonality & Delivery)
  // ═══════════════════════════════════════
  {
    id: 7, category: 'tonality',
    front: 'First 4 seconds',
    back: 'Sharp, enthusiastic, expert',
  },
  {
    id: 8, category: 'tonality',
    front: '90% of communication',
    back: 'Tonality + body language (words = 10%)',
  },
  {
    id: 9, category: 'tonality',
    front: 'Charisma',
    back: 'Learnable — tonality + body language + no dumb words',
  },
  {
    id: 10, category: 'tonality',
    front: 'Rapport =',
    back: 'They feel you care + you\'re like them',
  },
  {
    id: 11, category: 'tonality',
    front: 'Why use tonality',
    back: 'Forces listener to engage, not tune out',
  },
  {
    id: 12, category: 'tonality',
    front: 'Flat tone risk',
    back: 'People mentally check out',
  },

  // ═══════════════════════════════════════
  // CATEGORY 3: DISCOVERY (Video 3 — The Discovery Script)
  // ═══════════════════════════════════════
  {
    id: 13, category: 'discovery',
    front: '"How do you mean by that?"',
    back: 'Pushes past the surface answer',
  },
  {
    id: 14, category: 'discovery',
    front: 'Repeat their word',
    back: 'Echo their emotion word to open them up',
  },
  {
    id: 15, category: 'discovery',
    front: '"How long has this been going on?"',
    back: 'Makes them relive the pain',
  },
  {
    id: 16, category: 'discovery',
    front: 'Pause after a question',
    back: 'Forces a deeper, real answer',
  },
  {
    id: 17, category: 'discovery',
    front: 'Good discovery question',
    back: '"What\'s causing this?" / "Why now?"',
  },
  {
    id: 18, category: 'discovery',
    front: 'Why discover before pitching',
    back: 'Surfaced pain = urgency',
  },

  // ═══════════════════════════════════════
  // CATEGORY 4: GATEKEEPER (Video 4 — Getting Past the Gatekeeper)
  // ═══════════════════════════════════════
  {
    id: 19, category: 'gatekeeper',
    front: 'Real goal w/ gatekeeper',
    back: 'Get to the decision-maker',
  },
  {
    id: 20, category: 'gatekeeper',
    front: 'Skip the formal intro',
    back: 'Sounds like a sales call, gets screened',
  },
  {
    id: 21, category: 'gatekeeper',
    front: 'Tone with gatekeeper',
    back: 'Casual, like you already know them',
  },
  {
    id: 22, category: 'gatekeeper',
    front: 'After you ask',
    back: 'Pause — let them respond',
  },
  {
    id: 23, category: 'gatekeeper',
    front: 'Over-explaining',
    back: 'Reads as nervous/salesy',
  },
  {
    id: 24, category: 'gatekeeper',
    front: 'Casual > professional',
    back: 'Polished = guarded; casual = safe',
  },

  // ═══════════════════════════════════════
  // CATEGORY 5: OBJECTIONS (Video 5 — Handling Objections)
  // ═══════════════════════════════════════
  {
    id: 25, category: 'objections',
    front: '"I\'ll think about it"',
    back: 'No urgency — stuck in a frame',
  },
  {
    id: 26, category: 'objections',
    front: '2 drivers of change',
    back: 'Pain + fear of future pain',
  },
  {
    id: 27, category: 'objections',
    front: 'Consequence question',
    back: '"Then what happens?" — chain it deeper',
  },
  {
    id: 28, category: 'objections',
    front: 'Identity frame',
    back: 'Contrast them vs. people who stayed stuck',
  },
  {
    id: 29, category: 'objections',
    front: 'Concerned tone',
    back: 'Seeds doubt, lowers their guard',
  },
  {
    id: 30, category: 'objections',
    front: 'Rebuttal mistake',
    back: 'Argues their frame instead of reframing',
  },

  // ═══════════════════════════════════════
  // CATEGORY 6: QUALIFYING (Video 6 — Qualifying the Prospect)
  // ═══════════════════════════════════════
  {
    id: 31, category: 'qualifying',
    front: 'Qualify on money',
    back: 'Household income should cover the payment',
  },
  {
    id: 32, category: 'qualifying',
    front: 'Debt ≠ disqualified',
    back: 'Fine if income covers it + product pays for itself',
  },
  {
    id: 33, category: 'qualifying',
    front: 'Qualifying approach',
    back: 'Ask like a coach, not an interrogator',
  },
  {
    id: 34, category: 'qualifying',
    front: 'Can\'t afford it',
    back: 'Qualify out fast, move on',
  },
  {
    id: 35, category: 'qualifying',
    front: 'Why move fast',
    back: 'Keeps overall call efficiency high',
  },
  {
    id: 36, category: 'qualifying',
    front: 'Ask about money history',
    back: 'Shows if they invest in solving problems',
  },

  // ═══════════════════════════════════════
  // CATEGORY 7: BOOKING (Video 7 — Booking & Handoff)
  // ═══════════════════════════════════════
  {
    id: 37, category: 'booking',
    front: 'Before calling back',
    back: 'Pull up their info, don\'t re-ask',
  },
  {
    id: 38, category: 'booking',
    front: 'Pushy gap',
    back: 'Prospects see it more than setters do',
  },
  {
    id: 39, category: 'booking',
    front: 'When to get assertive',
    back: 'After rapport + value + qualifying',
  },
  {
    id: 40, category: 'booking',
    front: '"Got 2 minutes?"',
    back: 'Small ask = easy yes',
  },
  {
    id: 41, category: 'booking',
    front: 'Assume the appointment',
    back: 'Don\'t ask "want to move forward?"',
  },
  {
    id: 42, category: 'booking',
    front: 'Best time to ask for referral',
    back: 'When they\'re thanking you',
  },

  // ═══════════════════════════════════════
  // CATEGORY 8: TIME MANAGEMENT (Video 8 — Time Management & Call Discipline)
  // ═══════════════════════════════════════
  {
    id: 43, category: 'time-management',
    front: '#1 reason reps miss numbers',
    back: 'No structure, just reacting',
  },
  {
    id: 44, category: 'time-management',
    front: 'Best call block',
    back: 'Morning — higher connect rates',
  },
  {
    id: 45, category: 'time-management',
    front: 'Sourcing block',
    back: 'Builds tomorrow\'s pipeline',
  },
  {
    id: 46, category: 'time-management',
    front: 'Lunch passive learning',
    back: 'Listen to top calls, low effort',
  },
  {
    id: 47, category: 'time-management',
    front: 'End-of-day reflection',
    back: 'Turns activity into improvement',
  },
  {
    id: 48, category: 'time-management',
    front: 'Core mindset',
    back: 'Work intentional, not longer',
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
