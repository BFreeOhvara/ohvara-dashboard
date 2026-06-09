import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, BookOpen, Mic, MicOff, PhoneOff, Shuffle, ChevronLeft, ChevronRight, Check, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { FLASHCARDS, CATEGORY_LABELS, CATEGORY_COLORS } from '../../data/flashcards'

// ── Constants ─────────────────────────────────────────────────────────────────

const LS_VIDEOS    = 'ohvara_training_videos'
const LS_MASTERED  = 'ohvara_flashcard_mastered'

const TRAINING_VIDEOS = [
  { id: 1, title: 'The Perfect Opener', description: 'How to start a cold call so they don\'t hang up in the first 5 seconds. The exact words to use.', duration: '4 min', category: 'Opener',    youtubeId: 'PLACEHOLDER_1' },
  { id: 2, title: 'Tonality & Energy',  description: 'Why how you say it matters more than what you say. The tone that gets callbacks.', duration: '5 min', category: 'Delivery',   youtubeId: 'PLACEHOLDER_2' },
  { id: 3, title: 'Uncovering Pain',    description: 'The 3 questions that make prospects tell you everything. How to get them talking.', duration: '6 min', category: 'Discovery',  youtubeId: 'PLACEHOLDER_3' },
  { id: 4, title: 'Handling "Not Interested"', description: 'The only objection that matters on a cold call. Exactly what to say and when to let go.', duration: '5 min', category: 'Objections', youtubeId: 'PLACEHOLDER_4' },
  { id: 5, title: 'Booking the Call',   description: 'How to go from good conversation to confirmed appointment. The exact close.', duration: '4 min', category: 'Booking',    youtubeId: 'PLACEHOLDER_5' },
  { id: 6, title: 'Common Mistakes',    description: 'The 5 things new reps do that kill their connect rate. Watch this before your first call.', duration: '7 min', category: 'Mistakes',   youtubeId: 'PLACEHOLDER_6' },
  { id: 7, title: 'The Full Call Walkthrough', description: 'A complete mock call from dial to booked appointment. Watch how it\'s done.', duration: '8 min', category: 'Full Call', youtubeId: 'PLACEHOLDER_7' },
]

const CATEGORY_FILTERS = [
  { key: 'all',       label: 'All Cards',          count: FLASHCARDS.length },
  { key: 'objection', label: 'Objection Handling',  count: FLASHCARDS.filter(c => c.category === 'objection').length },
  { key: 'script',    label: 'Scripts & Openers',   count: FLASHCARDS.filter(c => c.category === 'script').length },
  { key: 'product',   label: 'Product Knowledge',   count: FLASHCARDS.filter(c => c.category === 'product').length },
]

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Score display helpers ──────────────────────────────────────────────────────

function ScoreBar({ label, score, max, color }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color }}>{score}/{max}</span>
      </div>
      <div style={{ height: 4, background: 'var(--bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${(score / max) * 100}%`,
          background: color, borderRadius: 2,
          transition: 'width 0.8s ease',
        }} />
      </div>
    </div>
  )
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
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
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

// ── AIRoleplay ────────────────────────────────────────────────────────────────

function AIRoleplay() {
  const [callState, setCallState]   = useState('idle')   // idle | connecting | active | ending | scoring | scored | unavailable
  const [transcript, setTranscript] = useState([])       // [{role, content}]
  const [score, setScore]           = useState(null)
  const [error, setError]           = useState('')
  const [agentSpeaking, setAgentSpeaking] = useState(false)
  const clientRef  = useRef(null)
  const transcriptEndRef = useRef(null)

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (clientRef.current) {
        try { clientRef.current.stopCall() } catch { /* ignore */ }
      }
    }
  }, [])

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript])

  async function startCall() {
    setCallState('connecting')
    setError('')
    setTranscript([])
    setScore(null)

    try {
      // Get access token from edge function
      const { data, error: fnErr } = await supabase.functions.invoke('create-roleplay-call')
      if (fnErr) throw new Error(fnErr.message)
      if (data?.notConfigured) {
        setCallState('unavailable')
        return
      }
      if (!data?.access_token) throw new Error('No access token returned')

      // Import Retell SDK
      const { RetellWebClient } = await import('retell-client-js-sdk')
      const retell = new RetellWebClient()
      clientRef.current = retell

      retell.on('call_started',        () => setCallState('active'))
      retell.on('agent_start_talking', () => setAgentSpeaking(true))
      retell.on('agent_stop_talking',  () => setAgentSpeaking(false))
      retell.on('update', (update) => {
        if (update?.transcript) {
          setTranscript(update.transcript.map(t => ({
            role: t.role,
            content: t.content,
          })))
        }
      })
      retell.on('call_ended', () => endCallAndScore())
      retell.on('error', (err) => {
        console.error('[Roleplay] Retell error:', err)
        setError(err?.message || 'Connection error')
        setCallState('idle')
      })

      await retell.startCall({ accessToken: data.access_token })
    } catch (err) {
      setError(err.message || 'Failed to start call')
      setCallState('idle')
    }
  }

  const endCallAndScore = useCallback(async () => {
    setCallState('ending')
    try {
      if (clientRef.current) {
        clientRef.current.stopCall()
        clientRef.current = null
      }
    } catch { /* ignore */ }

    setCallState('scoring')

    // Get final transcript
    let finalTranscript = []
    setTranscript(prev => { finalTranscript = prev; return prev })

    // Call score-roleplay
    try {
      const { data } = await supabase.functions.invoke('score-roleplay', {
        body: { transcript: finalTranscript }
      })
      setScore(data)
      setCallState('scored')
    } catch {
      setScore({ notScored: true, summary: 'Call completed. Scoring unavailable.', total: 0, maxTotal: 12 })
      setCallState('scored')
    }
  }, [])

  function handleEndCall() {
    endCallAndScore()
  }

  function handleReset() {
    setCallState('idle')
    setTranscript([])
    setScore(null)
    setError('')
  }

  // ── Idle state ───────────────────────────────────────────────────────────────
  if (callState === 'idle') {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        {/* Persona card */}
        <div className="glass" style={{ padding: '24px', marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{
              width: 52, height: 52, borderRadius: 12, flexShrink: 0,
              background: 'rgba(245,158,11,0.12)', border: '0.5px solid rgba(245,158,11,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
            }}>
              🔧
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>Mike Johnson</p>
                <span style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 3,
                  background: 'rgba(245,158,11,0.1)', color: 'var(--warning)',
                  border: '0.5px solid rgba(245,158,11,0.2)', fontWeight: 500,
                }}>
                  HVAC Owner · Dallas, TX
                </span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                4-person crew. Gets ~30 calls/week but misses 8–10 because everyone's on jobs.
                Gruff but genuine — he has real pain. He'll throw one objection. Book the 15-min call.
              </p>
            </div>
          </div>
        </div>

        {/* Scoring criteria */}
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 10 }}>
            You're scored on
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { label: 'Opener quality',       max: 2, hint: 'Reference Indeed, sound confident' },
              { label: 'Pain discovery',        max: 3, hint: 'Missed calls, after-hours, cost of hire' },
              { label: 'Objection handling',    max: 2, hint: 'Handle "not interested" without pitching' },
              { label: 'Booking ask',           max: 2, hint: 'Ask for a 15-minute call' },
              { label: 'Tone & delivery',       max: 3, hint: 'Calm, peer-to-peer, not robotic' },
            ].map(s => (
              <div key={s.label} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '7px 12px',
                background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
                borderRadius: 7,
              }}>
                <div>
                  <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>{s.hint}</span>
                </div>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  0–{s.max}
                </span>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <p style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12, textAlign: 'center' }}>{error}</p>
        )}

        {/* Start button */}
        <button
          onClick={startCall}
          style={{
            width: '100%', height: 52,
            background: 'var(--accent)',
            border: 'none', borderRadius: 10,
            fontSize: 15, fontWeight: 500, color: 'white',
            cursor: 'pointer', transition: 'all 0.15s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: '0 0 24px rgba(108,99,255,0.35)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-hover)'; e.currentTarget.style.boxShadow = '0 0 32px rgba(108,99,255,0.5)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 24px rgba(108,99,255,0.35)' }}
        >
          <Mic size={16} />
          Start Practice Call
        </button>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 }}>
          Mic access required · calls ~2–3 minutes
        </p>
      </div>
    )
  }

  // ── Unavailable state ────────────────────────────────────────────────────────
  if (callState === 'unavailable') {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', padding: '48px 24px' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'rgba(245,158,11,0.1)', border: '0.5px solid rgba(245,158,11,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 24,
        }}>
          ⏳
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 8 }}>Voice Roleplay — Coming Soon</h2>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 8 }}>
          AI Voice Roleplay is ready to deploy — just needs the <code style={{ background: 'var(--bg-elevated)', padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>RETELL_API_KEY</code> configured in Supabase Edge Function secrets.
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Set in Supabase Dashboard → Settings → Edge Functions → Secrets
        </p>
        <button onClick={handleReset} style={{ marginTop: 20, background: 'var(--bg-surface)', border: '0.5px solid var(--border)', borderRadius: 8, padding: '8px 20px', fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          Back
        </button>
      </div>
    )
  }

  // ── Connecting state ─────────────────────────────────────────────────────────
  if (callState === 'connecting') {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', padding: '64px 24px' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          border: '2px solid var(--accent-border)',
          borderTopColor: 'var(--accent)',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 20px',
        }} />
        <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Connecting to Mike…</p>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // ── Active call state ────────────────────────────────────────────────────────
  if (callState === 'active' || callState === 'ending') {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {/* Call header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 16, padding: '12px 16px',
          background: 'rgba(34,197,94,0.06)', border: '0.5px solid rgba(34,197,94,0.2)',
          borderRadius: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: 'var(--success)',
              animation: 'navPulse 2s ease infinite',
            }} />
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--success)' }}>Live Call — Mike Johnson</span>
            {agentSpeaking && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', animation: 'pulse 1.5s ease infinite' }}>speaking…</span>
            )}
          </div>
          <Mic size={14} style={{ color: 'var(--success)' }} />
        </div>

        {/* Transcript */}
        <div style={{
          height: 260, overflowY: 'auto',
          background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
          borderRadius: 10, padding: '12px 14px', marginBottom: 16,
        }} className="scrollbar-thin">
          {!transcript.length ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', paddingTop: 40 }}>
              Waiting for Mike to answer…
            </p>
          ) : (
            transcript.map((t, i) => {
              const isRep = t.role === 'user'
              return (
                <div key={i} style={{
                  marginBottom: 10,
                  display: 'flex',
                  justifyContent: isRep ? 'flex-end' : 'flex-start',
                }}>
                  <div style={{
                    maxWidth: '80%', padding: '8px 12px', borderRadius: 8,
                    background: isRep ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                    border: `0.5px solid ${isRep ? 'var(--accent-border)' : 'var(--border)'}`,
                  }}>
                    <p style={{ fontSize: 10, color: isRep ? 'var(--accent)' : 'var(--text-muted)', marginBottom: 3 }}>
                      {isRep ? 'You' : 'Mike'}
                    </p>
                    <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4, margin: 0 }}>
                      {t.content}
                    </p>
                  </div>
                </div>
              )
            })
          )}
          <div ref={transcriptEndRef} />
        </div>

        {/* End call button */}
        <button
          onClick={handleEndCall}
          disabled={callState === 'ending'}
          style={{
            width: '100%', height: 48,
            background: 'rgba(239,68,68,0.12)', border: '0.5px solid rgba(239,68,68,0.3)',
            borderRadius: 10, fontSize: 14, fontWeight: 500,
            color: 'var(--danger)', cursor: 'pointer', transition: 'all 0.15s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)' }}
        >
          <PhoneOff size={14} />
          {callState === 'ending' ? 'Ending call…' : 'End Call'}
        </button>
      </div>
    )
  }

  // ── Scoring state ────────────────────────────────────────────────────────────
  if (callState === 'scoring') {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', padding: '64px 24px' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          border: '2px solid var(--accent-border)',
          borderTopColor: 'var(--accent)',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 20px',
        }} />
        <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Analyzing your call…</p>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // ── Scored state ─────────────────────────────────────────────────────────────
  if (callState === 'scored' && score) {
    const totalPct    = Math.round(((score.total || 0) / (score.maxTotal || 12)) * 100)
    const scoreColor  = totalPct >= 75 ? 'var(--success)' : totalPct >= 50 ? 'var(--warning)' : 'var(--danger)'
    const scoreLabel  = totalPct >= 75 ? 'Great call' : totalPct >= 50 ? 'Good effort' : 'Keep practicing'

    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {/* Score header */}
        <div className="glass" style={{ padding: '24px', marginBottom: 16, textAlign: 'center' }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            background: `${scoreColor}14`, border: `2px solid ${scoreColor}40`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 12px',
          }}>
            <span style={{ fontSize: 26, fontFamily: 'var(--font-mono)', fontWeight: 600, color: scoreColor, lineHeight: 1 }}>
              {score.total ?? 0}
            </span>
            <span style={{ fontSize: 10, color: scoreColor }}>/{score.maxTotal ?? 12}</span>
          </div>
          <p style={{ fontSize: 16, fontWeight: 500, color: scoreColor, margin: '0 0 6px' }}>{scoreLabel}</p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>{score.summary}</p>
        </div>

        {/* Score breakdown */}
        {score.scores && (
          <div className="glass" style={{ padding: '16px 20px', marginBottom: 14 }}>
            <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 12 }}>Breakdown</p>
            <ScoreBar label="Opener quality"    score={score.scores.opener           ?? 0} max={2} color="var(--info)" />
            <ScoreBar label="Pain discovery"    score={score.scores.painDiscovery    ?? 0} max={3} color="var(--accent)" />
            <ScoreBar label="Objection handling" score={score.scores.objectionHandling ?? 0} max={2} color="var(--warning)" />
            <ScoreBar label="Booking ask"       score={score.scores.bookingAsk        ?? 0} max={2} color="var(--success)" />
            <ScoreBar label="Tone & delivery"   score={score.scores.tone              ?? 0} max={3} color="var(--info)" />
          </div>
        )}

        {/* Tips + highlights */}
        {score.tips?.length > 0 && (
          <div className="glass" style={{ padding: '16px 20px', marginBottom: 14 }}>
            <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 10 }}>Improve Next Time</p>
            {score.tips.map((tip, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--danger)', flexShrink: 0 }}>→</span>
                <span>{tip}</span>
              </div>
            ))}
          </div>
        )}
        {score.highlights?.length > 0 && (
          <div className="glass" style={{ padding: '16px 20px', marginBottom: 14 }}>
            <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 10 }}>What Worked</p>
            {score.highlights.map((h, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--success)', flexShrink: 0 }}>✓</span>
                <span>{h}</span>
              </div>
            ))}
          </div>
        )}

        {/* Try again */}
        <button
          onClick={handleReset}
          style={{
            width: '100%', height: 48,
            background: 'var(--accent)', border: 'none', borderRadius: 10,
            fontSize: 14, fontWeight: 500, color: 'white',
            cursor: 'pointer', transition: 'all 0.15s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: '0 0 24px rgba(108,99,255,0.3)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-hover)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)' }}
        >
          <Mic size={14} />
          Practice Again
        </button>
      </div>
    )
  }

  return null
}

// ── Main Training Center page ─────────────────────────────────────────────────

const TABS = [
  { id: 'videos',     label: 'Videos',     icon: Play,     count: `${TRAINING_VIDEOS.length} videos` },
  { id: 'flashcards', label: 'Flashcards', icon: BookOpen, count: `${FLASHCARDS.length} cards` },
  { id: 'roleplay',   label: 'AI Roleplay', icon: Mic,      count: null },
]

export default function TrainingCenter() {
  const [tab, setTab] = useState('videos')

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
          Training Center
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          Videos, flashcards, and AI voice roleplay
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
      {tab === 'roleplay'   && <AIRoleplay />}
    </div>
  )
}
