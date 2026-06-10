import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Phone, X, Loader2, RotateCcw, MapPin, User, Tag, Globe, Check, FileText, StickyNote, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useUpdateLeadStatus } from '../../hooks/useLeads'
import { Badge } from '../ui/Badge'

// All statuses a rep can set — matches the lead_status enum
const STATUSES = ['New', 'Contacted', 'Interested', 'Callback', 'No Answer', 'Voicemail', 'Not Interested', 'Booked']

// Color-coded script sections
const SECTIONS = [
  { key: 'opener',     label: 'Opener',             color: 'var(--accent)',  dim: 'rgba(108,99,255,0.08)',  border: 'rgba(108,99,255,0.25)' },
  { key: 'problem',    label: 'Problem Discovery',  color: 'var(--info)',    dim: 'rgba(56,189,248,0.08)',  border: 'rgba(56,189,248,0.25)' },
  { key: 'solution',   label: 'Pain Amplification', color: 'var(--warning)', dim: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.25)' },
  { key: 'objections', label: 'Objection Handling', color: 'var(--danger)',  dim: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)' },
  { key: 'close',      label: 'Close',              color: 'var(--success)', dim: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.25)' },
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

// Labeled info field for the left column
function Field({ icon: Icon, label, value, mono = false }) {
  if (!value) return null
  return (
    <div style={{ marginBottom: 12 }}>
      <p style={{
        fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
        color: 'var(--text-muted)', margin: '0 0 3px',
        display: 'flex', alignItems: 'center', gap: 5,
      }}>
        {Icon && <Icon size={10} />} {label}
      </p>
      <p style={{
        fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55,
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        wordBreak: 'break-word',
      }}>
        {value}
      </p>
    </div>
  )
}

export function CallModal({ lead, onClose }) {
  const updateStatus = useUpdateLeadStatus()

  const [script, setScript]         = useState(null)
  const [loading, setLoading]       = useState(true)
  const [isFallback, setIsFallback] = useState(false)
  const [status, setStatus]         = useState(lead.status)
  const [saveState, setSaveState]   = useState('idle') // idle | saving | saved | error

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

  async function handleStatusChange(e) {
    const next = e.target.value
    setStatus(next)
    setSaveState('saving')
    try {
      await updateStatus.mutateAsync({ leadId: lead.id, status: next })
      setSaveState('saved')
      setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 2000)
    } catch {
      setSaveState('error')
    }
  }

  const telHref = lead.phone ? `tel:${lead.phone.replace(/\D/g, '')}` : null

  // Rendered through a portal: ancestors with transform/backdrop-filter
  // (e.g. animated table rows) would otherwise hijack position:fixed.
  // stopPropagation keeps clicks inside the modal from bubbling to the
  // row that opened it (React events bubble through the component tree
  // even across portals).
  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(8,8,16,0.85)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: '100%', maxWidth: 960, maxHeight: '88vh',
        display: 'flex', flexDirection: 'column',
        // solid backdrop — --bg-surface is translucent and lets the page bleed through
        background: '#0E0E1A',
        border: '0.5px solid var(--border)',
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 18px',
          borderBottom: '0.5px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'var(--accent-dim)',
            border: '0.5px solid var(--accent-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Phone size={16} color="var(--accent)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lead.business_name}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
              Call prep · everything you need in one place
            </p>
          </div>
          <Badge label={status} />
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 8 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body — two columns */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>

          {/* LEFT — lead info + status + call */}
          <div
            className="scrollbar-thin"
            style={{
              flex: '0 0 320px', minWidth: 0,
              borderRight: '0.5px solid var(--border)',
              overflowY: 'auto',
              padding: '16px 18px',
              display: 'flex', flexDirection: 'column',
            }}
          >
            <Field icon={User}   label="Contact"  value={lead.contact_name} />
            <Field icon={Tag}    label="Niche"    value={lead.niche} />
            <Field icon={MapPin} label="City"     value={[lead.city, lead.state].filter(Boolean).join(', ')} />
            <Field icon={Phone}  label="Phone"    value={lead.phone} mono />
            <Field icon={Globe}  label="Source"   value={lead.source === 'google_maps' ? 'Google Maps' : lead.source === 'indeed' ? 'Indeed' : lead.source} />

            {lead.pain_points && (
              <div style={{
                marginBottom: 12, padding: '10px 12px',
                background: 'rgba(245,158,11,0.06)', borderRadius: 8,
                border: '0.5px solid rgba(245,158,11,0.18)',
              }}>
                <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--warning)', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <AlertTriangle size={10} /> Pain Points
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>{lead.pain_points}</p>
              </div>
            )}

            {lead.notes && (
              <div style={{
                marginBottom: 12, padding: '10px 12px',
                background: 'var(--bg-elevated)', borderRadius: 8,
                border: '0.5px solid var(--border)',
              }}>
                <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <StickyNote size={10} /> Notes
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>{lead.notes}</p>
              </div>
            )}

            {/* Status dropdown — saves immediately */}
            <div style={{ marginTop: 'auto', paddingTop: 12 }}>
              <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 6px' }}>Status</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select
                  value={status}
                  onChange={handleStatusChange}
                  disabled={saveState === 'saving'}
                  style={{
                    flex: 1, height: 38, padding: '0 10px',
                    background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                    borderRadius: 8, fontSize: 13, color: 'var(--text-primary)',
                    fontFamily: 'var(--font-sans)', cursor: 'pointer',
                  }}
                >
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {saveState === 'saving' && <Loader2 size={14} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />}
                {saveState === 'saved'  && <Check size={14} color="var(--success)" />}
              </div>
              {saveState === 'error' && (
                <p style={{ fontSize: 11, color: 'var(--danger)', margin: '5px 0 0' }}>Save failed — try again.</p>
              )}
              {saveState === 'saved' && (
                <p style={{ fontSize: 11, color: 'var(--success)', margin: '5px 0 0' }}>Saved</p>
              )}

              {/* Call Now — tel: link for now */}
              {telHref ? (
                <a
                  href={telHref}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    marginTop: 12, height: 44,
                    background: 'var(--success)', borderRadius: 10,
                    fontSize: 14, fontWeight: 500, color: 'white',
                    textDecoration: 'none',
                    boxShadow: '0 0 20px rgba(34,197,94,0.3)',
                  }}
                >
                  <Phone size={15} />
                  Call {lead.phone}
                </a>
              ) : (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginTop: 12, height: 44,
                  background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                  borderRadius: 10, fontSize: 13, color: 'var(--text-muted)',
                }}>
                  No phone number on file
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — AI discovery script */}
          <div
            className="scrollbar-thin"
            style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column' }}
          >
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, flex: 1, padding: '48px 0' }}>
                <Loader2 size={26} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Writing your discovery script…</p>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                  <FileText size={13} color="var(--accent)" />
                  <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>Discovery Script</p>
                  {isFallback && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', marginLeft: 6 }}>
                      standard version — AI personalization unavailable
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {SECTIONS.map(({ key, label, color, dim, border }) => script?.[key] && (
                    <div key={key} style={{
                      background: dim,
                      border: `0.5px solid ${border}`,
                      borderLeft: `3px solid ${color}`,
                      borderRadius: 10,
                      padding: '12px 14px',
                    }}>
                      <p style={{
                        fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em',
                        color, margin: '0 0 7px', fontWeight: 600,
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
                <button
                  onClick={generateScript}
                  disabled={loading}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    marginTop: 14, padding: '9px 14px', borderRadius: 8,
                    background: 'transparent', border: '0.5px solid var(--border)',
                    fontSize: 13, color: 'var(--text-secondary)',
                    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
                    alignSelf: 'flex-start',
                  }}
                >
                  <RotateCcw size={13} />
                  Regenerate
                </button>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          padding: '12px 18px',
          borderTop: '0.5px solid var(--border)',
          flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '9px 24px', borderRadius: 8,
              background: 'var(--accent)', border: 'none',
              fontSize: 13, fontWeight: 500, color: 'white', cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>,
    document.body
  )
}
