import { useQuery } from '@tanstack/react-query'
import { Phone, Loader2, ExternalLink } from 'lucide-react'
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

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function MyCalls() {
  const { profile } = useAuth()

  const { data: calls = [], isLoading } = useQuery({
    queryKey: ['my-calls', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('calls')
        .select('id, created_at, outcome, grade, feedback_good, feedback_improve, graded_at, twilio_recording_url, lead:leads ( business_name )')
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
                style={{
                  padding: '14px 18px',
                  borderBottom: i < calls.length - 1 ? '0.5px solid var(--border)' : 'none',
                  display: 'flex', alignItems: 'flex-start', gap: 14,
                  animationDelay: `${i * 0.03}s`,
                }}
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
                  {c.feedback_good && (
                    <p style={{ fontSize: 12, color: 'var(--success)', margin: '0 0 2px', lineHeight: 1.5 }}>
                      ✓ {c.feedback_good}
                    </p>
                  )}
                  {c.feedback_improve && (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                      ↗ {c.feedback_improve}
                    </p>
                  )}
                </div>

                {/* Recording link */}
                {c.twilio_recording_url && (
                  <a
                    href={`${c.twilio_recording_url}.mp3`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4,
                      fontSize: 11, color: 'var(--accent)', textDecoration: 'none',
                      padding: '4px 10px', borderRadius: 6,
                      background: 'var(--accent-dim)',
                      border: '0.5px solid var(--accent-border)',
                    }}
                  >
                    <ExternalLink size={11} /> Play
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
