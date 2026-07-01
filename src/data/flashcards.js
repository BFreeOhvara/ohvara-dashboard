// Setter training flashcards — video-specific content (Prompt 181, 2026-06-30).
// 48 cards across 8 categories: one per training video.
// Q&A format: front = natural question, back = short answer/term.
// Mastered state tracked in localStorage key: 'ohvara_flashcard_mastered'

export const FLASHCARDS = [

  // ═══════════════════════════════════════
  // CATEGORY 1: AI RECEPTIONIST (Video 1 — What an AI Receptionist Does)
  // REVISED 2026-07-01, new video ("AI Answering Service for Small Businesses | Overview of Upfirst")
  // ═══════════════════════════════════════
  {
    id: 1, category: 'ai-receptionist',
    front: 'What three things does a business get after an AI receptionist finishes a call?',
    back: 'A summary, a transcript, and a recording',
  },
  {
    id: 2, category: 'ai-receptionist',
    front: 'How do you teach an AI receptionist about a specific business?',
    back: 'Give it plain-English information and instructions — no AI expertise needed',
  },
  {
    id: 3, category: 'ai-receptionist',
    front: "What's it called when an AI receptionist briefs a human on the caller before connecting a transferred call?",
    back: 'A warm transfer',
  },
  {
    id: 4, category: 'ai-receptionist',
    front: 'What happens if a human declines a warm-transferred call?',
    back: 'The AI receptionist politely takes a message',
  },
  {
    id: 5, category: 'ai-receptionist',
    front: 'How can an AI receptionist book an appointment without texting the caller a link?',
    back: 'By connecting to your calendar and checking real-time availability directly on the call',
  },
  {
    id: 6, category: 'ai-receptionist',
    front: 'What can an AI receptionist automatically detect and filter out of your call log?',
    back: 'Spam calls',
  },

  // ═══════════════════════════════════════
  // CATEGORY 2: TONALITY (Video 2 — Tonality & Delivery)
  // ═══════════════════════════════════════
  {
    id: 7, category: 'tonality',
    front: "How long do you have to prove you're sharp, enthusiastic, and an expert?",
    back: 'The first 4 seconds',
  },
  {
    id: 8, category: 'tonality',
    front: 'What percentage of communication impact comes from tonality and body language combined?',
    back: '90% (words are only 10%)',
  },
  {
    id: 9, category: 'tonality',
    front: "Is charisma something you're born with or something you can learn?",
    back: 'A learnable skill, not a trait',
  },
  {
    id: 10, category: 'tonality',
    front: 'What two feelings does a prospect need to have for rapport to form?',
    back: "That you care about them, and that you're similar to them",
  },
  {
    id: 11, category: 'tonality',
    front: 'What does using deliberate vocal emphasis do to a listener?',
    back: 'Pulls them in, keeps them engaged',
  },
  {
    id: 12, category: 'tonality',
    front: 'What happens to a listener when you speak in a flat tone?',
    back: 'They mentally check out',
  },

  // ═══════════════════════════════════════
  // CATEGORY 3: DISCOVERY (Video 3 — The Discovery Script)
  // ═══════════════════════════════════════
  {
    id: 13, category: 'discovery',
    front: "What question digs past a surface-level answer to find out what's really going on?",
    back: '"How do you mean by that?"',
  },
  {
    id: 14, category: 'discovery',
    front: "What's it called when you repeat a prospect's own emotion word back to them?",
    back: 'A word echo',
  },
  {
    id: 15, category: 'discovery',
    front: 'What question gets a prospect to relive how long a problem has been affecting them?',
    back: '"How long has this been going on?"',
  },
  {
    id: 16, category: 'discovery',
    front: 'What forces a prospect to give a deeper, more considered answer after you ask a question?',
    back: 'The pause (staying silent)',
  },
  {
    id: 17, category: 'discovery',
    front: "What question gets straight at the root cause of a prospect's problem?",
    back: '"What\'s causing this?"',
  },
  {
    id: 18, category: 'discovery',
    front: "Why surface a prospect's pain before pitching anything?",
    back: 'It builds urgency',
  },

  // ═══════════════════════════════════════
  // CATEGORY 4: GATEKEEPER (Video 4 — Getting Past the Gatekeeper)
  // ═══════════════════════════════════════
  {
    id: 19, category: 'gatekeeper',
    front: "Who's the only person who can actually act on your offer?",
    back: 'The decision-maker (owner or exec)',
  },
  {
    id: 20, category: 'gatekeeper',
    front: 'What kind of opener skips the formal intro and sounds like you already know them?',
    back: 'A casual open',
  },
  {
    id: 21, category: 'gatekeeper',
    front: 'What should you do right after asking the gatekeeper your question?',
    back: 'Stop talking and let them answer',
  },
  {
    id: 22, category: 'gatekeeper',
    front: 'What does over-explaining yourself to a gatekeeper make you sound like?',
    back: 'Nervous or salesy',
  },
  {
    id: 23, category: 'gatekeeper',
    front: "What's a gatekeeper's job when it comes to sales calls?",
    back: 'Screening them out',
  },
  {
    id: 24, category: 'gatekeeper',
    front: 'Why does sounding casual work better than sounding polished on a cold open?',
    back: 'Polished reads as guarded, casual reads as safe',
  },

  // ═══════════════════════════════════════
  // CATEGORY 5: OBJECTIONS (Video 5 — Handling Objections)
  // ═══════════════════════════════════════
  {
    id: 25, category: 'objections',
    front: "What's the mental stance that keeps a prospect stuck with no urgency to change?",
    back: 'Their frame',
  },
  {
    id: 26, category: 'objections',
    front: 'What are the two emotional drivers that actually cause someone to change?',
    back: 'Pain, and fear of future pain',
  },
  {
    id: 27, category: 'objections',
    front: 'What question keeps chaining deeper into what happens if a prospect does nothing?',
    back: '"Then what happens?"',
  },
  {
    id: 28, category: 'objections',
    front: "What's it called when you contrast a prospect against people who never fixed the problem?",
    back: 'An identity frame',
  },
  {
    id: 29, category: 'objections',
    front: "What tone seeds doubt in a prospect's mind and lowers their guard?",
    back: 'A concerned tone',
  },
  {
    id: 30, category: 'objections',
    front: "What's the mistake most reps make when handling objections?",
    back: 'Arguing their frame instead of reframing it',
  },

  // ═══════════════════════════════════════
  // CATEGORY 6: QUALIFYING (Video 6 — Qualifying the Prospect, BANT — revised 2026-07-01)
  // ═══════════════════════════════════════
  {
    id: 31, category: 'qualifying',
    front: 'What does BANT stand for?',
    back: 'Budget, Authority, Need, Timeline',
  },
  {
    id: 32, category: 'qualifying',
    front: 'What does the "Budget" question in BANT actually determine?',
    back: 'Whether the prospect can afford your product or service',
  },
  {
    id: 33, category: 'qualifying',
    front: 'What does the "Authority" question in BANT actually determine?',
    back: "Whether you're talking to the real decision-maker",
  },
  {
    id: 34, category: 'qualifying',
    front: 'What does the "Need" question in BANT actually determine?',
    back: "The prospect's real pain point or challenge",
  },
  {
    id: 35, category: 'qualifying',
    front: 'What does the "Timeline" question in BANT actually determine?',
    back: "How urgent the prospect is and when they'd actually decide",
  },
  {
    id: 36, category: 'qualifying',
    front: 'Is thoroughly qualifying a prospect considered rude?',
    back: "No — it's intelligent, as long as your tone is right",
  },

  // ═══════════════════════════════════════
  // CATEGORY 7: BOOKING (Video 7 — Booking & Handoff)
  // ═══════════════════════════════════════
  {
    id: 37, category: 'booking',
    front: 'What should you have ready before calling a prospect back?',
    back: "Their info, so you don't re-ask what they already gave you",
  },
  {
    id: 38, category: 'booking',
    front: 'Who notices pushiness more — setters or prospects?',
    back: 'Prospects',
  },
  {
    id: 39, category: 'booking',
    front: 'When is it okay to get more direct/assertive with a prospect?',
    back: 'Only after rapport, value, and qualifying',
  },
  {
    id: 40, category: 'booking',
    front: 'What kind of ask makes it easy for a prospect to say yes?',
    back: 'A small one, like "Got 2 minutes?"',
  },
  {
    id: 41, category: 'booking',
    front: 'What should you do instead of asking "want to move forward?"?',
    back: 'Just book it (assume the appointment)',
  },
  {
    id: 42, category: 'booking',
    front: "When's the best moment to ask for a referral?",
    back: "Right when they're thanking you",
  },

  // ═══════════════════════════════════════
  // CATEGORY 8: TIME MANAGEMENT (Video 8 — Time Management & Call Discipline)
  // ═══════════════════════════════════════
  {
    id: 43, category: 'time-management',
    front: "What's it called when you work off whatever pops up with no plan?",
    back: 'A reactive day',
  },
  {
    id: 44, category: 'time-management',
    front: "What's the best call window for the highest connect rates?",
    back: 'The morning dial block',
  },
  {
    id: 45, category: 'time-management',
    front: "What's dedicated time to build tomorrow's pipeline called?",
    back: 'A sourcing block',
  },
  {
    id: 46, category: 'time-management',
    front: "What's light, low-effort learning, like listening to call reviews at lunch, called?",
    back: 'Passive learning',
  },
  {
    id: 47, category: 'time-management',
    front: 'What turns activity into actual improvement?',
    back: 'End-of-day reflection',
  },
  {
    id: 48, category: 'time-management',
    front: "What's the core mindset behind a structured day — work longer or work smarter?",
    back: 'Work intentional (structure over hours)',
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
