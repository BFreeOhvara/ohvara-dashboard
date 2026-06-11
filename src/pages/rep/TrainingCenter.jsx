import { useState } from 'react'
import { Play, BookOpen, Mic, FileText, Lock, Shuffle, ChevronLeft, ChevronRight, Check, X } from 'lucide-react'
import { FLASHCARDS, CATEGORY_LABELS, CATEGORY_COLORS } from '../../data/flashcards'

// ── Constants ─────────────────────────────────────────────────────────────────

const LS_VIDEOS    = 'ohvara_training_videos'
const LS_MASTERED  = 'ohvara_flashcard_mastered'

// Real YouTube videos — found via AI web search and verified live through
// YouTube's oEmbed endpoint on 2026-06-11. Replace with Ohvara's own
// recordings when available.
const TRAINING_VIDEOS = [
  { id: 1, title: 'The Perfect Opener', description: 'How to start a cold call so they don\'t hang up in the first 5 seconds. The exact words to use.', duration: '6 min', category: 'Opener',    youtubeId: 'nkGuC2gy1To' }, // "Best Cold Call Opening Lines for Sales Reps" — Matt Easton
  { id: 2, title: 'Tonality & Energy',  description: 'Why how you say it matters more than what you say. The tone that gets callbacks.', duration: '9 min', category: 'Delivery',   youtubeId: 'nH3B415NSio' }, // "Cold Calls Are Won With TONE (Not Your Script)" — Sell Better
  { id: 3, title: 'Uncovering Pain',    description: 'The questions that make prospects tell you everything. How to get them talking.', duration: '8 min', category: 'Discovery',  youtubeId: 'swr2VsX5Ank' }, // "Discovery Calls That Don't Suck: How to Uncover Real Pain FAST" — Connor Murray
  { id: 4, title: 'Handling "Not Interested"', description: 'The only objection that matters on a cold call. Exactly what to say and when to let go.', duration: '7 min', category: 'Objections', youtubeId: 'z_JohGi_i7k' }, // "How I Handle 'Not Interested' (Cold Call Script)" — 30 Minutes to President's Club
  { id: 5, title: 'Booking the Call',   description: 'How to go from good conversation to confirmed appointment. The exact close.', duration: '6 min', category: 'Booking',    youtubeId: 'mQ68FJYL8Lg' }, // "Cold Calling Appointment Setting: How to Book the Meeting on the 2nd Ask" — Matt Macnamara
  { id: 6, title: 'Common Mistakes',    description: 'The cold-calling mistakes that kill your connect rate. Watch this before your first call.', duration: '8 min', category: 'Mistakes',   youtubeId: 'dUvLjS064Rw' }, // "Five B2B Cold-Calling Mistakes That Cost You Sales & Customers" — Ian Johnson
  { id: 7, title: 'The Full Call Walkthrough', description: 'A real live cold call from dial to booked meeting. Watch how it\'s done.', duration: '10 min', category: 'Full Call', youtubeId: '4BpD8-BHrJg' }, // "cold call LIVE (what the gurus dont show) 1 meeting booked" — Pavlo
  { id: 8, title: 'The Numbers Game', description: 'Why calling volume beats everything else. The math behind consistent bookings.', duration: '9 min', category: 'Mindset', youtubeId: 'dnOu6ysy7NU' }, // "How I book 3-5 appointments per day (B2B Cold Calling)" — Connor Murray
]

const CATEGORY_FILTERS = [
  { key: 'all',       label: 'All Cards',          count: FLASHCARDS.length },
  { key: 'objection', label: 'Objection Handling',  count: FLASHCARDS.filter(c => c.category === 'objection').length },
  { key: 'script',    label: 'Scripts & Openers',   count: FLASHCARDS.filter(c => c.category === 'script').length },
  { key: 'product',   label: 'Product Knowledge',   count: FLASHCARDS.filter(c => c.category === 'product').length },
]

// The discovery script reps study before practicing. Static content —
// the personalized version is generated per-lead in the Call Now modal.
// color/dim/border values mirror SECTIONS in CallModal.jsx exactly — the rep
// must see the same color system in Training and on a live call.
const DISCOVERY_SCRIPT = [
  {
    id: 'opener',
    title: 'Opener',
    goal: 'Survive the first 10 seconds. Sound like a peer, not a telemarketer.',
    color: 'var(--accent)',  dim: 'rgba(108,99,255,0.08)',  border: 'rgba(108,99,255,0.25)',
    variations: [
      {
        label: `📞 Indeed — Phone Coverage Lead`,
        lines: [
          `"Hey, is this [Business Name]? [First name]? Perfect — I'll be quick, I know you're mid-day."`,
          `"I was looking at your Indeed listing for the [receptionist/front desk/phone] position — how's that search going?"`,
          `If no Indeed listing: "I work with [niche] owners in [city] — quick question, are you the one who handles the phones when the crew's out on jobs?"`,
        ],
        tips: 'Slow down. Lower your tone. The goal of the opener is not to pitch — it is to earn the next 30 seconds.',
      },
      {
        label: `🚛 Indeed — Dispatcher/Coordinator Lead`,
        lines: [
          `"Hey, is this [Business Name]? [First name]? Perfect — super quick."`,
          `"I saw you're looking for a [dispatcher/coordinator/logistics] — is that because scheduling and routing calls is eating up your day?"`,
          `If no Indeed listing: "I work with [niche] owners in [city] — quick question, who's handling your dispatch and scheduling calls right now?"`,
        ],
        tips: `They posted the job because they're drowning in coordination. Let them say it — don't say it for them.`,
      },
      {
        label: `🗺️ Maps — No Website / Low Reviews Lead`,
        lines: [
          `"Hey, is this [Business Name]? [First name]? Perfect — real quick."`,
          `"I was actually looking at your Google listing — are you the owner?"`,
          `"Quick question — when someone finds you on Google and wants to reach out, where are they going right now?"`,
        ],
        tips: `They don't know they have a problem until you make them picture it. A customer who can't find your website calls your competitor instead.`,
      },
    ],
  },
  {
    id: 'discovery',
    title: 'Problem Discovery',
    goal: 'Get them talking about missed calls and lost jobs. Ask, then shut up.',
    color: 'var(--info)',    dim: 'rgba(56,189,248,0.08)',  border: 'rgba(56,189,248,0.25)',
    lines: [
      `"When a customer calls and everyone's on a job — what happens to that call?"`,
      `"Roughly how many calls a week would you say go to voicemail?"`,
      `"And of those, how many do you think actually leave a message versus just calling the next company on the list?"`,
    ],
    tips: 'Every question should make the problem bigger in THEIR head. You are not telling them they have a problem — they are telling you.',
  },
  {
    id: 'pain',
    title: 'Pain Amplification',
    goal: 'Turn "yeah we miss some calls" into a dollar figure they can feel.',
    color: 'var(--warning)', dim: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.25)',
    lines: [
      `"Let's do quick math — if you're missing 8 calls a week and even 3 of those are real jobs at, what, $400 each? That's close to $5K a month walking to a competitor."`,
      `"And that's not counting the after-hours calls. What happens when someone calls at 7pm with a burst pipe?"`,
      `"Most owners I talk to know they're losing jobs — they just haven't put a number on it. Does that number surprise you?"`,
    ],
    tips: 'Use THEIR numbers from discovery, not yours. A number they gave you is a number they believe.',
  },
  {
    id: 'objections',
    title: 'Objection Handling',
    goal: 'Acknowledge, reframe, ask one more question. Never argue.',
    color: 'var(--danger)',  dim: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)',
    lines: [
      `"Not interested" → "Totally fair — most owners say that until they see the missed-call math. One question and I'll let you go: what happens to a call you can't answer right now?"`,
      `"Too busy" → "That's exactly why I called. This takes 15 minutes and it's about getting you hours back, not taking them."`,
      `"We have someone for that" → "Nice — does that cover after-hours and weekends too? That's usually where the gap is."`,
      `"Send me an email" → "Happy to — but honestly the email won't mean much without the numbers. Let's grab 15 minutes and I'll walk you through it live."`,
    ],
    tips: 'One objection handled well earns the close. Two objections means let go gracefully — leave the door open and log it as a callback.',
  },
  {
    id: 'close',
    title: 'Close / Book',
    goal: 'Ask for the 15-minute call. Offer two times. Confirm and get off the phone.',
    color: 'var(--success)', dim: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.25)',
    lines: [
      `"Look, I don't want to eat up your morning. Let's do a quick 15-minute call this week — I'll show you exactly how many calls you're missing and what they're worth."`,
      `"Does Tuesday afternoon or Thursday morning work better?"`,
      `After they pick: "Perfect — [day] at [time]. You'll get a text reminder. What's the best cell for that?"`,
    ],
    tips: 'Always offer two specific times — never "when works for you?". Confirm the number, confirm the time, end the call. Do not keep selling after the yes.',
  },
]

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── VideoLibrary ──────────────────────────────────────────────────────────────

function VideoLibrary() {
  const [watched, setWatched]   = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_VIDEOS) || '[]') } catch { return [] }
  })
  const [activeVideo, setActiveVideo] = useState(null)

  function toggleWatched(id) {
    setWatched(prev => {
      const next = prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]
      localStorage.setItem(LS_VIDEOS, JSON.stringify(next))
      return next
    })
  }

  const isPlaceholder = (id) => id.startsWith('PLACEHOLDER')

  return (
    <div>
      {/* Progress strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
        borderRadius: 10, padding: '10px 16px', marginBottom: 20,
      }}>
        <div style={{ flex: 1, height: 4, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${(watched.length / TRAINING_VIDEOS.length) * 100}%`,
            background: 'var(--success)', borderRadius: 2,
            transition: 'width 0.4s ease',
          }} />
        </div>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', flexShrink: 0 }}>
          {watched.length} / {TRAINING_VIDEOS.length} watched
        </span>
      </div>

      {/* Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 14,
      }}>
        {TRAINING_VIDEOS.map(v => {
          const done = watched.includes(v.id)
          return (
            <div
              key={v.id}
              className="glass"
              style={{ padding: 16, cursor: 'pointer', transition: 'border-color 0.15s', position: 'relative' }}
              onClick={() => !isPlaceholder(v.youtubeId) && setActiveVideo(v)}
            >
              {/* Thumbnail */}
              <div style={{
                height: 120,
                background: done ? 'rgba(34,197,94,0.06)' : 'var(--accent-dim)',
                borderRadius: 8, marginBottom: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `0.5px solid ${done ? 'rgba(34,197,94,0.2)' : 'var(--accent-border)'}`,
                position: 'relative', overflow: 'hidden',
              }}>
                {isPlaceholder(v.youtubeId) ? (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{
                      width: 40, height: 40,
                      background: 'rgba(108,99,255,0.2)',
                      borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      margin: '0 auto 8px',
                    }}>
                      <Play size={16} style={{ color: 'var(--accent)', marginLeft: 2 }} />
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>Coming Soon</p>
                  </div>
                ) : (
                  <div style={{
                    width: 44, height: 44,
                    background: done ? 'var(--success)' : 'var(--accent)',
                    borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {done
                      ? <Check size={18} color="white" />
                      : <Play size={18} color="white" style={{ marginLeft: 2 }} />
                    }
                  </div>
                )}
                {/* Duration badge */}
                <span style={{
                  position: 'absolute', bottom: 6, right: 8,
                  fontSize: 10, fontFamily: 'var(--font-mono)',
                  color: 'var(--text-muted)', background: 'rgba(8,8,16,0.7)',
                  padding: '1px 5px', borderRadius: 3,
                }}>
                  {v.duration}
                </span>
              </div>

              {/* Meta */}
              <div style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                {v.category}
              </div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4, lineHeight: 1.3 }}>
                {v.title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {v.description}
              </div>

              {/* Completion checkbox */}
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={e => { e.stopPropagation(); toggleWatched(v.id) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: done ? 'rgba(34,197,94,0.08)' : 'transparent',
                    border: `0.5px solid ${done ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
                    borderRadius: 5, padding: '4px 8px',
                    fontSize: 11, color: done ? 'var(--success)' : 'var(--text-muted)',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  <Check size={10} />
                  {done ? 'Marked complete' : 'Mark complete'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Video modal */}
      {activeVideo && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(8,8,16,0.92)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setActiveVideo(null)}
        >
          <div
            style={{ width: '100%', maxWidth: 720, background: 'var(--bg-surface)', borderRadius: 14, overflow: 'hidden', border: '0.5px solid var(--border)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid var(--border)' }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>{activeVideo.title}</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{activeVideo.category} · {activeVideo.duration}</p>
              </div>
              <button onClick={() => setActiveVideo(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ position: 'relative', paddingTop: '56.25%' }}>
              <iframe
                src={`https://www.youtube.com/embed/${activeVideo.youtubeId}?autoplay=1`}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
                allow="autoplay; fullscreen"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── FlashcardDeck ─────────────────────────────────────────────────────────────

function FlashcardDeck() {
  const [filter, setFilter]     = useState('all')
  const [deck, setDeck]         = useState(() => FLASHCARDS)
  const [index, setIndex]       = useState(0)
  const [flipped, setFlipped]   = useState(false)
  const [mastered, setMastered] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS_MASTERED) || '[]')) } catch { return new Set() }
  })
  const [animDir, setAnimDir]   = useState(null) // 'left' | 'right'

  const filteredDeck = deck.filter(c => filter === 'all' || c.category === filter)
  const card = filteredDeck[index] || null
  const masteredInDeck = filteredDeck.filter(c => mastered.has(c.id)).length

  function saveMastered(next) {
    localStorage.setItem(LS_MASTERED, JSON.stringify([...next]))
  }

  function handleShuffle() {
    setDeck(shuffle(FLASHCARDS))
    setIndex(0)
    setFlipped(false)
  }

  function handleFilter(key) {
    setFilter(key)
    setIndex(0)
    setFlipped(false)
  }

  function navigate(dir) {
    if (!filteredDeck.length) return
    setAnimDir(dir)
    setFlipped(false)
    setTimeout(() => {
      setIndex(i => {
        if (dir === 'next') return (i + 1) % filteredDeck.length
        return (i - 1 + filteredDeck.length) % filteredDeck.length
      })
      setAnimDir(null)
    }, 180)
  }

  function handleMaster() {
    if (!card) return
    setMastered(prev => {
      const next = new Set(prev)
      if (next.has(card.id)) { next.delete(card.id) } else { next.add(card.id) }
      saveMastered(next)
      return next
    })
  }

  const isMastered = card ? mastered.has(card.id) : false
  const catColor   = card ? (CATEGORY_COLORS[card.category] || 'var(--accent)') : 'var(--accent)'

  return (
    <div>
      <style>{`
        .fc-container { perspective: 1200px; }
        .fc-inner {
          position: relative; transition: transform 0.5s cubic-bezier(0.4,0,0.2,1);
          transform-style: preserve-3d;
        }
        .fc-inner.is-flipped { transform: rotateY(180deg); }
        .fc-face {
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }
        .fc-back-face { transform: rotateY(180deg); }
        .fc-slide-left  { animation: fcSlideLeft  0.18s ease forwards; }
        .fc-slide-right { animation: fcSlideRight 0.18s ease forwards; }
        @keyframes fcSlideLeft  { from { opacity: 1; transform: translateX(0);    } to { opacity: 0; transform: translateX(-20px); } }
        @keyframes fcSlideRight { from { opacity: 1; transform: translateX(0);    } to { opacity: 0; transform: translateX(20px);  } }
        .cat-pill { padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; transition: all 0.12s; }
      `}</style>

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        {/* Category filters */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CATEGORY_FILTERS.map(f => {
            const active = filter === f.key
            return (
              <button
                key={f.key}
                className="cat-pill"
                onClick={() => handleFilter(f.key)}
                style={{
                  background: active ? 'var(--accent-dim)' : 'var(--bg-surface)',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  border: `0.5px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
                }}
              >
                {f.label} · {f.count}
              </button>
            )
          })}
        </div>

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            {masteredInDeck} / {filteredDeck.length} mastered
          </span>
          <button
            onClick={handleShuffle}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
              borderRadius: 6, padding: '5px 10px', fontSize: 12,
              color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
          >
            <Shuffle size={12} /> Shuffle
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: 'var(--bg-elevated)', borderRadius: 2, marginBottom: 20, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: filteredDeck.length ? `${((index + 1) / filteredDeck.length) * 100}%` : '0%',
          background: catColor, borderRadius: 2, transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Card counter */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          {filteredDeck.length ? `${index + 1} / ${filteredDeck.length}` : '—'}
        </span>
      </div>

      {/* Flip card */}
      {card ? (
        <div
          className={`fc-container ${animDir === 'next' ? 'fc-slide-left' : animDir === 'prev' ? 'fc-slide-right' : ''}`}
          style={{ maxWidth: 560, margin: '0 auto', cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setFlipped(v => !v)}
        >
          <div className={`fc-inner ${flipped ? 'is-flipped' : ''}`} style={{ minHeight: 220 }}>
            {/* Front face */}
            <div className="fc-face" style={{
              position: flipped ? 'absolute' : 'relative',
              inset: 0,
              background: 'var(--bg-surface)',
              border: `0.5px solid ${isMastered ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
              borderRadius: 14,
              padding: '36px 32px 28px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', minHeight: 220,
              boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
            }}>
              {/* Category badge */}
              <div style={{
                position: 'absolute', top: 12, left: 14,
                fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: catColor,
                padding: '2px 8px', borderRadius: 20,
                background: `${catColor}18`, border: `0.5px solid ${catColor}33`,
              }}>
                {CATEGORY_LABELS[card.category]}
              </div>
              {isMastered && (
                <div style={{
                  position: 'absolute', top: 12, right: 14,
                  background: 'rgba(34,197,94,0.1)', border: '0.5px solid rgba(34,197,94,0.25)',
                  borderRadius: 4, padding: '2px 6px',
                  fontSize: 10, color: 'var(--success)',
                }}>
                  ✓ Mastered
                </div>
              )}
              <p style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.4, margin: 0 }}>
                {card.front}
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 20, letterSpacing: '0.04em' }}>
                Tap to reveal answer
              </p>
            </div>

            {/* Back face */}
            <div className="fc-face fc-back-face" style={{
              position: 'absolute', inset: 0,
              background: 'var(--bg-surface)',
              border: `0.5px solid ${catColor}40`,
              borderRadius: 14,
              padding: '36px 32px 28px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              textAlign: 'center', minHeight: 220,
              boxShadow: `0 4px 24px rgba(0,0,0,0.3), 0 0 0 1px ${catColor}20`,
            }}>
              <div style={{
                position: 'absolute', top: 12, left: 14,
                fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: catColor,
                padding: '2px 8px', borderRadius: 20,
                background: `${catColor}18`, border: `0.5px solid ${catColor}33`,
              }}>
                Answer
              </div>
              <p style={{ fontSize: 15, color: catColor, lineHeight: 1.6, margin: 0, fontStyle: card.category === 'script' ? 'italic' : 'normal' }}>
                {card.back}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>No cards in this filter.</p>
        </div>
      )}

      {/* Action row */}
      {card && (
        <div style={{ maxWidth: 560, margin: '16px auto 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          {/* Prev */}
          <button
            onClick={() => navigate('prev')}
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'var(--text-muted)', transition: 'all 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <ChevronLeft size={16} />
          </button>

          {/* Master button */}
          <button
            onClick={handleMaster}
            style={{
              flex: 1, height: 40,
              background: isMastered ? 'rgba(34,197,94,0.1)' : 'var(--bg-surface)',
              border: `0.5px solid ${isMastered ? 'rgba(34,197,94,0.35)' : 'var(--border)'}`,
              borderRadius: 8,
              fontSize: 13, fontWeight: 500,
              color: isMastered ? 'var(--success)' : 'var(--text-secondary)',
              cursor: 'pointer', transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <Check size={13} />
            {isMastered ? 'Mastered ✓' : 'Mark Mastered'}
          </button>

          {/* Next */}
          <button
            onClick={() => navigate('next')}
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'var(--accent)', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'white', transition: 'all 0.12s',
              boxShadow: '0 0 16px rgba(108,99,255,0.3)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)' }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── DiscoveryScript ───────────────────────────────────────────────────────────
// Static, readable version of the call script. Reps study this before practicing.

function DiscoveryScript() {
  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 24 }}>
        This is the full discovery script used on every cold call. Study each section until
        you can deliver it without reading. The Call Now button on your leads generates a
        version personalized to each business.
      </p>

      {DISCOVERY_SCRIPT.map((section, i) => (
        <div
          key={section.id}
          className="glass"
          style={{
            padding: '20px 22px', marginBottom: 16, borderRadius: 12,
            // Same color treatment as the Call Now modal SECTIONS cards
            background: section.dim,
            border: `0.5px solid ${section.border}`,
            borderLeft: `3px solid ${section.color}`,
          }}
        >
          {/* Section header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{
              width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
              background: section.dim, border: `0.5px solid ${section.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontFamily: 'var(--font-mono)', color: section.color, fontWeight: 600,
            }}>
              {i + 1}
            </span>
            <h2 style={{
              fontSize: 15, fontWeight: 500, color: section.color, margin: 0,
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              {section.title}
            </h2>
          </div>

          {/* Goal */}
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 14px 34px', fontStyle: 'italic' }}>
            Goal: {section.goal}
          </p>

          {section.variations ? (
            /* Opener: 3 labeled variations — one per entry point. Stacked column = mobile safe. */
            <div style={{ marginLeft: 34, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {section.variations.map((v, k) => (
                <div key={k} style={{
                  border: `0.5px solid ${section.border}`,
                  borderRadius: 10, padding: '14px 16px',
                  background: 'var(--bg-surface)',
                }}>
                  <p style={{
                    fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.09em',
                    color: section.color, margin: '0 0 10px', fontWeight: 600,
                  }}>
                    {v.label}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {v.lines.map((line, j) => (
                      <p key={j} style={{
                        fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0,
                        padding: '10px 14px',
                        background: 'var(--bg-elevated)', borderRadius: 8,
                        borderLeft: `2px solid ${section.border}`,
                      }}>
                        {line}
                      </p>
                    ))}
                  </div>
                  <div style={{
                    marginTop: 10, padding: '8px 12px',
                    background: 'rgba(245,158,11,0.06)', border: '0.5px solid rgba(245,158,11,0.18)',
                    borderRadius: 8,
                  }}>
                    <p style={{ fontSize: 12, color: 'var(--warning)', margin: 0, lineHeight: 1.6 }}>
                      Coach's note: {v.tips}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Script lines */}
              <div style={{ marginLeft: 34, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {section.lines.map((line, j) => (
                  <p key={j} style={{
                    fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0,
                    padding: '10px 14px',
                    background: 'var(--bg-elevated)', borderRadius: 8,
                    borderLeft: `2px solid ${section.border}`,
                  }}>
                    {line}
                  </p>
                ))}
              </div>

              {/* Coaching tip */}
              <div style={{
                marginLeft: 34, marginTop: 12,
                padding: '8px 12px',
                background: 'rgba(245,158,11,0.06)', border: '0.5px solid rgba(245,158,11,0.18)',
                borderRadius: 8,
              }}>
                <p style={{ fontSize: 12, color: 'var(--warning)', margin: 0, lineHeight: 1.6 }}>
                  Coach's note: {section.tips}
                </p>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

// ── AIRoleplay — Coming Soon ──────────────────────────────────────────────────
// Voice roleplay ships once RETELL_API_KEY is configured. Intentional locked state.

function AIRoleplay() {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', padding: '56px 24px' }}>
      <div style={{
        width: 64, height: 64, borderRadius: 16,
        background: 'var(--accent-dim)', border: '0.5px solid var(--accent-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 20px',
      }}>
        <Lock size={26} color="var(--accent)" />
      </div>

      <h2 style={{ fontSize: 19, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 10px', letterSpacing: '-0.01em' }}>
        AI Voice Roleplay — Coming Soon
      </h2>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, margin: '0 0 24px' }}>
        Practice live cold calls against an AI business owner who pushes back like the real
        thing — then get scored on your opener, discovery, objection handling, and close.
      </p>

      {/* What's coming */}
      <div style={{ textAlign: 'left', marginBottom: 24 }}>
        {[
          'Live voice conversation with a realistic owner persona',
          'Real objections — "not interested", "too busy", "send an email"',
          'Instant scorecard with tips after every call',
        ].map((item, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', marginBottom: 6,
            background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
            borderRadius: 8,
          }}>
            <Mic size={13} color="var(--accent)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{item}</span>
          </div>
        ))}
      </div>

      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', borderRadius: 8,
        background: 'rgba(245,158,11,0.08)', border: '0.5px solid rgba(245,158,11,0.2)',
      }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--warning)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: 'var(--warning)' }}>
          Unlocks when <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>RETELL_API_KEY</code> is configured
        </span>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 20 }}>
        In the meantime, master the <strong style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Script</strong> tab — that's what you'll be scored on.
      </p>
    </div>
  )
}

// ── Main Training Center page ─────────────────────────────────────────────────

const TABS = [
  { id: 'script',     label: 'Script',      icon: FileText, count: null },
  { id: 'videos',     label: 'Videos',      icon: Play,     count: `${TRAINING_VIDEOS.length} videos` },
  { id: 'flashcards', label: 'Flashcards',  icon: BookOpen, count: `${FLASHCARDS.length} cards` },
  { id: 'roleplay',   label: 'AI Roleplay', icon: Mic,      count: null },
]

export default function TrainingCenter() {
  const [tab, setTab] = useState('script')

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
          Training Center
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          Videos, flashcards, the discovery script, and AI voice roleplay
        </p>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 24,
        background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
        borderRadius: 10, padding: 4,
        width: 'fit-content',
      }}>
        {TABS.map(t => {
          const active = tab === t.id
          const Icon   = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '7px 14px', borderRadius: 7, border: 'none',
                background: active ? 'var(--bg-elevated)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: 13, fontWeight: active ? 500 : 400,
                cursor: 'pointer', transition: 'all 0.12s',
                boxShadow: active ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
              }}
            >
              <Icon size={13} style={{ color: active ? 'var(--accent)' : 'inherit' }} />
              {t.label}
              {t.count && (
                <span style={{
                  fontSize: 10, padding: '1px 5px', borderRadius: 3,
                  background: active ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {t.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {tab === 'videos'     && <VideoLibrary />}
      {tab === 'flashcards' && <FlashcardDeck />}
      {tab === 'script'     && <DiscoveryScript />}
      {tab === 'roleplay'   && <AIRoleplay />}
    </div>
  )
}
