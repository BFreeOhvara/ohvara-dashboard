import { useState, useEffect } from 'react'
import { Phone, X, Loader2, RotateCcw, MapPin, User } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// Section order + labels for the discovery script
const SECTIONS = [
  { key: 'opener',     label: 'Opener' },
  { key: 'problem',    label: 'Problem Discovery' },
  { key: 'solution',   label: 'Pain Amplification' },
  { key: 'objections', label: 'Objection Handling' },
  { key: 'close',      label: 'Close / Book' },
]

// Static fallback so the modal always shows a usable script even if the
// generate-ai-script function is unreachable.
function fallbackScript(lead) {
  const biz   = lead.business_name || 'the business'
  const name  = lead.contact_name || 'there'
  const niche = lead.niche || 'service'
  return {
    opener: `"Hey, is this ${biz}? ${name}, I was looking at your listing — how's business going this season?"\n\nKeep it casual. You're a peer, not a telemarketer.`,
    problem: `"How are you handling calls when the whole crew is out on jobs?"\n\n"Roughly how many calls a week would you say go to voicemail?"\n\nLet them talk. Every missed call for a ${niche} business is real money.`,
    solution: `"So if 8–10 calls a week are going to voicemail, and even half of those are real jobs… that's serious revenue walking to a competitor every month."\n\nMake the cost concrete. Use their numbers, not yours.`,
    objections: `"Not interested" → "Totally fair — most ${niche} owners say that until they see the missed-call math. Can I ask just one thing: what happens to a call you can't answer right now?"\n\n"Too busy" → "That's exactly why I'm calling. This takes 15 minutes and saves you hours."`,
    close: `"Look, I don't want to take up your morning. Let's do a quick 15-minute call this week — I'll show you exactly how many calls you're missing and what they're worth. Does Tuesday or Thursday work better?"\n\nAlways offer two times. Confirm and get off the phone.`,
  }
}

export function CallModal({ lead, onClose }) {
  const [script, setScript]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [isFallback, setIsFallback] = useState(false)

  async function generateScript() {
    setLoading(true)
    setIsFallback(false)
    try {
      const { data, error } = await supabase.functions.invoke('generate-ai-script', {
        body: {
          lead_id: lead.id,
          business_name: lead.business_name,
          contact_name: lead.contact_name,
          niche: lead.niche,
          city: lead.city,
          pain_points: lead.pain_points,
          notes: lead.notes,
        },
      })
      if (error || !data?.script) throw new Error('no script')
      setScript(data.script)
    } catch {
      setScript(fallbackScript(lead))
      setIsFallback(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { generateScript() }, [lead.id])

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
        width: '100%', maxWidth: 560, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        // solid backdrop — --bg-surface is translucent and lets the page bleed through
        background: '#0E0E1A',
        border: '0.5px solid var(--border)',
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>

        {/* Header — lead identity */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '16px 18px',
          borderBottom: '0.5px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'var(--accent-dim)',
            border: '0.5px solid var(--accent-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Phone size={17} color="var(--accent)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lead.business_name}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 3, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                <User size={11} /> {lead.contact_name || 'Owner'}
              </span>
              {(lead.city || lead.state) && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                  <MapPin size={11} /> {lead.city}{lead.state ? `, ${lead.state}` : ''}
                </span>
              )}
              {lead.phone && (
                <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 500 }}>
                  {lead.phone}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 8 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body — discovery script */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }} className="scrollbar-thin">
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '48px 0' }}>
              <Loader2 size={26} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Writing your discovery script…</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {isFallback && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>
                  Using the standard script — AI personalization unavailable right now.
                </p>
              )}
              {SECTIONS.map(({ key, label }) => script?.[key] && (
                <div key={key} style={{
                  background: 'var(--bg-elevated)',
                  border: '0.5px solid var(--border)',
                  borderRadius: 10,
                  padding: '12px 14px',
                }}>
                  <p style={{
                    fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em',
                    color: 'var(--accent)', margin: '0 0 7px', fontWeight: 600,
                  }}>
                    {label}
                  </p>
                  {script[key].split('\n').map((line, i) =>
                    line
                      ? <p key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 4px' }}>{line}</p>
                      : <div key={i} style={{ height: 6 }} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 18px',
          borderTop: '0.5px solid var(--border)',
          flexShrink: 0,
        }}>
          <button
            onClick={generateScript}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 8,
              background: 'transparent', border: '0.5px solid var(--border)',
              fontSize: 13, color: 'var(--text-secondary)',
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
            }}
          >
            <RotateCcw size={13} />
            Regenerate
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '8px 20px', borderRadius: 8,
              background: 'var(--accent)', border: 'none',
              fontSize: 13, fontWeight: 500, color: 'white', cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
