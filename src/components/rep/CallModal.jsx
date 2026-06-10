import { useState, useRef, useEffect, useCallback } from 'react'
import { Phone, PhoneOff, Mic, MicOff, X, ChevronDown, FileText, CheckCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useCapability } from '../../contexts/SecretsContext'

const OUTCOMES = [
  { value: 'interested',     label: 'Interested',      color: '#22C55E' },
  { value: 'callback',       label: 'Callback',        color: '#F59E0B' },
  { value: 'voicemail',      label: 'Voicemail',       color: '#6C63FF' },
  { value: 'no_answer',      label: 'No Answer',       color: '#64748B' },
  { value: 'not_interested', label: 'Not Interested',  color: '#EF4444' },
]

export function CallModal({ lead, onClose, onCallLogged }) {
  const { profile } = useAuth()
  const hasRetell    = useCapability('has_retell')

  const [phase, setPhase]               = useState('pre')   // pre | dialing | coach | post | done
  const [coachState, setCoachState]     = useState('idle')  // idle | connecting | active | ending
  const [outcome, setOutcome]           = useState('')
  const [notes, setNotes]               = useState('')
  const [callOutcomeOpen, setCallOutcomeOpen] = useState(false)
  const [logging, setLogging]           = useState(false)
  const [error, setError]               = useState('')
  const [startTime, setStartTime]       = useState(null)
  const [elapsed, setElapsed]           = useState(0)
  const timerRef = useRef(null)
  const retellRef = useRef(null)

  // Timer
  useEffect(() => {
    if (phase === 'dialing') {
      setStartTime(Date.now())
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [phase])

  const cleanupRetell = useCallback(() => {
    if (retellRef.current) {
      try { retellRef.current.stopCall() } catch { /* ignore */ }
      retellRef.current = null
    }
  }, [])

  useEffect(() => () => { cleanupRetell(); clearInterval(timerRef.current) }, [])

  // ── Start Retell coach ────────────────────────────────────────────────────
  async function startRetellCoach() {
    setCoachState('connecting')
    setError('')
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('create-lead-call', {
        body: {
          business_name: lead.business_name,
          contact_name:  lead.contact_name,
          niche:         lead.niche,
          city:          lead.city,
          phone:         lead.phone,
          pain_points:   lead.pain_points,
          notes:         lead.notes,
        },
      })
      if (fnErr) throw new Error(fnErr.message)
      if (data?.notConfigured) { setCoachState('idle'); return }
      if (!data?.access_token) throw new Error('No access token')

      const { RetellWebClient } = await import('retell-client-js-sdk')
      const retell = new RetellWebClient()
      retellRef.current = retell

      retell.on('call_started', () => setCoachState('active'))
      retell.on('call_ended',   () => { setCoachState('idle'); cleanupRetell() })
      retell.on('error',        (e) => { setError(e?.message || 'Retell error'); setCoachState('idle') })

      await retell.startCall({ accessToken: data.access_token })
    } catch (err) {
      setError(err.message || 'Failed to start coach')
      setCoachState('idle')
    }
  }

  function stopCoach() {
    cleanupRetell()
    setCoachState('idle')
  }

  // ── Dial via tel: ─────────────────────────────────────────────────────────
  function handleDial() {
    if (lead.phone) {
      window.location.href = `tel:${lead.phone.replace(/\D/g, '')}`
    }
    setPhase('dialing')
  }

  // ── Log call to DB ────────────────────────────────────────────────────────
  async function handleLogCall() {
    if (!outcome) { setError('Select a call outcome'); return }
    setLogging(true)
    setError('')
    try {
      const duration = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0
      await supabase.from('calls').insert({
        lead_id:          lead.id,
        rep_id:           profile?.id,
        duration_seconds: duration,
        call_outcome:     outcome,
        call_notes:       notes || null,
        outcome:          outcome,
      })

      // Also update lead status based on outcome
      const statusMap = {
        interested:     'Interested',
        callback:       'Contacted',
        voicemail:      'Voicemail',
        no_answer:      'No Answer',
        not_interested: 'Not Interested',
      }
      if (statusMap[outcome]) {
        await supabase.from('leads')
          .update({ status: statusMap[outcome] })
          .eq('id', lead.id)
      }

      setPhase('done')
      onCallLogged?.({ outcome, notes, duration })
    } catch (err) {
      setError(err.message || 'Failed to log call')
    } finally {
      setLogging(false)
    }
  }

  const selectedOutcome = OUTCOMES.find(o => o.value === outcome)
  const formatElapsed = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(8,8,16,0.85)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: '100%', maxWidth: 460,
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border)',
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px',
          borderBottom: '0.5px solid var(--border)',
          background: phase === 'dialing' ? 'rgba(34,197,94,0.04)' : 'transparent',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9,
            background: phase === 'dialing' ? 'rgba(34,197,94,0.1)' : 'var(--accent-dim)',
            border: `0.5px solid ${phase === 'dialing' ? 'rgba(34,197,94,0.25)' : 'var(--accent-border)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Phone size={15} color={phase === 'dialing' ? 'var(--success)' : 'var(--accent)'} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lead.business_name}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              {lead.contact_name || 'Owner'} · {lead.city || lead.state || '—'}
              {lead.phone && (
                <span style={{ fontFamily: 'var(--font-mono)', marginLeft: 8, fontSize: 11 }}>
                  {lead.phone}
                </span>
              )}
            </p>
          </div>
          {phase === 'dialing' && startTime && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--success)' }}>
              {formatElapsed(elapsed)}
            </span>
          )}
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px' }}>

          {/* ── PRE-CALL ─────────────────────────────────────────────────── */}
          {phase === 'pre' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Pain point chips */}
              {lead.pain_points && (
                <div style={{ padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 8, border: '0.5px solid var(--border)' }}>
                  <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 5 }}>Pain points noted</p>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{lead.pain_points}</p>
                </div>
              )}

              {/* Opener preview */}
              <div style={{ padding: '10px 12px', background: 'var(--accent-dim)', borderRadius: 8, border: '0.5px solid var(--accent-border)' }}>
                <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', marginBottom: 5 }}>Say this to open</p>
                <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0, lineHeight: 1.5, fontStyle: 'italic' }}>
                  "Hey, is this {lead.business_name}? [Name], I was looking at your Indeed listing — how's that search going?"
                </p>
              </div>

              {/* Retell coach toggle (if available) */}
              {hasRetell && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 8, border: '0.5px solid var(--border)' }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>AI Coach in your ear</p>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Retell gives you real-time script cues via mic</p>
                  </div>
                  <button
                    onClick={coachState === 'active' ? stopCoach : startRetellCoach}
                    disabled={coachState === 'connecting'}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 12px', borderRadius: 6, border: 'none',
                      background: coachState === 'active' ? 'rgba(34,197,94,0.1)' : 'var(--accent-dim)',
                      color: coachState === 'active' ? 'var(--success)' : 'var(--accent)',
                      fontSize: 12, fontWeight: 500, cursor: coachState === 'connecting' ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {coachState === 'connecting' ? (
                      <><span style={{ width: 10, height: 10, border: '1.5px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} /> Connecting…</>
                    ) : coachState === 'active' ? (
                      <><Mic size={11} /> Coach On</>
                    ) : (
                      <><MicOff size={11} /> Start Coach</>
                    )}
                  </button>
                </div>
              )}

              {error && <p style={{ fontSize: 12, color: 'var(--danger)', textAlign: 'center', margin: 0 }}>{error}</p>}

              {/* Dial button */}
              {lead.phone ? (
                <button
                  onClick={handleDial}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    width: '100%', height: 48,
                    background: 'var(--success)', border: 'none', borderRadius: 10,
                    fontSize: 14, fontWeight: 500, color: 'white',
                    cursor: 'pointer',
                    boxShadow: '0 0 20px rgba(34,197,94,0.3)',
                  }}
                >
                  <Phone size={15} />
                  Call {lead.phone}
                </button>
              ) : (
                <button
                  onClick={() => setPhase('post')}
                  style={{
                    width: '100%', height: 48, background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                    borderRadius: 10, fontSize: 14, color: 'var(--text-secondary)', cursor: 'pointer',
                  }}
                >
                  No phone number — log manually
                </button>
              )}
            </div>
          )}

          {/* ── DIALING ─────────────────────────────────────────────────── */}
          {phase === 'dialing' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
                padding: '12px', background: 'rgba(34,197,94,0.06)', borderRadius: 8, border: '0.5px solid rgba(34,197,94,0.2)',
              }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', animation: 'navPulse 2s ease infinite', display: 'inline-block' }} />
                <span style={{ fontSize: 13, color: 'var(--success)', fontWeight: 500 }}>Call in progress</span>
                {coachState === 'active' && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>· Coach active</span>
                )}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
                Tap "End Call" when done to log the outcome.
              </p>
              <button
                onClick={() => { stopCoach(); setPhase('post') }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  width: '100%', height: 48,
                  background: 'rgba(239,68,68,0.1)', border: '0.5px solid rgba(239,68,68,0.3)',
                  borderRadius: 10, fontSize: 14, fontWeight: 500, color: 'var(--danger)',
                  cursor: 'pointer',
                }}
              >
                <PhoneOff size={15} />
                End Call
              </button>
            </div>
          )}

          {/* ── POST-CALL LOGGING ─────────────────────────────────────────── */}
          {phase === 'post' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                Log this call
              </p>

              {/* Outcome picker */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setCallOutcomeOpen(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '10px 12px',
                    background: 'var(--bg-elevated)', border: `0.5px solid ${selectedOutcome ? selectedOutcome.color + '50' : 'var(--border)'}`,
                    borderRadius: 8, cursor: 'pointer', fontSize: 13,
                    color: selectedOutcome ? selectedOutcome.color : 'var(--text-muted)',
                  }}
                >
                  <span>{selectedOutcome?.label || 'Select outcome…'}</span>
                  <ChevronDown size={13} />
                </button>
                {callOutcomeOpen && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                    marginTop: 4, background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
                    borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  }}>
                    {OUTCOMES.map(o => (
                      <button key={o.value}
                        onClick={() => { setOutcome(o.value); setCallOutcomeOpen(false) }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          width: '100%', padding: '9px 12px', border: 'none',
                          background: outcome === o.value ? 'var(--bg-elevated)' : 'transparent',
                          cursor: 'pointer', fontSize: 13,
                          color: o.color, textAlign: 'left',
                        }}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: o.color, flexShrink: 0 }} />
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Notes */}
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Notes (pain points, what they said, callback time…)"
                style={{
                  width: '100%', padding: '10px 12px',
                  background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                  borderRadius: 8, resize: 'none', height: 80,
                  fontSize: 13, color: 'var(--text-primary)',
                  fontFamily: 'inherit', lineHeight: 1.5,
                  outline: 'none', boxSizing: 'border-box',
                }}
              />

              {error && <p style={{ fontSize: 12, color: 'var(--danger)', margin: 0 }}>{error}</p>}

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleLogCall}
                  disabled={logging || !outcome}
                  style={{
                    flex: 1, height: 44,
                    background: outcome ? 'var(--accent)' : 'var(--bg-elevated)',
                    border: 'none', borderRadius: 8,
                    fontSize: 13, fontWeight: 500,
                    color: outcome ? 'white' : 'var(--text-muted)',
                    cursor: outcome ? 'pointer' : 'not-allowed',
                    opacity: logging ? 0.7 : 1,
                  }}
                >
                  {logging ? 'Saving…' : 'Save Call'}
                </button>
                <button
                  onClick={onClose}
                  style={{
                    padding: '0 16px', height: 44,
                    background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                    borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  Skip
                </button>
              </div>
            </div>
          )}

          {/* ── DONE ─────────────────────────────────────────────────────── */}
          {phase === 'done' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '16px 0' }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'rgba(34,197,94,0.1)', border: '0.5px solid rgba(34,197,94,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <CheckCircle size={22} color="var(--success)" />
              </div>
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>Call logged</p>
                {selectedOutcome && (
                  <p style={{ fontSize: 13, color: selectedOutcome.color, marginTop: 4 }}>{selectedOutcome.label}</p>
                )}
              </div>
              <button
                onClick={onClose}
                style={{
                  padding: '8px 24px', borderRadius: 8,
                  background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                  fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
