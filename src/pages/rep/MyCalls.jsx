import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Phone, Loader2, X, Play } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

const GRADE_COLOR = {
  'A+': 'var(--success)', 'A': 'var(--success)', 'A-': 'var(--success)',
  'B+': 'var(--info)',    'B': 'var(--info)',    'B-': 'var(--info)',
  'C+': 'var(--warning)', 'C': 'var(--warning)',
  'D':  'var(--danger)',  'F': 'var(--danger)',
}
const GRADE_DIM = {
  'A+': 'var(--success-dim)', 'A': 'var(--success-dim)', 'A-': 'var(--success-dim)',
  'B+': 'var(--info-dim)',    'B': 'var(--info-dim)',    'B-': 'var(--info-dim)',
  'C+': 'var(--warning-dim)', 'C': 'var(--warning-dim)',
  'D':  'var(--danger-dim)',  'F': 'var(--danger-dim)',
}
// "What to work on" severity: A/B range stays yellow, C+ and below escalates to red.
const IMPROVE_SEVERE = new Set(['C+', 'C', 'C-', 'D', 'F'])

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

export default function MyCalls() {
  const { profile } = useAuth()
  const [openCall, setOpenCall] = useState(null)

  const { data: calls = [], isLoading } = useQuery({
    queryKey: ['my-calls', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('calls')
        .select('id, created_at, outcome, grade, feedback_good, feedback_good_quote, feedback_improve, feedback_improve_quote, feedback_improve_example, graded_at, duration_seconds, twilio_recording_url, lead:leads ( business_name )')
        .eq('rep_id', profile.id)
        .not('graded_at', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data || []
    },
    enabled: !!profile?.id,
  })

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
          My Calls
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          AI-graded call recordings — letter grade + two coaching lines per call
        </p>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
          <Loader2 size={20} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : calls.length === 0 ? (
        <div className="glass" style={{ padding: '40px 24px', borderRadius: 12, textAlign: 'center' }}>
          <Phone size={20} style={{ color: 'var(--text-muted)', margin: '0 auto 8px', display: 'block' }} />
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 4px' }}>No graded calls yet</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            Grades appear here about 30–60 seconds after each recorded call ends.
          </p>
        </div>
      ) : (
        <div className="glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
          {calls.map((c, i) => {
            const color = GRADE_COLOR[c.grade] || 'var(--text-muted)'
            const dim   = GRADE_DIM[c.grade]   || 'var(--bg-elevated)'
            return (
              <div
                key={c.id}
                className="table-row-animated"
                onClick={() => setOpenCall(c)}
                style={{
                  padding: '14px 18px', cursor: 'pointer',
                  borderBottom: i < calls.length - 1 ? '0.5px solid var(--border)' : 'none',
                  display: 'flex', alignItems: 'center', gap: 14,
                  animationDelay: `${i * 0.03}s`,
                  transition: 'background-color 100ms',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                {/* Grade badge */}
                <div style={{
                  width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                  background: dim,
                  border: `0.5px solid ${color}55`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{
                    fontSize: 14, fontWeight: 700, color,
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {c.grade || '—'}
                  </span>
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <p style={{
                      fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {c.lead?.business_name || 'Unknown business'}
                    </p>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                      {fmtDate(c.created_at)}
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                    {c.outcome || '—'}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {openCall && <CallDetailModal call={openCall} onClose={() => setOpenCall(null)} />}
    </div>
  )
}

// Dismissible info popup (X + backdrop-click both close it) — NOT the locked-modal
// pattern used by the exam/video locks (Prompts 174/183/185), which intentionally
// can't be dismissed mid-flow. This is just call detail, always safe to close.
function CallDetailModal({ call: c, onClose }) {
  const color = GRADE_COLOR[c.grade] || 'var(--text-muted)'
  const dim   = GRADE_DIM[c.grade]   || 'var(--bg-elevated)'
  const hasRecording = !!c.twilio_recording_url
  const improveColor = IMPROVE_SEVERE.has(c.grade) ? 'var(--danger)' : 'var(--warning)'

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(8,8,16,0.85)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 960, maxHeight: '88vh', overflowY: 'auto',
          background: '#0E0E1A', border: '0.5px solid var(--border)', borderRadius: 14,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)', padding: 28, position: 'relative',
        }}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingRight: 28 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 10, flexShrink: 0,
            background: dim, border: `0.5px solid ${color}55`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 14, fontWeight: 700, color, fontFamily: 'var(--font-mono)' }}>
              {c.grade || '—'}
            </span>
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.lead?.business_name || 'Unknown business'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
              {fmtDate(c.created_at)}
            </p>
          </div>
        </div>

        {/* Audio player shell — inert until twilio_recording_url is populated */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
          background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 10,
          marginBottom: 20, opacity: hasRecording ? 1 : 0.5,
        }}>
          <button
            disabled={!hasRecording}
            style={{
              width: 30, height: 30, borderRadius: '50%', flexShrink: 0, border: 'none',
              background: 'var(--accent)', color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: hasRecording ? 'pointer' : 'default',
            }}
          >
            <Play size={13} fill="white" />
          </button>
          <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: '0%', height: '100%', background: 'var(--accent)' }} />
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
            0:00 / {fmtDuration(c.duration_seconds)}
          </span>
        </div>

        {/* Feedback — bordered cards, richer detail from migration 064 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {c.feedback_good && (
            <div style={{
              background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
              borderRadius: 10, padding: 16,
            }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--success)', margin: 0, lineHeight: 1.5 }}>
                ✓ {c.feedback_good}
              </p>
              {c.feedback_good_quote && (
                <p style={{
                  fontSize: 12, color: 'var(--text-secondary)', margin: '10px 0 0',
                  lineHeight: 1.5, paddingLeft: 10, borderLeft: '2px solid rgba(34,197,94,0.3)',
                }}>
                  "What you said" — {c.feedback_good_quote}
                </p>
              )}
            </div>
          )}
          {c.feedback_improve && (
            <div style={{
              background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
              borderRadius: 10, padding: 16,
            }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: improveColor, margin: 0, lineHeight: 1.5 }}>
                ↗ {c.feedback_improve}
              </p>
              {c.feedback_improve_quote && (
                <p style={{
                  fontSize: 12, color: 'var(--text-secondary)', margin: '10px 0 0',
                  lineHeight: 1.5, paddingLeft: 10, borderLeft: `2px solid ${improveColor}55`,
                }}>
                  "What you said" — {c.feedback_improve_quote}
                </p>
              )}
              {c.feedback_improve_example && (
                <p style={{
                  fontSize: 12, color: 'var(--success)', margin: '8px 0 0',
                  lineHeight: 1.5, paddingLeft: 10, borderLeft: '2px solid rgba(34,197,94,0.3)',
                }}>
                  "Try instead" — {c.feedback_improve_example}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
