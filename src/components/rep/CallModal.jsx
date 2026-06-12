import { useState, useEffect, useRef, Component } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Phone, X, Loader2, RotateCcw, MapPin, User, Tag, Globe, Check, FileText, StickyNote, AlertTriangle, ChevronDown, CalendarClock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge } from '../ui/Badge'

// The only statuses a rep can set from the call modal — color coordinated.
// `note` tells the rep exactly where the lead routes (pipeline behavior).
const STATUS_OPTIONS = [
  { value: 'New',                color: '#38BDF8', dim: 'rgba(56,189,248,0.10)',  border: 'rgba(56,189,248,0.35)', note: null },
  { value: 'Appointment Booked', color: '#22C55E', dim: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.35)',  note: 'Sent to the closer pipeline — set the appointment time below' },
  { value: 'No Answer',          color: '#94A3B8', dim: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.35)', note: 'Back in rotation tomorrow — redistributed to the team after 24h' },
  { value: 'Not Interested',     color: '#EF4444', dim: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.35)',  note: 'Stays in your list today — permanently archived at end of day' },
  { value: 'Follow-Up',          color: '#F59E0B', dim: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.35)', note: 'Returns to your list on your chosen date' },
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
// generate-ai-script function is unreachable. Bullet cheat-sheet format —
// every line starts with "- " (rendered as bullets, same as AI output).
function fallbackScript(lead) {
  const biz   = lead.business_name || 'the business'
  const name  = lead.contact_name || 'the owner'
  const niche = lead.niche || 'service'
  return {
    opener: `- "Hey, is this ${biz}? Is ${name} around?"\n- Casual, peer-to-peer — you're not a telemarketer.\n- "Saw your listing — how's the season going?"`,
    problem: `- "Who's grabbing the phone when the crew's out on jobs?"\n- "How many calls a week would you guess hit voicemail?"\n- Let them talk — the pauses do the work.`,
    solution: `- Use THEIR numbers: "Say half those calls are real jobs…"\n- "What's an average job worth for you?"\n- Every missed call is money walking to a competitor ${niche} shop.`,
    objections: `- "Not interested" → "Fair — what happens to a call you can't answer right now?"\n- "Too busy" → "Exactly why I'm calling. 15 minutes, that's it."\n- One objection, one comeback, then go to the close.`,
    close: `- The only goal: book the 15-minute call.\n- Offer two times: "Tuesday at 2, or Thursday morning?"\n- Confirm the time, then get off the phone.`,
  }
}

// How long we wait for the AI script before falling back. functions.invoke()
// has NO built-in timeout — a stalled request would otherwise spin forever.
const SCRIPT_TIMEOUT_MS = 15000

// Coerce whatever the model returned into render-safe strings. Sections can
// come back as arrays of bullets (the bullet-format prompt invites it) or
// other shapes — rendering calls .split('\n'), so anything non-string used
// to crash the React tree (blank page: no error boundary existed).
// Returns null if nothing usable survives — caller falls back.
function normalizeScript(raw) {
  if (!raw || typeof raw !== 'object') return null
  const keys = ['opener', 'problem', 'solution', 'objections', 'close']
  const out = {}
  let usable = 0
  for (const k of keys) {
    const v = raw[k]
    if (typeof v === 'string' && v.trim()) {
      out[k] = v
      usable++
    } else if (Array.isArray(v) && v.length) {
      out[k] = v
        .map(x => String(x).trim())
        .filter(Boolean)
        .map(l => (l.startsWith('- ') || l.startsWith('• ') ? l : `- ${l}`))
        .join('\n')
      usable++
    }
    // anything else (object, number, empty) — drop the section
  }
  return usable >= 3 ? out : null
}

// Catches render-time crashes inside the modal so a bad script payload (or
// any other bug in here) degrades to a retry state instead of unmounting
// the entire app. The page going black on script failures was exactly this.
class ModalErrorBoundary extends Component {
  state = { crashed: false }
  static getDerivedStateFromError() { return { crashed: true } }
  render() {
    if (!this.state.crashed) return this.props.children
    return (
      <div style={{
        width: '100%', maxWidth: 480, background: '#0E0E1A',
        border: '0.5px solid var(--border)', borderRadius: 14,
        padding: '32px 28px', textAlign: 'center',
      }}>
        <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 8px' }}>
          Something went wrong loading this call
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 20px' }}>
          Nothing was saved. Close this and open the lead again — the script will regenerate.
        </p>
        <button
          onClick={this.props.onClose}
          style={{
            padding: '9px 24px', borderRadius: 8, background: 'var(--accent)',
            border: 'none', fontSize: 13, fontWeight: 500, color: 'white', cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    )
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
  const [notes, setNotes]             = useState(lead.notes || '')
  const [preCallNotes, setPreCallNotes] = useState(lead.pre_call_notes || '')
  const [followUpAt, setFollowUpAt]   = useState(toDatetimeLocal(lead.follow_up_at))
  const [followUpNotes, setFollowUpNotes] = useState(lead.follow_up_notes || '')
  const [appointmentAt, setAppointmentAt] = useState(toDatetimeLocal(lead.appointment_at))
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
      // Race the invoke against a hard timeout — without it a stalled
      // request leaves "Writing your discovery script…" spinning forever.
      const invoke = supabase.functions.invoke('generate-ai-script', {
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
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('script generation timed out')), SCRIPT_TIMEOUT_MS)
      )
      const { data, error } = await Promise.race([invoke, timeout])
      const normalized = normalizeScript(error ? null : data?.script)
      if (!normalized) throw new Error('no usable script')
      setScript(normalized)
    } catch {
      setScript(fallbackScript(lead))
      setIsFallback(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { generateScript() }, [lead.id])

  // Status selection is LOCAL ONLY — nothing touches the DB until Done.
  // X (close) discards any selection made since the modal opened.
  function selectStatus(value) {
    setStatusOpen(false)
    setStatusTouched(true)
    setStatus(value)
  }

  // Appointment Booked and Follow-Up cannot be saved without a date/time
  const needsDate =
    (status === 'Appointment Booked' && !appointmentAt) ||
    (status === 'Follow-Up' && !followUpAt)

  // Done is the ONLY commit path: status + notes (+ scheduling fields) save
  // together, then the calls table is synced to the NET outcome — one row
  // per lead per rep per UTC day, deleted on revert to New — so Calls Today
  // and Booked Today move with the lead's current state, matching the
  // progress bar. Pipeline routing happens in the handle_lead_pipeline DB
  // trigger: No Answer → 24h queue, random rep tomorrow; Follow-Up →
  // returns to this rep at the chosen time; Not Interested → permanent
  // do-not-contact.
  async function handleDone() {
    if (!statusTouched || needsDate) return
    setClosing(true)
    setDoneError('')
    try {
      const patch = {
        status,
        notes: notes || null,
        pre_call_notes: preCallNotes || null,
      }
      if (status === 'Follow-Up') {
        patch.follow_up_at    = new Date(followUpAt).toISOString()
        patch.follow_up_notes = followUpNotes || null
      }
      if (status === 'Appointment Booked') {
        // The pipeline trigger syncs an appointments row for the closer
        patch.appointment_at = new Date(appointmentAt).toISOString()
      }
      // .select() so a 0-row update (expired session, RLS mismatch) is a
      // visible error instead of a silent no-op that closes the modal
      const { data: updated, error } = await supabase
        .from('leads')
        .update(patch)
        .eq('id', lead.id)
        .select('id')
      if (error) throw error
      if (!updated?.length) throw new Error('Save failed — your session may have expired. Refresh the page and try again.')

      // Net calls sync — ALWAYS re-sync on Done. Guarding on
      // status !== lead.status used a possibly-stale lead prop (React Query
      // not yet refetched between rapid commits), which skipped the delete
      // and left phantom calls rows behind. Delete-then-insert is idempotent,
      // so unconditional is safe.
      if (profile?.id) {
        const utcMidnight = new Date().toISOString().split('T')[0] + 'T00:00:00Z'
        await supabase
          .from('calls')
          .delete()
          .eq('lead_id', lead.id)
          .eq('rep_id', profile.id)
          .gte('created_at', utcMidnight)
        if (CALL_OUTCOMES.includes(status)) {
          await supabase.from('calls').insert({
            lead_id: lead.id,
            rep_id: profile.id,
            outcome: status,
          })
        }
      }

      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
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
      <ModalErrorBoundary onClose={onClose}>
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

            {/* Status dropdown — color-coded outcomes, committed on Done (X discards) */}
            <div style={{ marginBottom: 14 }} ref={dropdownRef}>
              <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 6px' }}>Status</p>
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setStatusOpen(v => !v)}
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
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: o.color, flexShrink: 0, marginTop: o.note ? 3 : 0, alignSelf: o.note ? 'flex-start' : 'center' }} />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                          {o.value}
                          {o.note && (
                            <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', lineHeight: 1.3 }}>
                              {o.note}
                            </span>
                          )}
                        </span>
                        {status === o.value && <Check size={12} style={{ marginLeft: 'auto', flexShrink: 0 }} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selected?.note && (
                <p style={{ fontSize: 11, color: selected.color, margin: '5px 0 0', opacity: 0.9 }}>
                  {status === 'Follow-Up' && followUpAt
                    ? `Returns to your list on ${new Date(followUpAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                    : status === 'Appointment Booked' && appointmentAt
                    ? `Appointment: ${new Date(appointmentAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                    : selected.note}
                </p>
              )}
            </div>

            {/* Appointment scheduling — only when Appointment Booked is selected */}
            {status === 'Appointment Booked' && (
              <div style={{
                marginBottom: 14, padding: '12px',
                background: 'rgba(34,197,94,0.06)', borderRadius: 8,
                border: '0.5px solid rgba(34,197,94,0.2)',
              }}>
                <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#22C55E', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <CalendarClock size={10} /> Appointment Time
                </p>
                <input
                  type="datetime-local"
                  value={appointmentAt}
                  onChange={e => setAppointmentAt(e.target.value)}
                  style={{
                    width: '100%', height: 36, padding: '0 10px',
                    background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                    borderRadius: 7, fontSize: 13, color: 'var(--text-primary)',
                    fontFamily: 'var(--font-sans)', colorScheme: 'dark',
                    boxSizing: 'border-box',
                  }}
                />
                <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                  {appointmentAt
                    ? `Scheduled for ${new Date(appointmentAt).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} — saved when you hit Done.`
                    : 'Pick the day and time the prospect agreed to.'}
                </p>
              </div>
            )}

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
                      {script[key].split('\n').map((line, i) => {
                        const t = line.trim()
                        if (!t) return <div key={i} style={{ height: 6 }} />
                        // Bullet lines ("- ...") render as a tight list with a
                        // colored marker; anything else falls back to prose.
                        if (t.startsWith('- ') || t.startsWith('• ')) {
                          return (
                            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 5 }}>
                              <span style={{ fontSize: 13, lineHeight: 1.5, color, flexShrink: 0 }}>•</span>
                              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>{t.slice(2)}</p>
                            </div>
                          )
                        }
                        return <p key={i} style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 4px' }}>{line}</p>
                      })}
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

        {/* Footer — Done (the only save path) disabled until a status is
            picked, and blocked when Booked/Follow-Up is missing its date */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12,
          padding: '12px 18px',
          borderTop: '0.5px solid var(--border)',
          flexShrink: 0,
        }}>
          {doneError && <p style={{ fontSize: 12, color: 'var(--danger)', margin: 0 }}>{doneError}</p>}
          {!statusTouched ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>
              Select a status to finish — X discards changes
            </p>
          ) : needsDate ? (
            <p style={{ fontSize: 12, color: 'var(--warning)', margin: 0, fontStyle: 'italic' }}>
              {status === 'Appointment Booked'
                ? 'Pick the appointment date & time to save'
                : 'Pick the follow-up date & time to save'}
            </p>
          ) : null}
          <button
            onClick={handleDone}
            disabled={closing || !statusTouched || needsDate}
            style={{
              padding: '9px 24px', borderRadius: 8,
              background: (statusTouched && !needsDate) ? 'var(--accent)' : 'var(--bg-elevated)',
              border: (statusTouched && !needsDate) ? 'none' : '0.5px solid var(--border)',
              fontSize: 13, fontWeight: 500,
              color: (statusTouched && !needsDate) ? 'white' : 'var(--text-muted)',
              cursor: (closing || !statusTouched || needsDate) ? 'not-allowed' : 'pointer',
              opacity: closing ? 0.7 : (statusTouched && !needsDate) ? 1 : 0.6,
              transition: 'all 0.15s',
            }}
          >
            {closing ? 'Saving…' : 'Done'}
          </button>
        </div>
      </div>
      </ModalErrorBoundary>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>,
    document.body
  )
}
