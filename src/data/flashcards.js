// Setter training flashcards — video-specific content (Prompt 179, 2026-06-30).
// 48 cards across 8 categories: one per training video.
// Vocab/term format: front = short term (2-4 words), back = one-line definition (glossary style).
// Mastered state tracked in localStorage key: 'ohvara_flashcard_mastered'

export const FLASHCARDS = [

  // ═══════════════════════════════════════
  // CATEGORY 1: AI RECEPTIONIST (Video 1 — What an AI Receptionist Does)
  // ═══════════════════════════════════════
  {
    id: 1, category: 'ai-receptionist',
    front: 'AI Receptionist',
    back: 'AI voice agent that answers calls like a human, 24/7 or as overflow',
  },
  {
    id: 2, category: 'ai-receptionist',
    front: 'Missed Call Math',
    back: 'Missed calls/day × ticket price × days/year = lost revenue',
  },
  {
    id: 3, category: 'ai-receptionist',
    front: 'Templated AI',
    back: 'Plug-and-play, generic (RingCentral, GoHighLevel)',
  },
  {
    id: 4, category: 'ai-receptionist',
    front: 'Custom AI',
    back: 'Agency-built, tailored to the business',
  },
  {
    id: 5, category: 'ai-receptionist',
    front: 'Overflow Mode',
    back: 'AI only answers when a human can\'t',
  },
  {
    id: 6, category: 'ai-receptionist',
    front: 'Per-Minute Pricing',
    back: '~$0.12/min raw cost; agencies mark it up',
  },

  // ═══════════════════════════════════════
  // CATEGORY 2: TONALITY (Video 2 — Tonality & Delivery)
  // ═══════════════════════════════════════
  {
    id: 7, category: 'tonality',
    front: 'First 4 Seconds',
    back: 'Window to prove you\'re sharp, enthusiastic, an expert',
  },
  {
    id: 8, category: 'tonality',
    front: '90/10 Rule',
    back: 'Tonality + body language = 90% of impact, words = 10%',
  },
  {
    id: 9, category: 'tonality',
    front: 'Charisma',
    back: 'A learnable skill, not a trait',
  },
  {
    id: 10, category: 'tonality',
    front: 'Rapport',
    back: 'Feeling cared for + feeling similarity',
  },
  {
    id: 11, category: 'tonality',
    front: 'Deliberate Tonality',
    back: 'Vocal emphasis that pulls the listener in',
  },
  {
    id: 12, category: 'tonality',
    front: 'Flat Tone',
    back: 'Causes the listener to check out',
  },

  // ═══════════════════════════════════════
  // CATEGORY 3: DISCOVERY (Video 3 — The Discovery Script)
  // ═══════════════════════════════════════
  {
    id: 13, category: 'discovery',
    front: 'Clarifying Question',
    back: '"How do you mean by that?" — digs past the surface',
  },
  {
    id: 14, category: 'discovery',
    front: 'Word Echo',
    back: 'Repeating their emotion word back to open them up',
  },
  {
    id: 15, category: 'discovery',
    front: 'Pain Timeline',
    back: '"How long has this been going on?"',
  },
  {
    id: 16, category: 'discovery',
    front: 'The Pause',
    back: 'Silence after a question forces a deeper answer',
  },
  {
    id: 17, category: 'discovery',
    front: 'Root Cause Question',
    back: '"What\'s causing this?"',
  },
  {
    id: 18, category: 'discovery',
    front: 'Discovery First',
    back: 'Surface pain before pitching, to build urgency',
  },

  // ═══════════════════════════════════════
  // CATEGORY 4: GATEKEEPER (Video 4 — Getting Past the Gatekeeper)
  // ═══════════════════════════════════════
  {
    id: 19, category: 'gatekeeper',
    front: 'Decision-Maker',
    back: 'Owner or exec — the only one who can act on your offer',
  },
  {
    id: 20, category: 'gatekeeper',
    front: 'Casual Open',
    back: 'Skip formal intros, sound like you already know them',
  },
  {
    id: 21, category: 'gatekeeper',
    front: 'The Pause (Gatekeeper)',
    back: 'Stop talking after your question, let them answer',
  },
  {
    id: 22, category: 'gatekeeper',
    front: 'Over-Explaining',
    back: 'Reads as nervous or salesy',
  },
  {
    id: 23, category: 'gatekeeper',
    front: 'Screening',
    back: 'What gatekeepers do to filter out sales calls',
  },
  {
    id: 24, category: 'gatekeeper',
    front: 'Casual > Professional',
    back: 'Polished reads as guarded; casual reads as safe',
  },

  // ═══════════════════════════════════════
  // CATEGORY 5: OBJECTIONS (Video 5 — Handling Objections)
  // ═══════════════════════════════════════
  {
    id: 25, category: 'objections',
    front: 'Frame',
    back: 'The mental stance keeping a prospect stuck with no urgency',
  },
  {
    id: 26, category: 'objections',
    front: 'Pain & Fear',
    back: 'The 2 emotional drivers of change',
  },
  {
    id: 27, category: 'objections',
    front: 'Consequence Question',
    back: '"Then what happens?" — chained deeper each time',
  },
  {
    id: 28, category: 'objections',
    front: 'Identity Frame',
    back: 'Contrasting them vs. people who stayed stuck',
  },
  {
    id: 29, category: 'objections',
    front: 'Concerned Tone',
    back: 'Seeds doubt, lowers their guard',
  },
  {
    id: 30, category: 'objections',
    front: 'Rebuttal Mistake',
    back: 'Arguing their frame instead of reframing it',
  },

  // ═══════════════════════════════════════
  // CATEGORY 6: QUALIFYING (Video 6 — Qualifying the Prospect)
  // ═══════════════════════════════════════
  {
    id: 31, category: 'qualifying',
    front: 'Household Income Test',
    back: 'Combined income should comfortably cover the payment',
  },
  {
    id: 32, category: 'qualifying',
    front: 'Cash-Flow Negative',
    back: 'When a payment strains the budget — not the case if the product pays for itself',
  },
  {
    id: 33, category: 'qualifying',
    front: 'Coach Approach',
    back: 'Asking about money history like a coach, not an interrogator',
  },
  {
    id: 34, category: 'qualifying',
    front: 'Disqualify Fast',
    back: 'Moving on quickly when someone clearly can\'t afford it',
  },
  {
    id: 35, category: 'qualifying',
    front: 'Call Efficiency',
    back: 'Why moving fast through unqualified leads matters',
  },
  {
    id: 36, category: 'qualifying',
    front: 'Money History',
    back: 'Their past relationship with money/success',
  },

  // ═══════════════════════════════════════
  // CATEGORY 7: BOOKING (Video 7 — Booking & Handoff)
  // ═══════════════════════════════════════
  {
    id: 37, category: 'booking',
    front: 'Pre-Call Prep',
    back: 'Having their info ready before you call — don\'t re-ask',
  },
  {
    id: 38, category: 'booking',
    front: 'Pushy Gap',
    back: 'Prospects see pushiness more than setters realize',
  },
  {
    id: 39, category: 'booking',
    front: 'Earned Assertiveness',
    back: 'Getting direct only after rapport + value + qualifying',
  },
  {
    id: 40, category: 'booking',
    front: 'Small Ask',
    back: '"Got 2 minutes?" — easy yes',
  },
  {
    id: 41, category: 'booking',
    front: 'Assumptive Close',
    back: 'Booking instead of asking "want to move forward?"',
  },
  {
    id: 42, category: 'booking',
    front: 'Referral Window',
    back: 'Asking right when they\'re thanking you',
  },

  // ═══════════════════════════════════════
  // CATEGORY 8: TIME MANAGEMENT (Video 8 — Time Management & Call Discipline)
  // ═══════════════════════════════════════
  {
    id: 43, category: 'time-management',
    front: 'Reactive Day',
    back: 'Working off whatever pops up, no plan',
  },
  {
    id: 44, category: 'time-management',
    front: 'Morning Dial Block',
    back: 'Best call window, highest connect rates',
  },
  {
    id: 45, category: 'time-management',
    front: 'Sourcing Block',
    back: 'Dedicated time to build tomorrow\'s pipeline',
  },
  {
    id: 46, category: 'time-management',
    front: 'Passive Learning',
    back: 'Light, low-effort learning (e.g. lunch call reviews)',
  },
  {
    id: 47, category: 'time-management',
    front: 'End-of-Day Reflection',
    back: 'Turns activity into improvement',
  },
  {
    id: 48, category: 'time-management',
    front: 'Work Intentional',
    back: 'The core mindset — structure over hours',
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
