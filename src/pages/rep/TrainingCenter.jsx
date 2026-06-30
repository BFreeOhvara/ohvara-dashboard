import { useState, useEffect, useRef, useMemo } from 'react'
import { Play, BookOpen, Mic, FileText, Lock, Shuffle, ChevronLeft, ChevronRight, Check, X, ClipboardCheck, Loader2, PhoneOff, RotateCcw, Award } from 'lucide-react'
import { FLASHCARDS, CATEGORY_LABELS, CATEGORY_COLORS } from '../../data/flashcards'
import { supabase } from '../../lib/supabase'
import { useCapability } from '../../contexts/SecretsContext'
import { useAuth } from '../../hooks/useAuth'
import {
  useTrainingProgress, useSaveTrainingProgress, trainingChecks, isTrainingComplete,
  TOTAL_VIDEOS, QUIZ_QUESTIONS, QUIZ_PASS_PCT, ROLEPLAY_PASS_SCORE, ROLEPLAY_PASS_GRADE, gradeFromScore,
} from '../../hooks/useTraining'
import { buildScriptFlow } from '../../lib/discoveryScript'
import { ScriptCanvas } from '../../components/rep/ScriptCanvas'

// ── Constants ─────────────────────────────────────────────────────────────────

const LS_VIDEOS           = 'ohvara_training_videos'
const LS_MASTERED         = 'ohvara_flashcard_mastered'
const LS_FINAL_QUIZ_PASS  = 'ohvara_final_quiz_passed'

// 8 topics locked 2026-06-30 — see brain/training-videos.md. Durations
// verified live via Chrome on 2026-06-30, all under 10 minutes.
const TRAINING_VIDEOS = [
  { id: 1, title: 'What an AI Receptionist Does',        description: 'Plain-terms product knowledge — what it does, why a business owner should care, in 30 seconds.', duration: '7:40', category: 'Product',    youtubeId: '0_TQV5tfFds' },
  { id: 2, title: 'Tonality & Delivery',                  description: 'Sounding like a peer who found them a fix, not a telemarketer.', duration: '9:35', category: 'Delivery',   youtubeId: 'vjj9qOxGCgk' },
  { id: 3, title: 'The Discovery Script',                 description: 'Why questions about missed calls beat pitching the AI upfront.', duration: '4:34', category: 'Discovery',  youtubeId: 'dDGX95UkV10' },
  { id: 4, title: 'Getting Past the Gatekeeper',          description: 'Reaching the owner without sounding like "another AI sales call."', duration: '7:40', category: 'Gatekeeper', youtubeId: 'krveop9O-ik' },
  { id: 5, title: 'Handling Objections',                  description: '"We already have a system," "AI feels impersonal," "send me an email."', duration: '8:59', category: 'Objections', youtubeId: 'mDWUpuumAuo' },
  { id: 6, title: 'Qualifying the Prospect',               description: 'Missed calls/week × avg ticket — the math that proves the pain is real.', duration: '9:16', category: 'Qualifying', youtubeId: 'dj3J75I0GYQ' },
  { id: 7, title: 'Booking & Handoff',                    description: 'Framing Nate as the AI/automation specialist, not "the closer."', duration: '8:23', category: 'Booking',    youtubeId: '4mrM8GO6SS0' },
  { id: 8, title: 'Time Management & Call Discipline',    description: 'Structuring the 150-lead day in this specific niche.', duration: '7:08', category: 'Mindset',    youtubeId: 'ga5_EizLwdw' },
]

// Placeholder mini-quiz generator — 4 questions per video, swapped for
// transcript-derived content once Brayden's transcriptions come in.
function buildMiniQuiz(video) {
  return Array.from({ length: 4 }).map((_, i) => ({
    id: `${video.id}-mini-${i}`,
    question: `Placeholder Q${i + 1} for "${video.title}" — replace once transcript-derived questions are ready`,
    options: ['Placeholder answer A', 'Placeholder answer B', 'Placeholder answer C', 'Placeholder answer D'],
    correctIndex: 0,
  }))
}

// Placeholder final-quiz pool — 28 questions, ~3-4 per video, swapped for
// transcript-derived content once Brayden's transcriptions come in.
const FINAL_QUIZ_PASS_PCT = 85
function buildFinalQuizPool() {
  const pool = []
  TRAINING_VIDEOS.forEach(v => {
    for (let i = 0; i < 3; i++) {
      pool.push({
        id: `${v.id}-final-${i}`,
        category: v.title,
        question: `Placeholder Q${i + 1} for "${v.title}" — replace once transcript-derived questions are ready`,
        options: shuffle([
          { text: 'Placeholder correct answer', correct: true },
          { text: 'Placeholder distractor A', correct: false },
          { text: 'Placeholder distractor B', correct: false },
          { text: 'Placeholder distractor C', correct: false },
        ]),
      })
    }
  })
  return shuffle(pool).slice(0, 28)
}

const CATEGORY_FILTERS = [
  { key: 'all', label: 'All Cards', count: FLASHCARDS.length },
  ...Object.entries(CATEGORY_LABELS).map(([key, label]) => ({
    key, label, count: FLASHCARDS.filter(c => c.category === key).length,
  })),
]

// DISCOVERY_SCRIPT (the universal discovery script) now lives in
// src/lib/discoveryScript.js — imported above and shared with the Call Now
// modal so Training and a live call show the exact same script.

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── LockedVideoPlayer — YouTube IFrame API, blocks seeking ahead ──────────────
// Only player chrome allowed is fullscreen + volume. We can't strip YouTube's
// own seekbar, but we snap any forward seek back to the furthest-watched
// point every second, and disable keyboard shortcuts (arrow-key skip).

function LockedVideoPlayer({ video, onEnded }) {
  const containerRef = useRef(null)
  const playerRef    = useRef(null)
  const maxTimeRef   = useRef(0)
  const endedRef     = useRef(false)

  useEffect(() => {
    let cancelled = false
    maxTimeRef.current = 0
    endedRef.current = false

    function createPlayer() {
      if (cancelled || !containerRef.current) return
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId: video.youtubeId,
        playerVars: { autoplay: 1, controls: 1, modestbranding: 1, rel: 0, fs: 1, disablekb: 1, playsinline: 1 },
        events: {
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.ENDED && !endedRef.current) {
              endedRef.current = true
              onEnded()
            }
          },
        },
      })
    }

    if (window.YT && window.YT.Player) {
      createPlayer()
    } else {
      if (!document.getElementById('yt-iframe-api')) {
        const tag = document.createElement('script')
        tag.id = 'yt-iframe-api'
        tag.src = 'https://www.youtube.com/iframe_api'
        document.body.appendChild(tag)
      }
      const prevReady = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => { prevReady?.(); createPlayer() }
    }

    return () => {
      cancelled = true
      try { playerRef.current?.destroy?.() } catch { /* ignore */ }
    }
  }, [video.youtubeId])

  // Block scrubbing ahead — snap back to furthest-watched position
  useEffect(() => {
    const interval = setInterval(() => {
      const p = playerRef.current
      if (!p || typeof p.getCurrentTime !== 'function') return
      const t = p.getCurrentTime()
      if (t > maxTimeRef.current + 1.5) {
        p.seekTo(maxTimeRef.current, true)
      } else if (t > maxTimeRef.current) {
        maxTimeRef.current = t
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}

// ── MiniQuiz — per-video, formative only, never blocks progress ──────────────

function MiniQuiz({ video, onDone }) {
  const [questions]  = useState(() => buildMiniQuiz(video))
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState(null)

  function pick(i) {
    if (picked !== null) return
    setPicked(i)
    setTimeout(() => {
      if (index + 1 >= questions.length) {
        onDone()
      } else {
        setIndex(v => v + 1)
        setPicked(null)
      }
    }, 700)
  }

  const q = questions[index]
  return (
    <div style={{ padding: '20px 24px' }}>
      <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', margin: '0 0 10px' }}>
        Quick check · {index + 1}/{questions.length}
      </p>
      <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.5, margin: '0 0 14px' }}>
        {q.question}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {q.options.map((opt, i) => {
          const showFeedback = picked !== null
          const isCorrect = i === q.correctIndex
          const isPicked = picked === i
          const color = !showFeedback ? 'var(--border)' : isCorrect ? 'rgba(34,197,94,0.5)' : isPicked ? 'rgba(239,68,68,0.5)' : 'var(--border)'
          return (
            <button
              key={i}
              onClick={() => pick(i)}
              disabled={picked !== null}
              style={{
                textAlign: 'left', padding: '10px 12px', fontSize: 13,
                background: showFeedback && isCorrect ? 'rgba(34,197,94,0.08)' : showFeedback && isPicked ? 'rgba(239,68,68,0.08)' : 'var(--bg-surface)',
                border: `0.5px solid ${color}`, borderRadius: 8,
                color: showFeedback ? (isCorrect ? 'var(--success)' : isPicked ? 'var(--danger)' : 'var(--text-muted)') : 'var(--text-secondary)',
                cursor: picked === null ? 'pointer' : 'default',
              }}
            >
              {opt}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── VideoLibrary ──────────────────────────────────────────────────────────────

function VideoLibrary({ progress, saveProgress }) {
  // Watched state lives in training_progress (it gates lead access);
  // localStorage stays as a fallback merge for pre-gate completions.
  const [watched, setWatched] = useState(() => {
    const fromDb = Array.isArray(progress?.videos_watched) ? progress.videos_watched : []
    let fromLs = []
    try { fromLs = JSON.parse(localStorage.getItem(LS_VIDEOS) || '[]') } catch { /* ignore */ }
    return [...new Set([...fromDb, ...fromLs])]
  })
  const [activeVideo, setActiveVideo] = useState(null)
  // 'playing' while locked, 'quiz' once the video ends and the mini quiz shows
  const [stage, setStage] = useState('playing')

  // DB row loads async — merge it in when it arrives
  useEffect(() => {
    const fromDb = Array.isArray(progress?.videos_watched) ? progress.videos_watched : []
    if (fromDb.length) setWatched(prev => prev.length === new Set([...prev, ...fromDb]).size ? prev : [...new Set([...prev, ...fromDb])])
  }, [progress])

  function markWatched(id) {
    setWatched(prev => {
      if (prev.includes(id)) return prev
      const next = [...prev, id]
      localStorage.setItem(LS_VIDEOS, JSON.stringify(next))
      saveProgress({ videos_watched: next })
      return next
    })
  }

  function openVideo(v) {
    setActiveVideo(v)
    setStage('playing')
  }

  function closeVideo() {
    setActiveVideo(null)
    setStage('playing')
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
              onClick={() => !isPlaceholder(v.youtubeId) && openVideo(v)}
            >
              {/* Thumbnail — flush with the card's top corners (.glass is
                  12px radius, card padding 16px → negative margins) */}
              <div style={{
                position: 'relative', overflow: 'hidden',
                margin: '-16px -16px 12px',
                height: 120,
                borderRadius: '12px 12px 0 0',
                background: 'var(--bg-elevated)',
              }}>
                {isPlaceholder(v.youtubeId) ? (
                  <div style={{
                    height: '100%', background: 'var(--accent-dim)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <div style={{
                      width: 40, height: 40,
                      background: 'rgba(108,99,255,0.2)',
                      borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginBottom: 8,
                    }}>
                      <Play size={16} style={{ color: 'var(--accent)', marginLeft: 2 }} />
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>Coming Soon</p>
                  </div>
                ) : (
                  <>
                    <img
                      src={`https://img.youtube.com/vi/${v.youtubeId}/hqdefault.jpg`}
                      alt={v.title}
                      loading="lazy"
                      style={{
                        display: 'block', width: '100%', height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                    {/* Play overlay — white semi-transparent circle + CSS triangle */}
                    <div style={{
                      position: 'absolute', top: '50%', left: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: 42, height: 42, borderRadius: '50%',
                      background: 'rgba(255,255,255,0.78)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{
                        display: 'block', width: 0, height: 0, marginLeft: 4,
                        borderTop: '8px solid transparent',
                        borderBottom: '8px solid transparent',
                        borderLeft: '13px solid rgba(8,8,16,0.85)',
                      }} />
                    </div>
                    {/* Watched badge */}
                    {done && (
                      <span style={{
                        position: 'absolute', top: 8, right: 8,
                        width: 22, height: 22, borderRadius: '50%',
                        background: 'var(--success)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, color: 'white', fontWeight: 500,
                        boxShadow: '0 1px 6px rgba(0,0,0,0.4)',
                      }}>
                        ✓
                      </span>
                    )}
                  </>
                )}
                {/* Duration badge */}
                <span style={{
                  position: 'absolute', bottom: 6, right: 8,
                  fontSize: 10, fontFamily: 'var(--font-mono)',
                  color: 'white', background: 'rgba(8,8,16,0.75)',
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

              {/* Completion status — only earned by watching the video through (locked player) */}
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: done ? 'rgba(34,197,94,0.08)' : 'transparent',
                  border: `0.5px solid ${done ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
                  borderRadius: 5, padding: '4px 8px',
                  fontSize: 11, color: done ? 'var(--success)' : 'var(--text-muted)',
                }}>
                  {done ? <Check size={10} /> : null}
                  {done ? 'Completed' : 'Not watched'}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Video modal — locked while playing: no backdrop close, no X, no skip ahead */}
      {activeVideo && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(8,8,16,0.92)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
          onClick={e => { if (stage !== 'playing') closeVideo() }}
        >
          <div
            style={{ width: '100%', maxWidth: 720, background: 'var(--bg-surface)', borderRadius: 14, overflow: 'hidden', border: '0.5px solid var(--border)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid var(--border)' }}>
              <div>
                <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>{activeVideo.title}</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                  {activeVideo.category} · {activeVideo.duration}
                  {stage === 'playing' && <span style={{ color: 'var(--warning)' }}> · locked until finished</span>}
                </p>
              </div>
              {stage !== 'playing' && (
                <button onClick={closeVideo} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
                  <X size={16} />
                </button>
              )}
            </div>

            {stage === 'playing' ? (
              <div style={{ position: 'relative', paddingTop: '56.25%' }}>
                <div style={{ position: 'absolute', inset: 0 }}>
                  <LockedVideoPlayer
                    video={activeVideo}
                    onEnded={() => { markWatched(activeVideo.id); setStage('quiz') }}
                  />
                </div>
              </div>
            ) : (
              <MiniQuiz video={activeVideo} onDone={closeVideo} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── FlashcardDeck ─────────────────────────────────────────────────────────────

function FlashcardDeck({ onAllMastered }) {
  const [filter, setFilter]     = useState('all')
  const [deck, setDeck]         = useState(() => FLASHCARDS)
  const [index, setIndex]       = useState(0)
  const [flipped, setFlipped]   = useState(false)
  const [mastered, setMastered] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS_MASTERED) || '[]')) } catch { return new Set() }
  })
  const [animDir, setAnimDir]   = useState(null) // 'left' | 'right'
  const [allMasteredMsg, setAllMasteredMsg] = useState(false)

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
      if (next.size >= FLASHCARDS.length) {
        setAllMasteredMsg(true)
        onAllMastered?.()
      }
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

      {/* All-mastered success message */}
      {allMasteredMsg && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', marginBottom: 16,
          background: 'rgba(34,197,94,0.08)', border: '0.5px solid rgba(34,197,94,0.25)',
          borderRadius: 10, fontSize: 13, color: 'var(--success)',
        }}>
          <Check size={14} />
          Training complete — your leads will come in on the next refresh.
        </div>
      )}

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
              <p style={{ fontSize: 15, color: catColor, lineHeight: 1.6, margin: 0 }}>
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
// The Script tab. One interactive canvas (Prompt 48, React Flow) that both maps
// the whole decision tree AND runs the click-through practice on the same
// surface — derived from the shared DISCOVERY_SCRIPT so it can't drift from the
// live Call modal.

function DiscoveryScript() {
  // A neutral demo lead so the canvas reads naturally without a real lead.
  const flow = useMemo(
    () => buildScriptFlow({ business_name: 'the business', niche: 'service', city: 'your area' }, null),
    []
  )

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)' }}>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16, maxWidth: 720, flexShrink: 0 }}>
        This is the call script — a decision tree every rep follows. Scroll to zoom, drag to pan.{' '}
        <strong style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Click any node</strong> to
        practice from that step, one line at a time. The Call Now button on each lead runs this same
        walk, personalized to that business.
      </p>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ScriptCanvas flow={flow} />
      </div>
    </div>
  )
}

// ── QuizTab — 20 questions auto-generated from the flashcard deck ─────────────
// Pass mark is 85% (17/20). Passing is one of the three lead-unlock checks.

function generateQuiz() {
  const pool = shuffle(FLASHCARDS).slice(0, QUIZ_QUESTIONS)
  return pool.map(card => {
    // 3 distractors — same-category answers first so options read plausibly
    const sameCat  = FLASHCARDS.filter(c => c.id !== card.id && c.category === card.category)
    const otherCat = FLASHCARDS.filter(c => c.id !== card.id && c.category !== card.category)
    const distractors = shuffle([...shuffle(sameCat).slice(0, 3), ...shuffle(otherCat)]).slice(0, 3)
    return {
      id: card.id,
      category: card.category,
      question: card.front,
      options: shuffle([
        { text: card.back, correct: true },
        ...distractors.map(d => ({ text: d.back, correct: false })),
      ]),
    }
  })
}

function QuizTab({ progress, saveProgress }) {
  const [questions, setQuestions] = useState(null) // null = idle screen
  const [index, setIndex]         = useState(0)
  const [picked, setPicked]       = useState(null) // option index while showing feedback
  const [correct, setCorrect]     = useState(0)
  const [finished, setFinished]   = useState(false)

  const bestPct = progress?.quiz_score != null
    ? Math.round((progress.quiz_score / (progress.quiz_total || 1)) * 100)
    : null
  const passed = !!progress?.quiz_passed_at

  function start() {
    setQuestions(generateQuiz())
    setIndex(0)
    setPicked(null)
    setCorrect(0)
    setFinished(false)
  }

  function pick(i) {
    if (picked !== null) return
    setPicked(i)
    const isRight = questions[index].options[i].correct
    const nextCorrect = correct + (isRight ? 1 : 0)
    setCorrect(nextCorrect)
    setTimeout(() => {
      if (index + 1 >= questions.length) {
        finish(nextCorrect)
      } else {
        setIndex(v => v + 1)
        setPicked(null)
      }
    }, 900)
  }

  function finish(finalCorrect) {
    setFinished(true)
    const pct = Math.round((finalCorrect / questions.length) * 100)
    const patch = {}
    // Keep the best attempt on record
    if (bestPct === null || pct > bestPct) {
      patch.quiz_score = finalCorrect
      patch.quiz_total = questions.length
    }
    if (pct >= QUIZ_PASS_PCT && !progress?.quiz_passed_at) {
      patch.quiz_passed_at = new Date().toISOString()
    }
    if (Object.keys(patch).length) saveProgress(patch)
  }

  // ── Results screen — animated score ring, badge-style reveal ──
  if (finished) {
    const pct = Math.round((correct / questions.length) * 100)
    const didPass = pct >= QUIZ_PASS_PCT
    const ringColor = didPass ? 'var(--success)' : 'var(--danger)'
    const R = 54, C = 2 * Math.PI * R
    return (
      <div className="quiz-reveal" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', padding: '40px 24px' }}>
        {/* Circular score ring with a badge medallion at center */}
        <div style={{ position: 'relative', width: 140, height: 140, margin: '0 auto 22px' }}>
          <svg width="140" height="140" viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="70" cy="70" r={R} fill="none" stroke="var(--bg-elevated)" strokeWidth="9" />
            <circle
              cx="70" cy="70" r={R} fill="none" stroke={ringColor} strokeWidth="9" strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C - (Math.min(pct, 100) / 100) * C}
              style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)' }}
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 32, fontFamily: 'var(--font-mono)', fontWeight: 600, color: ringColor, letterSpacing: '-0.02em', lineHeight: 1 }}>{pct}%</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>{correct}/{questions.length}</span>
          </div>
          {/* Pass/fail medallion badge */}
          <div style={{
            position: 'absolute', bottom: -2, right: 8,
            width: 34, height: 34, borderRadius: '50%',
            background: didPass ? 'var(--success)' : 'var(--danger)',
            border: '3px solid var(--bg-base, #0B0B12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 0 16px ${didPass ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.4)'}`,
          }}>
            {didPass ? <Check size={18} color="white" /> : <X size={18} color="white" />}
          </div>
        </div>
        <p style={{ fontSize: 17, color: 'var(--text-primary)', fontWeight: 600, margin: '0 0 6px', letterSpacing: '-0.01em' }}>
          {didPass ? 'Quiz Passed!' : `${QUIZ_PASS_PCT}% needed to pass`}
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 auto 24px', maxWidth: 360 }}>
          {didPass
            ? 'Quiz check complete. This counts toward unlocking your leads.'
            : 'Review the flashcards and try again — the questions change every attempt.'}
        </p>
        <button
          onClick={start}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            height: 42, padding: '0 22px',
            background: didPass ? 'var(--bg-surface)' : 'var(--accent)',
            border: didPass ? '0.5px solid var(--border)' : 'none',
            borderRadius: 10, fontSize: 13, fontWeight: 500,
            color: didPass ? 'var(--text-secondary)' : 'white',
            cursor: 'pointer',
            boxShadow: didPass ? 'none' : '0 0 20px rgba(108,99,255,0.25)',
          }}
        >
          <RotateCcw size={14} />
          {didPass ? 'Take it again' : 'Retry quiz'}
        </button>
      </div>
    )
  }

  // ── Idle screen ── score ring (best vs pass threshold) + at-a-glance chips
  if (!questions) {
    const RC = 2 * Math.PI * 30 // ring circumference, r=30
    const ringPct = Math.min(bestPct ?? 0, 100)
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', padding: '48px 24px' }}>
        <div style={{ position: 'relative', width: 84, height: 84, margin: '0 auto 18px' }}>
          <svg width="84" height="84" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="42" cy="42" r="30" fill="none" stroke="var(--bg-elevated)" strokeWidth="6" />
            {bestPct !== null && (
              <circle
                cx="42" cy="42" r="30" fill="none"
                stroke={passed ? 'var(--success)' : 'var(--warning)'} strokeWidth="6" strokeLinecap="round"
                strokeDasharray={RC} strokeDashoffset={RC - (ringPct / 100) * RC}
                style={{ transition: 'stroke-dashoffset 700ms ease' }}
              />
            )}
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            {bestPct !== null
              ? <span style={{ fontSize: 19, fontWeight: 600, fontFamily: 'var(--font-mono)', color: passed ? 'var(--success)' : 'var(--warning)' }}>{bestPct}%</span>
              : <ClipboardCheck size={26} color="var(--accent)" />}
          </div>
        </div>
        <h2 style={{ fontSize: 19, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 10px', letterSpacing: '-0.01em' }}>
          Flashcard Quiz
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, margin: '0 0 12px' }}>
          {QUIZ_QUESTIONS} questions drawn at random from the flashcard deck — objections,
          scripts, and product knowledge.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '3px 10px' }}>
            {QUIZ_QUESTIONS} questions
          </span>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '3px 10px' }}>
            Pass ≥ {QUIZ_PASS_PCT}%
          </span>
          {bestPct !== null && (
            <span style={{
              fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
              color: passed ? 'var(--success)' : 'var(--warning)',
              background: passed ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
              border: `0.5px solid ${passed ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
              borderRadius: 20, padding: '3px 10px',
            }}>
              {passed ? 'Passed ✓' : `Best ${bestPct}%`}
            </span>
          )}
        </div>
        <button
          onClick={start}
          className="hover:!brightness-110"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            height: 42, padding: '0 24px', marginTop: 4,
            background: 'var(--accent)', border: 'none',
            borderRadius: 10, fontSize: 14, fontWeight: 500, color: 'white',
            cursor: 'pointer', boxShadow: '0 0 20px rgba(108,99,255,0.25)',
            transition: 'filter 120ms ease',
          }}
        >
          <Play size={15} />
          Start Quiz
        </button>
      </div>
    )
  }

  // ── Question screen — segmented progress, lettered options, answer feedback ──
  const q = questions[index]
  const catColor = CATEGORY_COLORS[q.category] || 'var(--accent)'
  const LETTERS = ['A', 'B', 'C', 'D', 'E']
  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      {/* Progress: question counter, running score, segmented bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
          Question <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{index + 1}</span> of {questions.length}
        </span>
        <span style={{
          fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--success)',
          background: 'rgba(34,197,94,0.1)', border: '0.5px solid rgba(34,197,94,0.25)',
          borderRadius: 20, padding: '2px 9px',
        }}>
          {correct} correct
        </span>
      </div>
      <div style={{ display: 'flex', gap: 3, marginBottom: 20 }}>
        {questions.map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 4, borderRadius: 2,
            background: i < index ? 'var(--success)' : i === index ? 'var(--accent)' : 'var(--bg-elevated)',
            transition: 'background 0.3s ease',
          }} />
        ))}
      </div>

      {/* Question */}
      <div className="glass" style={{ borderRadius: 12, padding: '22px 24px', marginBottom: 16 }}>
        <p style={{
          fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
          color: catColor, margin: '0 0 8px', fontWeight: 600,
        }}>
          {CATEGORY_LABELS[q.category]}
        </p>
        <p style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>
          {q.question}
        </p>
      </div>

      {/* Options — lettered chips + correct/incorrect feedback icons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {q.options.map((opt, i) => {
          const showFeedback = picked !== null
          const isPicked  = picked === i
          const highlight = showFeedback && (opt.correct || isPicked)
          const color = !showFeedback ? 'var(--border)'
            : opt.correct ? 'rgba(34,197,94,0.5)'
            : isPicked ? 'rgba(239,68,68,0.5)'
            : 'var(--border)'
          const fg = highlight ? (opt.correct ? 'var(--success)' : 'var(--danger)') : 'var(--text-secondary)'
          return (
            <button
              key={i}
              onClick={() => pick(i)}
              disabled={picked !== null}
              className={picked === null ? 'quiz-option' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                textAlign: 'left', padding: '13px 14px',
                background: !showFeedback ? 'var(--bg-surface)'
                  : opt.correct ? 'rgba(34,197,94,0.08)'
                  : isPicked ? 'rgba(239,68,68,0.08)'
                  : 'var(--bg-surface)',
                border: `0.5px solid ${color}`,
                borderRadius: 10, cursor: picked === null ? 'pointer' : 'default',
                fontSize: 13, lineHeight: 1.55, color: fg,
                transition: 'all 0.18s ease',
                opacity: showFeedback && !highlight ? 0.45 : 1,
              }}
            >
              {/* Letter chip / feedback icon */}
              <span style={{
                flexShrink: 0, width: 24, height: 24, borderRadius: 7,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)',
                background: highlight ? (opt.correct ? 'var(--success)' : 'var(--danger)') : 'var(--bg-elevated)',
                color: highlight ? 'white' : 'var(--text-muted)',
                border: highlight ? 'none' : '0.5px solid var(--border)',
                transition: 'all 0.18s ease',
              }}>
                {highlight ? (opt.correct ? <Check size={13} /> : <X size={13} />) : LETTERS[i]}
              </span>
              <span style={{ flex: 1 }}>{opt.text}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── FinalQuizTab — 25-30 questions covering all 8 videos, gates completion ────
// Combined with flashcard mastery via onPass (see TrainingCenter below).

function FinalQuizTab({ watchedCount, passed, onPass }) {
  const [questions, setQuestions] = useState(null)
  const [index, setIndex]   = useState(0)
  const [picked, setPicked] = useState(null)
  const [correct, setCorrect] = useState(0)
  const [finished, setFinished] = useState(false)

  const locked = watchedCount < TRAINING_VIDEOS.length

  function start() {
    setQuestions(buildFinalQuizPool())
    setIndex(0)
    setPicked(null)
    setCorrect(0)
    setFinished(false)
  }

  function pick(i) {
    if (picked !== null) return
    setPicked(i)
    const isRight = questions[index].options[i].correct
    const nextCorrect = correct + (isRight ? 1 : 0)
    setCorrect(nextCorrect)
    setTimeout(() => {
      if (index + 1 >= questions.length) {
        finish(nextCorrect)
      } else {
        setIndex(v => v + 1)
        setPicked(null)
      }
    }, 700)
  }

  function finish(finalCorrect) {
    setFinished(true)
    const pct = Math.round((finalCorrect / questions.length) * 100)
    if (pct >= FINAL_QUIZ_PASS_PCT && !passed) onPass()
  }

  if (locked) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', padding: '56px 24px' }}>
        <Lock size={26} color="var(--accent)" style={{ marginBottom: 14 }} />
        <h2 style={{ fontSize: 17, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 8px' }}>Watch all 8 videos first</h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{watchedCount}/{TRAINING_VIDEOS.length} watched — the final exam unlocks once every video is complete.</p>
      </div>
    )
  }

  if (finished) {
    const pct = Math.round((correct / questions.length) * 100)
    const didPass = pct >= FINAL_QUIZ_PASS_PCT
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', padding: '40px 24px' }}>
        <p style={{ fontSize: 32, fontFamily: 'var(--font-mono)', fontWeight: 600, color: didPass ? 'var(--success)' : 'var(--danger)', margin: '0 0 8px' }}>{pct}%</p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>{correct}/{questions.length} correct</p>
        <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 20 }}>
          {didPass ? 'Final exam passed — training complete.' : `${FINAL_QUIZ_PASS_PCT}% needed to pass`}
        </p>
        <button
          onClick={start}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, height: 42, padding: '0 22px',
            background: didPass ? 'var(--bg-surface)' : 'var(--accent)',
            border: didPass ? '0.5px solid var(--border)' : 'none',
            borderRadius: 10, fontSize: 13, fontWeight: 500,
            color: didPass ? 'var(--text-secondary)' : 'white', cursor: 'pointer',
          }}
        >
          <RotateCcw size={14} />
          {didPass ? 'Take it again' : 'Retry exam'}
        </button>
      </div>
    )
  }

  if (!questions) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', padding: '48px 24px' }}>
        <ClipboardCheck size={26} color="var(--accent)" style={{ marginBottom: 14 }} />
        <h2 style={{ fontSize: 19, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 10px' }}>Final Exam</h2>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, margin: '0 0 12px' }}>
          25-30 questions covering all 8 training videos. Pass ≥ {FINAL_QUIZ_PASS_PCT}% to complete training.
        </p>
        {passed && (
          <p style={{ fontSize: 12, color: 'var(--success)', marginBottom: 12 }}>Passed ✓ — you can retake it any time.</p>
        )}
        <button
          onClick={start}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, height: 42, padding: '0 24px',
            background: 'var(--accent)', border: 'none', borderRadius: 10,
            fontSize: 14, fontWeight: 500, color: 'white', cursor: 'pointer',
          }}
        >
          <Play size={15} />
          Start Final Exam
        </button>
      </div>
    )
  }

  const q = questions[index]
  const LETTERS = ['A', 'B', 'C', 'D']
  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Question <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{index + 1}</span> of {questions.length}
        </span>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--success)' }}>{correct} correct</span>
      </div>
      <div className="glass" style={{ borderRadius: 12, padding: '22px 24px', marginBottom: 16 }}>
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', margin: '0 0 8px' }}>{q.category}</p>
        <p style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>{q.question}</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {q.options.map((opt, i) => {
          const showFeedback = picked !== null
          const isPicked = picked === i
          const highlight = showFeedback && (opt.correct || isPicked)
          const color = !showFeedback ? 'var(--border)' : opt.correct ? 'rgba(34,197,94,0.5)' : isPicked ? 'rgba(239,68,68,0.5)' : 'var(--border)'
          const fg = highlight ? (opt.correct ? 'var(--success)' : 'var(--danger)') : 'var(--text-secondary)'
          return (
            <button
              key={i}
              onClick={() => pick(i)}
              disabled={picked !== null}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '13px 14px',
                background: !showFeedback ? 'var(--bg-surface)' : opt.correct ? 'rgba(34,197,94,0.08)' : isPicked ? 'rgba(239,68,68,0.08)' : 'var(--bg-surface)',
                border: `0.5px solid ${color}`, borderRadius: 10, cursor: picked === null ? 'pointer' : 'default',
                fontSize: 13, lineHeight: 1.55, color: fg, opacity: showFeedback && !highlight ? 0.45 : 1,
              }}
            >
              <span style={{
                flexShrink: 0, width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)',
                background: highlight ? (opt.correct ? 'var(--success)' : 'var(--danger)') : 'var(--bg-elevated)',
                color: highlight ? 'white' : 'var(--text-muted)',
              }}>
                {highlight ? (opt.correct ? <Check size={13} /> : <X size={13} />) : LETTERS[i]}
              </span>
              <span style={{ flex: 1 }}>{opt.text}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── AIRoleplay — live voice practice scored by "Phoenix" (claude-haiku) ───────
// Calls Retell ("Mike", a gruff HVAC owner), transcribes live, and on hang-up
// sends the transcript to score-roleplay. B+ or higher (9/12) passes the gate.

function RoleplayComingSoon() {
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

function AIRoleplay({ progress, saveProgress }) {
  const hasRetell = useCapability('has_retell')
  const [phase, setPhase]           = useState('idle') // idle | connecting | live | scoring | scored | error
  const [transcript, setTranscript] = useState([])
  const [score, setScore]           = useState(null)
  const [error, setError]           = useState('')
  const clientRef     = useRef(null)
  const transcriptRef = useRef([])
  const scrollRef     = useRef(null)

  useEffect(() => () => { clientRef.current?.stopCall?.() }, [])

  // Keep the live transcript pinned to the latest line
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [transcript])

  // Live call timer (visual only) — ticks while the call is connected
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (phase !== 'live') { setElapsed(0); return }
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [phase])
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  // "Mike is thinking" when the rep spoke last and no AI reply has landed yet
  const aiThinking = phase === 'live' && transcript.length > 0 && transcript[transcript.length - 1]?.role === 'user'

  async function startCall() {
    setPhase('connecting')
    setError('')
    setTranscript([])
    transcriptRef.current = []
    setScore(null)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('create-roleplay-call')
      if (fnError || !data?.access_token) throw new Error(data?.error || fnError?.message || 'Could not start the practice call')

      const { RetellWebClient } = await import('retell-client-js-sdk')
      // Fresh client per call — reusing one across calls leaks listeners
      const client = new RetellWebClient()
      clientRef.current = client

      client.on('call_started', () => setPhase('live'))
      client.on('update', (update) => {
        if (update?.transcript?.length) {
          transcriptRef.current = update.transcript
          setTranscript(update.transcript)
        }
      })
      client.on('call_ended', () => scoreCall())
      client.on('error', (e) => {
        setError(typeof e === 'string' ? e : 'Call dropped — try again')
        setPhase('error')
        client.stopCall()
      })

      await client.startCall({ accessToken: data.access_token })
    } catch (err) {
      setError(err.message || 'Could not start the practice call')
      setPhase('error')
    }
  }

  function endCall() {
    clientRef.current?.stopCall()
  }

  async function scoreCall() {
    const finalTranscript = transcriptRef.current
    if (!finalTranscript.length) {
      setError('No conversation recorded — make sure your mic is allowed and try again.')
      setPhase('error')
      return
    }
    setPhase('scoring')
    try {
      const { data, error: fnError } = await supabase.functions.invoke('score-roleplay', {
        body: { transcript: finalTranscript },
      })
      if (fnError || !data?.scores) throw new Error(data?.error || fnError?.message || 'Scoring failed')

      const total = data.total ?? 0
      const grade = gradeFromScore(total)
      const passedNow = total >= ROLEPLAY_PASS_SCORE
      setScore({ ...data, grade, passedNow })
      setPhase('scored')

      const patch = { roleplay_score: total, roleplay_grade: grade }
      if (passedNow && !progress?.roleplay_passed_at) {
        patch.roleplay_passed_at = new Date().toISOString()
      }
      saveProgress(patch)
    } catch (err) {
      setError(err.message || 'Scoring failed — the call still counts, try again for a grade')
      setPhase('error')
    }
  }

  if (!hasRetell) return <RoleplayComingSoon />

  // ── Scorecard ──
  if (phase === 'scored' && score) {
    const dims = [
      { key: 'opener',            label: 'Opener',             max: 2 },
      { key: 'painDiscovery',     label: 'Pain Discovery',     max: 3 },
      { key: 'objectionHandling', label: 'Objection Handling', max: 2 },
      { key: 'bookingAsk',        label: 'Booking Ask',        max: 2 },
      { key: 'tone',              label: 'Tone',               max: 3 },
    ]
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="glass quiz-reveal" style={{ borderRadius: 14, padding: '28px 28px', textAlign: 'center', marginBottom: 16 }}>
          {(() => {
            const maxTotal = score.maxTotal ?? 12
            const gradeColor = score.passedNow ? 'var(--success)' : 'var(--warning)'
            const R = 50, C = 2 * Math.PI * R
            const frac = Math.min((score.total ?? 0) / maxTotal, 1)
            return (
              <div style={{ position: 'relative', width: 128, height: 128, margin: '0 auto 14px' }}>
                <svg width="128" height="128" viewBox="0 0 128 128" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="64" cy="64" r={R} fill="none" stroke="var(--bg-elevated)" strokeWidth="8" />
                  <circle cx="64" cy="64" r={R} fill="none" stroke={gradeColor} strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={C} strokeDashoffset={C - frac * C}
                    style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)' }} />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 34, fontFamily: 'var(--font-mono)', fontWeight: 600, color: gradeColor, lineHeight: 1, letterSpacing: '-0.02em' }}>{score.grade}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>{score.total}/{maxTotal}</span>
                </div>
                <div style={{
                  position: 'absolute', bottom: 0, right: 4, width: 30, height: 30, borderRadius: '50%',
                  background: gradeColor, border: '3px solid var(--bg-base, #0B0B12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: `0 0 14px ${score.passedNow ? 'rgba(34,197,94,0.5)' : 'rgba(245,158,11,0.45)'}`,
                }}>
                  {score.passedNow ? <Check size={16} color="white" /> : <Award size={15} color="white" />}
                </div>
              </div>
            )
          })()}
          <p style={{ fontSize: 13, color: score.passedNow ? 'var(--success)' : 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
            {score.passedNow
              ? 'Roleplay check passed — this counts toward unlocking your leads.'
              : `${ROLEPLAY_PASS_GRADE} (${ROLEPLAY_PASS_SCORE}/12) or higher passes. Run it again — Mike's always up for round two.`}
          </p>
        </div>

        {/* Dimension bars */}
        <div className="glass" style={{ borderRadius: 12, padding: '18px 20px', marginBottom: 16 }}>
          {dims.map(d => {
            const v = score.scores?.[d.key] ?? 0
            const frac = v / d.max
            const barColor = frac >= 1 ? 'var(--success)' : frac >= 0.5 ? 'var(--accent)' : 'var(--warning)'
            return (
              <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <span style={{ flex: '0 0 150px', fontSize: 12, color: 'var(--text-secondary)' }}>{d.label}</span>
                <div style={{ flex: 1, height: 5, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${frac * 100}%`,
                    background: barColor, borderRadius: 3,
                    transition: 'width 0.7s cubic-bezier(0.4,0,0.2,1)',
                  }} />
                </div>
                <span style={{ flex: '0 0 34px', fontSize: 12, fontFamily: 'var(--font-mono)', color: barColor, textAlign: 'right' }}>
                  {v}/{d.max}
                </span>
              </div>
            )
          })}
        </div>

        {score.summary && (
          <div className="glass" style={{ borderRadius: 12, padding: '16px 20px', marginBottom: 16 }}>
            <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 6px' }}>Coach's Assessment</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0 }}>{score.summary}</p>
            {score.tips?.length > 0 && (
              <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
                {score.tips.map((tip, i) => (
                  <li key={i} style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>{tip}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div style={{ textAlign: 'center' }}>
          <button
            onClick={startCall}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              height: 42, padding: '0 24px',
              background: 'var(--accent)', border: 'none',
              borderRadius: 10, fontSize: 14, fontWeight: 500, color: 'white', cursor: 'pointer',
            }}
          >
            <Mic size={15} />
            Practice Again
          </button>
        </div>
      </div>
    )
  }

  // ── Live call / connecting / scoring ──
  if (phase === 'connecting' || phase === 'live' || phase === 'scoring') {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="glass" style={{ borderRadius: 14, padding: '20px 22px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Persona avatar — pulsing ring while the call is live */}
          <div style={{ position: 'relative', width: 52, height: 52, flexShrink: 0 }}>
            {phase === 'live' && <span className="call-pulse" style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid var(--success)' }} />}
            <div style={{
              position: 'relative', width: 52, height: 52, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-mono)',
              color: phase === 'live' ? 'var(--success)' : 'var(--accent)',
              background: phase === 'live' ? 'rgba(34,197,94,0.12)' : 'var(--accent-dim)',
              border: `0.5px solid ${phase === 'live' ? 'rgba(34,197,94,0.35)' : 'var(--accent-border)'}`,
            }}>
              {phase === 'scoring'
                ? <Loader2 size={20} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />
                : 'M'}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
              Mike — HVAC Owner
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              {phase === 'connecting' && <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Dialing…</>}
              {phase === 'live' && <><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)' }} /> Live · <span style={{ fontFamily: 'var(--font-mono)' }}>{mmss}</span> · Dallas, TX</>}
              {phase === 'scoring' && 'Phoenix is reviewing the transcript…'}
            </p>
          </div>
          {phase === 'live' && (
            <button
              onClick={endCall}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                height: 38, padding: '0 16px',
                background: 'var(--danger)', border: 'none',
                borderRadius: 999, fontSize: 12, fontWeight: 500, color: 'white', cursor: 'pointer',
              }}
            >
              <PhoneOff size={13} />
              End Call
            </button>
          )}
        </div>

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

        {/* Live transcript */}
        <div
          ref={scrollRef}
          className="glass scrollbar-thin"
          style={{ borderRadius: 12, padding: '16px 18px', height: 320, overflowY: 'auto' }}
        >
          {transcript.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', marginTop: 130 }}>
              {phase === 'live' ? 'Say hello — Mike answered.' : 'Transcript appears here once the call connects.'}
            </p>
          ) : (
            <>
            {transcript.map((t, i) => {
              const isYou = t.role === 'user'
              return (
                <div key={i} style={{ marginBottom: 12, display: 'flex', flexDirection: isYou ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 8 }}>
                  {/* Speaker avatar */}
                  <div style={{
                    flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)',
                    color: isYou ? 'var(--accent)' : 'var(--text-secondary)',
                    background: isYou ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                    border: `0.5px solid ${isYou ? 'var(--accent-border)' : 'var(--border)'}`,
                  }}>
                    {isYou ? 'Y' : 'M'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: isYou ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                    <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', margin: '0 4px 2px' }}>
                      {isYou ? 'You' : 'Mike'}
                    </span>
                    <p style={{
                      fontSize: 13, lineHeight: 1.55, margin: 0,
                      padding: '8px 12px',
                      borderRadius: isYou ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                      background: isYou ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                      border: `0.5px solid ${isYou ? 'var(--accent-border)' : 'var(--border)'}`,
                      color: 'var(--text-secondary)',
                    }}>
                      {t.content}
                    </p>
                  </div>
                </div>
              )
            })}
            {/* Mike "thinking" indicator while awaiting his reply */}
            {aiThinking && (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 12 }}>
                <div style={{
                  flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)',
                  background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                }}>M</div>
                <div style={{ display: 'flex', gap: 4, padding: '11px 14px', borderRadius: '12px 12px 12px 3px', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)' }}>
                  <span className="typing-dot" style={{ animationDelay: '0ms' }} />
                  <span className="typing-dot" style={{ animationDelay: '160ms' }} />
                  <span className="typing-dot" style={{ animationDelay: '320ms' }} />
                </div>
              </div>
            )}
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Idle / error ── persona avatar + scenario chips + grade badge
  const rpGrade = progress?.roleplay_grade
  const rpPassed = !!progress?.roleplay_passed_at
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', padding: '48px 24px' }}>
      {/* scenario persona — Mike, the HVAC owner you're cold-calling */}
      <div style={{ position: 'relative', width: 76, height: 76, margin: '0 auto 18px' }}>
        <div style={{
          width: 76, height: 76, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--accent), #8B5CF6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, fontWeight: 600, color: 'white', fontFamily: 'var(--font-mono)',
          boxShadow: '0 0 24px rgba(108,99,255,0.3)',
        }}>
          M
        </div>
        <div style={{
          position: 'absolute', bottom: -2, right: -2,
          width: 28, height: 28, borderRadius: '50%',
          background: 'var(--bg-surface)', border: '1.5px solid var(--bg-1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Mic size={13} color="var(--accent)" />
        </div>
      </div>
      <h2 style={{ fontSize: 19, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 4px', letterSpacing: '-0.01em' }}>
        AI Voice Roleplay
      </h2>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', margin: '0 0 12px' }}>
        {['Cold call', 'Mike · HVAC owner, Dallas', `Pass ≥ ${ROLEPLAY_PASS_GRADE}`].map(t => (
          <span key={t} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 20, padding: '3px 10px' }}>
            {t}
          </span>
        ))}
      </div>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, margin: '0 0 12px' }}>
        Open clean, dig into his missed-call pain, survive one objection, and book the
        15-minute call. Phoenix, our AI coach, grades the whole conversation.
      </p>
      {rpGrade && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 4,
          background: rpPassed ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
          border: `0.5px solid ${rpPassed ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
          borderRadius: 20, padding: '4px 12px',
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Last grade</span>
          <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', color: rpPassed ? 'var(--success)' : 'var(--warning)' }}>{rpGrade}</span>
          {rpPassed && <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>Passed ✓</span>}
        </div>
      )}
      {error && (
        <p style={{ fontSize: 12, color: 'var(--danger)', margin: '8px 0 0', lineHeight: 1.5 }}>{error}</p>
      )}
      <div>
        <button
          onClick={startCall}
          className="hover:!brightness-110"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            height: 42, padding: '0 24px', marginTop: 14,
            background: 'var(--accent)', border: 'none',
            borderRadius: 10, fontSize: 14, fontWeight: 500, color: 'white',
            cursor: 'pointer', boxShadow: '0 0 20px rgba(108,99,255,0.25)',
            transition: 'filter 120ms ease',
          }}
        >
          <Mic size={15} />
          Start Practice Call
        </button>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 14 }}>
        Uses your microphone — allow access when the browser asks.
      </p>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ── Main Training Center page ─────────────────────────────────────────────────

const TABS = [
  { id: 'script',      label: 'Script',      icon: FileText,       count: null },
  { id: 'videos',      label: 'Videos',      icon: Play,           count: `${TRAINING_VIDEOS.length} videos` },
  { id: 'flashcards',  label: 'Flashcards',  icon: BookOpen,       count: `${FLASHCARDS.length} cards` },
  { id: 'quiz',        label: 'Quiz',        icon: ClipboardCheck, count: null },
  { id: 'final-exam',  label: 'Final Exam',  icon: Award,          count: null },
  { id: 'roleplay',    label: 'AI Roleplay', icon: Mic,            count: null },
]

export default function TrainingCenter() {
  const [tab, setTab] = useState('script')
  const { profile } = useAuth()
  const { data: progress } = useTrainingProgress()
  const saveMutation = useSaveTrainingProgress()
  const saveProgress = (patch) => saveMutation.mutate(patch)

  // Combined gate: profiles.training_completed set only when both flashcards
  // mastered AND final exam passed. Tracked client-side via localStorage since
  // no DB column exists for final quiz state yet — Falcon to add migration if
  // server-side persistence is needed later.
  const [flashcardsMastered, setFlashcardsMastered] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LS_MASTERED) || '[]')).size >= FLASHCARDS.length } catch { return false }
  })
  const [finalQuizPassed, setFinalQuizPassed] = useState(
    () => localStorage.getItem(LS_FINAL_QUIZ_PASS) === '1'
  )

  async function maybeCompleteTraining(nextFC, nextFQ) {
    if (!profile?.id || profile?.training_completed) return
    if (nextFC && nextFQ) {
      await supabase.from('profiles').update({ training_completed: true }).eq('id', profile.id)
    }
  }

  function handleAllFlashcardsMastered() {
    setFlashcardsMastered(true)
    maybeCompleteTraining(true, finalQuizPassed)
  }

  function handleFinalQuizPassed() {
    localStorage.setItem(LS_FINAL_QUIZ_PASS, '1')
    setFinalQuizPassed(true)
    maybeCompleteTraining(flashcardsMastered, true)
  }

  const checks   = trainingChecks(progress)
  const complete = isTrainingComplete(progress)
  const watchedCount = checks.videosWatched
  const gateSteps = [
    { label: `Videos ${watchedCount}/${TOTAL_VIDEOS}`, done: checks.videosDone,   goTab: 'videos' },
    { label: `Quiz ${QUIZ_PASS_PCT}%+`,                done: checks.quizDone,     goTab: 'quiz' },
    { label: `Final Exam ${FINAL_QUIZ_PASS_PCT}%+`,    done: finalQuizPassed,     goTab: 'final-exam' },
    { label: `Roleplay ${ROLEPLAY_PASS_GRADE}+`,        done: checks.roleplayDone, goTab: 'roleplay' },
  ]

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
          Training Center
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          Videos, flashcards, the discovery script, quiz, and AI voice roleplay
        </p>
      </div>

      {/* Unlock progress — shown until all gate checks pass */}
      {!complete && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          background: 'var(--accent-dim)', border: '0.5px solid var(--accent-border)',
          borderRadius: 10, padding: '10px 16px', marginBottom: 20,
        }}>
          <Lock size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
            Complete all to unlock your leads:
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {gateSteps.map((s, i) => (
              <button
                key={i}
                onClick={() => setTab(s.goTab)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 6,
                  background: s.done ? 'rgba(34,197,94,0.1)' : 'var(--bg-surface)',
                  border: `0.5px solid ${s.done ? 'rgba(34,197,94,0.3)' : 'var(--border)'}`,
                  fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  color: s.done ? 'var(--success)' : 'var(--text-secondary)',
                }}
              >
                {s.done ? <Check size={11} /> : <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-dim)' }} />}
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 24,
        background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
        borderRadius: 10, padding: 4,
        width: 'fit-content', flexWrap: 'wrap',
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
      {tab === 'videos'     && <VideoLibrary progress={progress} saveProgress={saveProgress} />}
      {tab === 'flashcards' && <FlashcardDeck onAllMastered={handleAllFlashcardsMastered} />}
      {tab === 'quiz'       && <QuizTab progress={progress} saveProgress={saveProgress} />}
      {tab === 'final-exam' && <FinalQuizTab watchedCount={watchedCount} passed={finalQuizPassed} onPass={handleFinalQuizPassed} />}
      {tab === 'script'     && <DiscoveryScript />}
      {tab === 'roleplay'   && <AIRoleplay progress={progress} saveProgress={saveProgress} />}
    </div>
  )
}
