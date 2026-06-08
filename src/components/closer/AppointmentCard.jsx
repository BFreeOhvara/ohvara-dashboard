import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, MapPin, Phone, Mail, Sparkles, Loader2, Calendar, Bell,
         TrendingUp, MessageSquare, Target, Zap } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Select, Textarea, Input } from '../ui/Input'
import { useUpdateAppointment } from '../../hooks/useAppointments'
import { supabase } from '../../lib/supabase'

// Tier badge colors — token-based, no hardcoded Tailwind color names
const TIER_STYLES = {
  'Starter':    'bg-[var(--info-dim)] text-[var(--info)] border border-[#38BDF8]/20',
  'Growth':     'bg-[var(--accent-dim)] text-[var(--accent)] border border-[#6C63FF]/20',
  'Full Stack': 'bg-[var(--success-dim)] text-[var(--success)] border border-[#22C55E]/20',
}

const TIER_COLORS = {
  'Starter':    'text-[var(--info)]',
  'Growth':     'text-[var(--accent)]',
  'Full Stack': 'text-[var(--success)]',
}

export function AppointmentCard({ appt }) {
  const [expanded, setExpanded] = useState(true) // open by default
  const [outcome, setOutcome] = useState('')
  const [dealValue, setDealValue] = useState('')
  const [lossReason, setLossReason] = useState('')
  const [notes, setNotes] = useState(appt.closer_notes || '')
  const [scheduledAt, setScheduledAt] = useState(
    appt.scheduled_at ? new Date(appt.scheduled_at).toISOString().slice(0, 16) : ''
  )
  const [stackAnalysis, setStackAnalysis] = useState(null)
  const [stackLoading, setStackLoading] = useState(false)
  const [briefing, setBriefing] = useState(null)
  const [briefingLoading, setBriefingLoading] = useState(false)
  const [closedFast, setClosedFast] = useState(false)
  const [stripeMsg, setStripeMsg] = useState(null)
  const update = useUpdateAppointment()
  const lead = appt.lead

  // Auto-load both stack analysis and briefing on mount
  useEffect(() => {
    if (!lead) return
    if (!stackAnalysis && !stackLoading) loadStackAnalysis()
    if (!briefing && !briefingLoading) loadBriefing()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadStackAnalysis() {
    setStackLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('generate-ai-script', {
        body: {
          mode: 'stack_analysis',
          business_name: lead.business_name,
          contact_name: lead.contact_name,
          niche: lead.niche,
          city: lead.city,
          job_title: lead.job_title,
          monthly_labor_cost: lead.monthly_labor_cost,
          pain_points: lead.pain_points,
          notes: lead.notes,
        },
      })
      if (!error && data?.analysis) setStackAnalysis(data.analysis)
    } catch (err) {
      console.error('[AppointmentCard] stack analysis failed:', err)
    } finally {
      setStackLoading(false)
    }
  }

  async function loadBriefing() {
    setBriefingLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('generate-ai-script', {
        body: {
          mode: 'briefing',
          business_name: lead.business_name,
          contact_name: lead.contact_name,
          niche: lead.niche,
          city: lead.city,
          pain_points: lead.pain_points,
          notes: lead.notes,
        },
      })
      if (!error) setBriefing(data.briefing)
    } finally {
      setBriefingLoading(false)
    }
  }

  async function handleComplete() {
    if (!outcome) return
    const updates = {
      status: 'completed',
      outcome,
      deal_value: outcome === 'closed' ? parseFloat(dealValue) || null : null,
      loss_reason: outcome !== 'closed' ? lossReason : null,
      closer_notes: notes,
    }
    if (outcome === 'no_show' || outcome === 'lost') {
      await cancelReminders(appt.id)
    }
    await update.mutateAsync({ appointmentId: appt.id, updates })
  }

  async function handleSchedule() {
    if (!scheduledAt) return
    const iso = new Date(scheduledAt).toISOString()
    await update.mutateAsync({
      appointmentId: appt.id,
      updates: { scheduled_at: iso, status: 'pending' },
    })
    await supabase.functions.invoke('schedule-reminders', {
      body: { appointment_id: appt.id, scheduled_at: iso, lead_phone: lead.phone, contact_name: lead.contact_name },
    })
  }

  // Quick close — marks outcome 'closed' immediately, no deal value prompt
  async function handleMarkClosed() {
    setClosedFast(true)
    try {
      await update.mutateAsync({
        appointmentId: appt.id,
        updates: { status: 'completed', outcome: 'closed', closer_notes: notes || undefined },
      })
    } finally {
      setClosedFast(false)
    }
  }

  // Generate Stripe link based on recommended tier
  // WIRE-THIS: Replace with real Stripe API call once keys are configured in Edge Function secrets.
  function handleStripeLink() {
    const tier = stackAnalysis?.tier || 'Growth'
    const price = stackAnalysis?.price || 797
    const biz = encodeURIComponent(lead?.business_name || 'Client')
    // Placeholder — opens Stripe payment links dashboard until API is wired
    const url = `https://dashboard.stripe.com/payment-links/create?amount=${price * 100}&currency=usd&name=${biz}+Ohvara+${encodeURIComponent(tier)}`
    window.open(url, '_blank', 'noopener')
    setStripeMsg(`Opened Stripe for ${tier} · $${price}/mo`)
    setTimeout(() => setStripeMsg(null), 4000)
  }

  // Determine displayed tier from analysis or fallback
  const displayTier = stackAnalysis
    ? { name: stackAnalysis.tier, price: stackAnalysis.price }
    : null

  return (
    <div className="glass" style={{ overflow: 'hidden', marginBottom: 0 }}>
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-[var(--text-primary)] truncate">{lead.business_name}</p>
            {displayTier && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-medium ${TIER_STYLES[displayTier.name] || TIER_STYLES['Growth']}`}>
                {displayTier.name} · ${displayTier.price?.toLocaleString()}/mo
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {lead.contact_name && <span className="text-xs text-[var(--text-muted)]">{lead.contact_name}</span>}
            {lead.city && (
              <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                <MapPin size={10} /> {lead.city}
              </span>
            )}
            {appt.rep && <span className="text-xs text-[var(--text-muted)]">Set by {appt.rep.full_name}</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {appt.scheduled_at ? (
            <span className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
              <Calendar size={11} />
              {new Date(appt.scheduled_at).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
              })}
            </span>
          ) : (
            <span className="text-xs text-[var(--text-muted)] italic">Not scheduled</span>
          )}
          <Badge label={appt.status} />
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              color: 'var(--text-muted)', background: 'none', border: 'none',
              padding: 4, cursor: 'pointer', borderRadius: 4,
              transition: 'color 100ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {/* Quick action row — always visible */}
      <div style={{
        display: 'flex', gap: 8, padding: '0 16px 12px', alignItems: 'center', flexWrap: 'wrap',
      }}>
        <button
          onClick={handleMarkClosed}
          disabled={closedFast || appt.status === 'completed'}
          style={{
            height: 30, padding: '0 12px',
            background: 'var(--accent)', color: '#fff',
            borderRadius: 6, border: 'none',
            fontSize: 12, cursor: 'pointer',
            opacity: closedFast || appt.status === 'completed' ? 0.5 : 1,
            transition: 'opacity 100ms',
          }}
        >
          {closedFast ? 'Saving…' : 'Mark Closed'}
        </button>
        <button
          onClick={handleStripeLink}
          style={{
            height: 30, padding: '0 12px',
            background: 'var(--success-dim)', color: 'var(--success)',
            borderRadius: 6, border: '0.5px solid rgba(34,197,94,0.20)',
            fontSize: 12, cursor: 'pointer',
            transition: 'opacity 100ms',
          }}
        >
          Generate Stripe Link
        </button>
        <button
          onClick={() => setExpanded(true)}
          style={{
            height: 30, padding: '0 12px',
            background: 'transparent', color: 'var(--text-secondary)',
            borderRadius: 6, border: '0.5px solid var(--border)',
            fontSize: 12, cursor: 'pointer',
          }}
        >
          Reschedule
        </button>
        {stripeMsg && (
          <span style={{ fontSize: 11, color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>
            {stripeMsg}
          </span>
        )}
      </div>

      {expanded && (
        <div className="border-t border-[var(--border)] px-4 py-4 space-y-4">

          {/* Contact info */}
          <div className="flex gap-4 text-sm flex-wrap">
            {lead.phone && (
              <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                <Phone size={13} /> {lead.phone}
              </a>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                <Mail size={13} /> {lead.email}
              </a>
            )}
          </div>

          {/* Pain points */}
          {lead.pain_points && (
            <div className="bg-[var(--bg-2)] rounded-lg px-3 py-2.5">
              <p className="section-label mb-1">Pain Points from Rep</p>
              <p className="text-sm text-[var(--text-secondary)]">{lead.pain_points}</p>
            </div>
          )}

          {/* ── AI Stack Analysis ── */}
          <div className="bg-[var(--bg-2)] border border-[var(--border)] rounded-[10px] overflow-hidden">
            {/* Section header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border)]">
              <Zap size={13} className="text-[var(--accent)]" />
              <p className="text-xs font-medium text-[var(--text-primary)]">AI Stack Recommendation</p>
              {stackLoading && <Loader2 size={12} className="animate-spin text-[var(--text-muted)] ml-auto" />}
            </div>

            <div className="px-3 py-3 space-y-3">
              {stackLoading && !stackAnalysis ? (
                /* Loading skeleton */
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-3 bg-[var(--bg-3)] rounded animate-pulse" style={{ width: `${70 + i * 8}%` }} />
                  ))}
                </div>
              ) : stackAnalysis ? (
                <>
                  {/* Tier recommendation */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="section-label mb-1">Recommended Tier</p>
                      <div className="flex items-baseline gap-2">
                        <span className={`text-lg font-medium tracking-tight ${TIER_COLORS[stackAnalysis.tier] || 'text-[var(--accent)]'}`}>
                          {stackAnalysis.tier}
                        </span>
                        <span className="text-sm text-[var(--text-muted)]">${stackAnalysis.price?.toLocaleString()}/month</span>
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded-sm text-xs font-medium ${TIER_STYLES[stackAnalysis.tier] || TIER_STYLES['Growth']}`}>
                      {stackAnalysis.tier}
                    </span>
                  </div>

                  {/* Why */}
                  {stackAnalysis.why?.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <TrendingUp size={11} className="text-[var(--text-muted)]" />
                        <p className="section-label">Why</p>
                      </div>
                      <ul className="space-y-1">
                        {stackAnalysis.why.map((reason, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
                            <span className="text-[var(--accent)] mt-0.5 flex-shrink-0">·</span>
                            {reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* What to pitch first */}
                  {stackAnalysis.pitch_first && (
                    <div className="bg-[var(--accent-subtle)] border border-[var(--accent)]/15 rounded-lg px-3 py-2.5">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Target size={11} className="text-[var(--accent)]" />
                        <p className="text-xs font-medium text-[var(--accent)]">Lead with this</p>
                      </div>
                      <p className="text-sm text-[var(--text-primary)] font-medium leading-snug">
                        {stackAnalysis.pitch_first}
                      </p>
                    </div>
                  )}

                  {/* Objection prep */}
                  {stackAnalysis.objection && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <MessageSquare size={11} className="text-[var(--text-muted)]" />
                        <p className="section-label">Prepare for this objection</p>
                      </div>
                      <div className="space-y-1.5">
                        <div className="bg-[var(--bg-3)] rounded-lg px-3 py-2">
                          <p className="text-xs text-[var(--text-muted)] mb-0.5">They'll say:</p>
                          <p className="text-sm text-[var(--text-secondary)] italic">"{stackAnalysis.objection}"</p>
                        </div>
                        <div className="bg-[#22C55E]/6 border border-[#22C55E]/15 rounded-lg px-3 py-2">
                          <p className="text-xs text-[#22C55E] mb-0.5">Your response:</p>
                          <p className="text-sm text-[var(--text-primary)]">{stackAnalysis.objection_response}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-[var(--text-muted)] italic">Analysis failed to load — expand again to retry</p>
              )}
            </div>
          </div>

          {/* Schedule appointment */}
          <div>
            <p className="section-label mb-2">Appointment Time</p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
              </div>
              <Button variant="secondary" size="sm" onClick={handleSchedule} disabled={!scheduledAt || update.isPending}>
                <Bell size={13} />
                Schedule + Reminders
              </Button>
            </div>
            {appt.scheduled_at && (
              <p className="text-xs text-[var(--text-muted)] mt-1.5 flex items-center gap-1">
                <Bell size={10} /> 3 SMS reminders auto-scheduled (24h, 1h, 10min before)
              </p>
            )}
          </div>

          {/* AI Prep Briefing — always visible, auto-loads on mount */}
          <div style={{
            padding: 12,
            background: 'var(--bg-elevated)',
            borderRadius: 6,
            border: '0.5px solid var(--border)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Sparkles size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>
                AI Briefing
              </span>
              {briefingLoading && <Loader2 size={11} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite', marginLeft: 'auto' }} />}
            </div>
            {briefingLoading && !briefing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[80, 65, 90].map(w => (
                  <div key={w} style={{ height: 10, background: 'var(--bg-overlay)', borderRadius: 4, width: `${w}%`, animation: 'pulse 2s infinite' }} />
                ))}
              </div>
            ) : briefing ? (
              <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{briefing}</p>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Briefing unavailable</p>
                <button
                  onClick={loadBriefing}
                  style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  Retry
                </button>
              </div>
            )}
          </div>

          {/* Outcome */}
          <div>
            <p className="section-label mb-2">Mark Outcome</p>
            <div className="grid grid-cols-2 gap-3">
              <Select value={outcome} onChange={e => setOutcome(e.target.value)}>
                <option value="">Select outcome…</option>
                <option value="closed">Closed</option>
                <option value="lost">Lost</option>
                <option value="no_show">No Show</option>
              </Select>
              {outcome === 'closed' && (
                <Input type="number" value={dealValue} onChange={e => setDealValue(e.target.value)} placeholder="Deal value ($)" />
              )}
            </div>
          </div>

          {outcome && outcome !== 'closed' && (
            <Input value={lossReason} onChange={e => setLossReason(e.target.value)} placeholder="Loss reason — price, timing, not a fit…" />
          )}

          <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Closer notes…" />

          <Button size="sm" onClick={handleComplete} disabled={!outcome || update.isPending}>
            {update.isPending ? 'Saving…' : 'Mark Complete'}
          </Button>
        </div>
      )}
    </div>
  )
}

// helpers
async function cancelReminders(appointmentId) {
  await supabase.functions.invoke('schedule-reminders', {
    body: { appointment_id: appointmentId, cancel_all: true },
  })
}
