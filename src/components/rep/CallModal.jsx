import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Phone, X, Loader2, RotateCcw, MapPin, User, Tag, Globe, Check, FileText, StickyNote, AlertTriangle, ChevronDown, CalendarClock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge } from '../ui/Badge'

// The only statuses a rep can set from the call modal — color coordinated
const STATUS_OPTIONS = [
  { value: 'New',                color: '#38BDF8', dim: 'rgba(56,189,248,0.10)',  border: 'rgba(56,189,248,0.35)' },
  { value: 'Appointment Booked', color: '#22C55E', dim: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.35)' },
  { value: 'No Answer',          color: '#94A3B8', dim: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.35)' },
  { value: 'Not Interested',     color: '#EF4444', dim: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.35)' },
  { value: 'Follow-Up',          color: '#F59E0B', dim: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.35)' },
]

// Statuses that count as a completed dial — logged to the calls table for stats
const CALL_OUTCOMES = ['Appointment Booked', 'No Answer', 'Not Interested', 'Follow-Up']

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

// timestamptz → value for <input type="datetime-local"> in local time
function toDatetimeLocal(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d)) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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
  const qc = useQueryClient()
  const { profile } = useAuth()

  const [script, setScript]           = useState(null)
  const [loading, setLoading]         = useState(true)
  const [isFallback, setIsFallback]   = useState(false)
  const [status, setStatus]           = useState(lead.status)
  const [statusTouched, setStatusTouched] = useState(false)
  const [statusOpen, setStatusOpen]   = useState(false)
  const [saveState, setSaveState]     = useState('idle') // idle | saving | saved | error
  const [notes, setNotes]             = useState(lead.notes || '')
  const [preCallNotes, setPreCallNotes] = useState(lead.pre_call_notes || '')
  const [followUpAt, setFollowUpAt]   = useState(toDatetimeLocal(lead.follow_up_at))
  const [followUpNotes, setFollowUpNotes] = useState(lead.follow_up_notes || '')
  const [closing, setClosing]         = useState(false)
  const [doneError, setDoneError]     = useState('')
  const dropdownRef = useRef(null)

  // Background scroll lock while the modal is open.
  // Lock <html> as well as <body> — overflow:hidden on body alone still
  // lets the documentElement scroller move (incl. programmatic scrolls).
  useEffect(() => {
    const prevBody = document.body.style.overflow
    const prevHtml = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevBody
      document.documentElement.style.overflow = prevHtml
    }
  }, [])

  // Close the status dropdown on outside click
  useEffect(() => {
    function onDocClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setStatusOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

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

  // Status saves to DB immediately on selection.
  // no_answer_at is stamped by a DB trigger; a pg_cron job re-queues
  // No Answer leads back to 'New' after 4 hours.
  // Real outcomes also log a row in calls so My Stats stays live.
  async function selectStatus(value) {
    setStatusOpen(false)
    setStatusTouched(true)
    if (value === status) return
    setStatus(value)
    setSaveState('saving')
    try {
      const { error } = await supabase.from('leads').update({ status: value }).eq('id', lead.id)
      if (error) throw error
      if (CALL_OUTCOMES.includes(value) && profile?.id) {
        await supabase.from('calls').insert({
          lead_id: lead.id,
          rep_id: profile.id,
          outcome: value,
        })
      }
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      setSaveState('saved')
      setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 2000)
    } catch {
      setSaveState('error')
    }
  }

  // Done: persist both note fields (+ follow-up fields when scheduled), then close
  async function handleDone() {
    if (!statusTouched) return
    setClosing(true)
    setDoneError('')
    try {
      const patch = {
        notes: notes || null,
        pre_call_notes: preCallNotes || null,
      }
      if (status === 'Follow-Up') {
        patch.follow_up_at    = followUpAt ? new Date(followUpAt).toISOString() : null
        patch.follow_up_notes = followUpNotes || null
      }
      const { error } = await supabase.from('leads').update(patch).eq('id', lead.id)
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['leads'] })
      onClose()
    } catch (err) {
      setDoneError(err.message || 'Failed to save')
      setClosing(false)
    }
  }

  const selected = STATUS_OPTIONS.find(o => o.value === status)
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
      onClick={e => e.stopPropagation() /* click-outside does NOT close — exit via X (discard) or Done (save) */}
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

          {/* LEFT — lead info, status, follow-up, notes, call */}
          <div
            className="scrollbar-thin"
            style={{
              flex: '0 0 340px', minWidth: 0,
              borderRight: '0.5px solid var(--border)',
              overflowY: 'auto',
              padding: '16px 18px',
            }}
          >
            <Field icon={User}   label="Contact"  value={lead.contact_name} />
            <Field icon={Tag}    label="Niche"    value={lead.niche} />
            <Field icon={MapPin} label="City"     value={[lead.city, lead.state].filter(Boolean).join(', ')} />
            <Field icon={Phone}  label="Phone"    value={lead.phone} mono />
            <Field icon={Globe}  label="Source"   value={lead.source === 'google_maps' ? 'Google Maps' : lead.source === 'indeed' ? 'Indeed' : lead.source} />

            {lead.pain_points && (
              <div style={{
                marginBottom: 14, padding: '10px 12px',
                background: 'rgba(245,158,11,0.06)', borderRadius: 8,
                border: '0.5px solid rgba(245,158,11,0.18)',
              }}>
                <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--warning)', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <AlertTriangle size={10} /> Pain Points
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>{lead.pain_points}</p>
              </div>
            )}

            {/* Pre-call notes — research about the lead before dialing, saved on Done */}
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 5 }}>
                <StickyNote size={10} /> Pre-Call Notes
              </p>
              <textarea
                value={preCallNotes}
                onChange={e => setPreCallNotes(e.target.value)}
                placeholder="Research before you dial: who owns it, recent reviews, hiring posts…"
                rows={2}
                style={{
                  width: '100%', padding: '8px 10px',
                  background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                  borderRadius: 8, fontSize: 13, color: 'var(--text-primary)',
                  fontFamily: 'var(--font-sans)', resize: 'vertical', lineHeight: 1.5,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Status dropdown — color-coded outcomes, saves on change */}
            <div style={{ marginBottom: 14 }} ref={dropdownRef}>
              <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 6px' }}>Status</p>
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setStatusOpen(v => !v)}
                  disabled={saveState === 'saving'}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    width: '100%', height: 40, padding: '0 12px',
                    background: selected ? selected.dim : 'var(--bg-elevated)',
                    border: `0.5px solid ${selected ? selected.border : 'var(--border)'}`,
                    borderRadius: 8, cursor: 'pointer', fontSize: 13,
                    color: selected ? selected.color : 'var(--text-secondary)',
                    fontWeight: 500,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {selected && <span style={{ width: 8, height: 8, borderRadius: '50%', background: selected.color, flexShrink: 0 }} />}
                    {selected ? selected.value : `${status} — pick an outcome`}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {saveState === 'saving' && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
                    {saveState === 'saved'  && <Check size={13} color="#22C55E" />}
                    <ChevronDown size={14} />
                  </span>
                </button>
                {statusOpen && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                    marginTop: 4, background: '#13131F', border: '0.5px solid var(--border)',
                    borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  }}>
                    {STATUS_OPTIONS.map(o => (
                      <button
                        key={o.value}
                        onClick={() => selectStatus(o.value)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 9,
                          width: '100%', padding: '11px 12px', border: 'none',
                          background: status === o.value ? o.dim : 'transparent',
                          cursor: 'pointer', fontSize: 13, fontWeight: 500,
                          color: o.color, textAlign: 'left',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = o.dim }}
                        onMouseLeave={e => { e.currentTarget.style.background = status === o.value ? o.dim : 'transparent' }}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: o.color, flexShrink: 0 }} />
                        {o.value}
                        {status === o.value && <Check size={12} style={{ marginLeft: 'auto' }} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {saveState === 'error' && (
                <p style={{ fontSize: 11, color: 'var(--danger)', margin: '5px 0 0' }}>Save failed — try again.</p>
              )}
              {status === 'No Answer' && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '5px 0 0' }}>
                  Re-queues back into your list as New in 4 hours.
                </p>
              )}
            </div>

            {/* Follow-Up scheduling — only when Follow-Up is selected */}
            {status === 'Follow-Up' && (
              <div style={{
                marginBottom: 14, padding: '12px',
                background: 'rgba(245,158,11,0.06)', borderRadius: 8,
                border: '0.5px solid rgba(245,158,11,0.2)',
              }}>
                <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#F59E0B', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <CalendarClock size={10} /> Schedule Follow-Up
                </p>
                <input
                  type="datetime-local"
                  value={followUpAt}
                  onChange={e => setFollowUpAt(e.target.value)}
                  style={{
                    width: '100%', height: 36, padding: '0 10px', marginBottom: 8,
                    background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                    borderRadius: 7, fontSize: 13, color: 'var(--text-primary)',
                    fontFamily: 'var(--font-sans)', colorScheme: 'dark',
                    boxSizing: 'border-box',
                  }}
                />
                <textarea
                  value={followUpNotes}
                  onChange={e => setFollowUpNotes(e.target.value)}
                  placeholder="Reason for follow-up (e.g. owner asked to call back Thursday)…"
                  rows={2}
                  style={{
                    width: '100%', padding: '8px 10px',
                    background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                    borderRadius: 7, fontSize: 13, color: 'var(--text-primary)',
                    fontFamily: 'var(--font-sans)', resize: 'none', lineHeight: 1.5,
                    boxSizing: 'border-box',
                  }}
                />
                <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '6px 0 0' }}>Saved when you hit Done.</p>
              </div>
            )}

            {/* Call notes — always available, saved on Done */}
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 5 }}>
                <StickyNote size={10} /> Call Notes
              </p>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="What happened on this call? Pain points, who answered, best time to retry…"
                rows={3}
                style={{
                  width: '100%', padding: '8px 10px',
                  background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                  borderRadius: 8, fontSize: 13, color: 'var(--text-primary)',
                  fontFamily: 'var(--font-sans)', resize: 'vertical', lineHeight: 1.5,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Call Now — tel: link for now */}
            {telHref ? (
              <a
                href={telHref}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  height: 44,
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
                height: 44,
                background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                borderRadius: 10, fontSize: 13, color: 'var(--text-muted)',
              }}>
                No phone number on file
              </div>
            )}
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

        {/* Footer — Done disabled until the rep picks a status for this call */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12,
          padding: '12px 18px',
          borderTop: '0.5px solid var(--border)',
          flexShrink: 0,
        }}>
          {doneError && <p style={{ fontSize: 12, color: 'var(--danger)', margin: 0 }}>{doneError}</p>}
          {!statusTouched && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>
              Select a status to finish
            </p>
          )}
          <button
            onClick={handleDone}
            disabled={closing || !statusTouched}
            style={{
              padding: '9px 24px', borderRadius: 8,
              background: statusTouched ? 'var(--accent)' : 'var(--bg-elevated)',
              border: statusTouched ? 'none' : '0.5px solid var(--border)',
              fontSize: 13, fontWeight: 500,
              color: statusTouched ? 'white' : 'var(--text-muted)',
              cursor: (closing || !statusTouched) ? 'not-allowed' : 'pointer',
              opacity: closing ? 0.7 : statusTouched ? 1 : 0.6,
              transition: 'all 0.15s',
            }}
          >
            {closing ? 'Saving…' : 'Done'}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>,
    document.body
  )
}
