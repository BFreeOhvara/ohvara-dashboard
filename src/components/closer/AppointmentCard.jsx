import { useState, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import {
  ChevronDown, ChevronUp, ChevronRight, ChevronLeft, MapPin, Phone, Mail, Sparkles, Loader2,
  Calendar, Bell, Zap, DollarSign, Target, MessageSquare,
  CheckCircle, AlertTriangle, Star, RefreshCw, Globe, Activity, Eye,
  Copy, ExternalLink, X,
} from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Select, Textarea, Input } from '../ui/Input'
import { useUpdateAppointment } from '../../hooks/useAppointments'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { syntheticStatsFor } from '../../lib/syntheticStats'
import { inferTimezoneFromState, zonedTimeToUtcIso, timezoneLabel, formatInTimezone, utcIsoToZonedDatetimeLocal, DEFAULT_TIMEZONE } from '../../lib/timezones'

// Package display config — matches North Star locked pricing.
// services mirror the recommend-stack edge function PACKAGES (Elite itemized in full).
const PACKAGES = {
  basic: {
    name: 'Basic', setup: 297, monthly: 497,
    color: 'var(--info)', dim: 'var(--info-dim)', border: 'rgba(56,189,248,0.20)',
    services: ['AI Receptionist (24/7)', 'Missed Call Text Back'],
  },
  pro: {
    name: 'Pro', setup: 297, monthly: 797,
    color: 'var(--accent)', dim: 'var(--accent-dim)', border: 'var(--accent-border)',
    services: [
      'AI Receptionist (24/7)', 'Missed Call Text Back', 'Review Generation',
      'Lead Follow-Up Automation', 'Appointment Reminders',
    ],
  },
  premium: {
    name: 'Premium', setup: 297, monthly: 1297,
    color: 'var(--success)', dim: 'var(--success-dim)', border: 'rgba(34,197,94,0.20)',
    services: [
      'AI Receptionist (24/7)', 'Missed Call Text Back', 'Review Generation',
      'Lead Follow-Up Automation', 'Appointment Reminders', 'AI Dispatcher', 'SMS Marketing',
    ],
  },
  elite: {
    name: 'Elite', setup: 297, monthly: 1797,
    color: 'var(--warning)', dim: 'var(--warning-dim)', border: 'rgba(245,158,11,0.20)',
    services: [
      'AI Receptionist (24/7)', 'Missed Call Text Back', 'Review Generation',
      'Lead Follow-Up Automation', 'Appointment Reminders', 'AI Dispatcher', 'SMS Marketing',
      'Professional Website', 'Multiple AI agents (up to 5 lines)', 'Priority support',
      'Custom reporting dashboard',
    ],
  },
}

// Itemized checklist shown inside every tier card
function ServiceChecklist({ tier, compact = false }) {
  const p = PACKAGES[tier]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 4 : 6, margin: '10px 0' }}>
      {p.services.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
          <CheckCircle size={compact ? 11 : 12} style={{ color: p.color, flexShrink: 0, marginTop: 2 }} />
          <span style={{ fontSize: compact ? 12 : 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{s}</span>
        </div>
      ))}
    </div>
  )
}

// Front-runner agents (1-2, the headline of the sale) rendered as larger
// "Core Solution" cards; sub-agents (1-5, complement the front-runners)
// rendered smaller underneath as "Supporting Agents." Falls back to the old
// flat recommended_automations list for leads generated before Prompt 10.
function AgentStackList({ rec, primary }) {
  if (rec.front_runners?.length > 0) {
    return (
      <div style={{ margin: '10px 0' }}>
        <p style={{ fontSize: 9, color: primary?.color || 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>
          Core Solution
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: rec.sub_agents?.length > 0 ? 14 : 0 }}>
          {rec.front_runners.map((a, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 9,
              padding: '10px 12px', borderRadius: 8,
              background: 'var(--bg-elevated)', border: `0.5px solid ${primary?.border || 'var(--accent-border)'}`,
            }}>
              <Zap size={14} style={{ color: primary?.color || 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{a.name}</strong>
                {a.description ? ` — ${a.description}` : ''}
              </span>
            </div>
          ))}
        </div>
        {rec.sub_agents?.length > 0 && (
          <>
            <p style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>
              Supporting Agents
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {rec.sub_agents.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                  <CheckCircle size={11} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{a.name}</strong>
                    {a.description ? ` — ${a.description}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  // Legacy fallback — leads recommended before Prompt 10 only have the flat list.
  if (rec.recommended_automations?.length > 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '10px 0' }}>
        {rec.recommended_automations.map((a, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
            <CheckCircle size={12} style={{ color: primary?.color || 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{a.name}</strong>
              {a.description ? ` — ${a.description}` : ''}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return <ServiceChecklist tier={rec.recommended_tier} />
}

export function AppointmentCard({ appt }) {
  const { profile } = useAuth()
  const lead = appt.lead
  // Appointment times are with the CLIENT, so the scheduling input is
  // entered/interpreted in the lead's inferred local timezone; everything
  // displayed is converted to the VIEWING user's own profile.timezone.
  const clientTz = inferTimezoneFromState(lead?.state)
  const viewerTz = profile?.timezone || DEFAULT_TIMEZONE
  const [modalOpen, setModalOpen] = useState(false)
  const [rec, setRec] = useState(null)
  const [recLoading, setRecLoading] = useState(false)
  const [recError, setRecError] = useState(false)
  const [outcome, setOutcome] = useState('')
  const [dealValue, setDealValue] = useState('')
  const [lossReason, setLossReason] = useState('')
  const [notes, setNotes] = useState(appt.closer_notes || '')
  const [scheduledAt, setScheduledAt] = useState(
    utcIsoToZonedDatetimeLocal(appt.scheduled_at, clientTz)
  )
  const [provisionLoading, setProvisionLoading] = useState(false)
  const [provisionResult, setProvisionResult] = useState(null)
  const [lostLoading, setLostLoading] = useState(false)
  const [paymentLink, setPaymentLink] = useState(null)
  const [paymentLinkLoading, setPaymentLinkLoading] = useState(false)
  const [paymentLinkError, setPaymentLinkError] = useState('')
  const [retryProvisionLoading, setRetryProvisionLoading] = useState(false)
  const update = useUpdateAppointment()
  const qc = useQueryClient()

  // Auto-load recommendation on mount.
  // Use full cached rec if the rep's booking trigger already generated it.
  useEffect(() => {
    if (!lead) return
    if (lead.recommended_stack && lead.custom_monthly_price) {
      setRec(lead.recommended_stack)
      return
    }
    if (!rec && !recLoading) loadRecommendation()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Background scroll lock while the detail modal is open (same pattern as CallModal).
  useEffect(() => {
    if (!modalOpen) return
    const prevBody = document.body.style.overflow
    const prevHtml = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevBody
      document.documentElement.style.overflow = prevHtml
    }
  }, [modalOpen])

  async function loadRecommendation() {
    setRecLoading(true)
    setRecError(false)
    try {
      const { data, error } = await supabase.functions.invoke('recommend-stack', {
        body: {
          businessName:       lead.business_name,
          niche:              lead.niche,
          location:           lead.city ? `${lead.city}${lead.state ? ', ' + lead.state : ''}` : null,
          monthlyLaborCost:   lead.monthly_labor_cost ?? null,
          callsMissedPerWeek: lead.calls_missed_per_week ?? null,
          avgTicket:          lead.avg_ticket ?? null,
          repNotes:           lead.notes || lead.pain_points,
          jobTitle:           lead.job_title,
          closerName:         profile?.full_name,
          primaryPain:        lead.primary_pain ?? null,
          currentSetup:       lead.current_setup ?? null,
        },
      })
      if (error || !data?.rec) throw new Error(error?.message || 'No recommendation returned')
      setRec(data.rec)
    } catch (err) {
      console.error('[AppointmentCard] recommend-stack failed:', err)
      setRecError(true)
    } finally {
      setRecLoading(false)
    }
  }

  async function handleMarkClosed(tier) {
    if (provisionLoading) return
    setProvisionLoading(true)
    try {
        const { data, error } = await supabase.functions.invoke('provision-client', {
        body: {
          appointmentId: appt.id,
          tier,
          closerId: profile?.id,
          businessName: lead.business_name,
          niche: lead.niche,
          location: lead.city,
          monthlyLaborCost: lead.monthly_labor_cost,
          recommendedTier: rec?.recommended_tier || null,
          recommendedPrice: rec?.custom_monthly_price ?? (rec?.recommended_tier ? PACKAGES[rec.recommended_tier]?.monthly ?? null : null),
          clientEmail: lead.email || null,
        },
      })
      if (error) throw new Error(error.message)
      setProvisionResult(data)
    } catch (err) {
      console.error('[AppointmentCard] provision-client failed:', err)
      // Fallback: at least mark closed in appointments table
      await update.mutateAsync({
        appointmentId: appt.id,
        updates: { status: 'completed', outcome: 'closed', closer_notes: notes || undefined },
      })
    } finally {
      setProvisionLoading(false)
    }
  }

  // Real Stripe Checkout Session at the actual custom price — one combined
  // session (recurring monthly + one-time setup line item), not the old
  // static fixed-tier payment links. Only callable once a demo client exists
  // (Prompt 7) since that's the clientId the session gets tagged with.
  async function handleGeneratePaymentLink() {
    if (paymentLinkLoading || !appt.demo_client_id) return
    setPaymentLinkLoading(true)
    setPaymentLinkError('')
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: {
          clientId: appt.demo_client_id,
          businessName: lead.business_name,
          monthlyPrice: rec?.custom_monthly_price,
          setupFee: 297,
          customerEmail: lead.email || undefined,
        },
      })
      if (error || !data?.checkoutUrl) throw new Error(error?.message || data?.error || 'No checkout URL returned')
      setPaymentLink(data.checkoutUrl)
    } catch (err) {
      console.error('[AppointmentCard] create-checkout-session failed:', err)
      setPaymentLinkError(err.message || 'Failed to generate payment link')
    } finally {
      setPaymentLinkLoading(false)
    }
  }

  // Manual reprovision for appointments that were booked before Prompt 7 shipped
  // (provision-demo-client was never called) or where the fire-and-forget silently failed.
  // On success, invalidates the appointments query so the parent re-renders with
  // the populated demo_client_id and the "Open Client Dashboard" button appears.
  async function handleRetryProvision() {
    if (retryProvisionLoading || !rec) return
    setRetryProvisionLoading(true)
    try {
      await supabase.functions.invoke('provision-demo-client', {
        body: {
          appointmentId: appt.id,
          leadId: lead.id,
          businessName: lead.business_name,
          niche: lead.niche,
          location: lead.city || null,
          customMonthlyPrice: rec.custom_monthly_price ?? null,
          recommendedAutomations: rec.recommended_automations ?? null,
          frontRunnerAgents: rec.front_runners ?? null,
          subAgents: rec.sub_agents ?? null,
        },
      })
      qc.invalidateQueries({ queryKey: ['appointments'] })
    } catch (err) {
      console.error('[AppointmentCard] retry provision-demo-client failed:', err)
    } finally {
      setRetryProvisionLoading(false)
    }
  }

  async function handleSchedule() {
    if (!scheduledAt) return
    // scheduledAt is entered in the client's local time (clientTz), same
    // convention as the setter's original booking — not Nate's own browser tz.
    const iso = zonedTimeToUtcIso(scheduledAt, clientTz)
    await update.mutateAsync({
      appointmentId: appt.id,
      updates: { scheduled_at: iso, status: 'pending' },
    })
    await supabase.functions.invoke('schedule-reminders', {
      body: { appointment_id: appt.id, scheduled_at: iso, lead_phone: lead.phone, contact_name: lead.contact_name },
    })
  }

  async function handleComplete() {
    if (!outcome) return
    await update.mutateAsync({
      appointmentId: appt.id,
      updates: {
        status: 'completed',
        outcome,
        deal_value: outcome === 'closed' ? parseFloat(dealValue) || null : null,
        loss_reason: outcome !== 'closed' ? lossReason : null,
        closer_notes: notes,
      },
    })
    if (outcome === 'no_show' || outcome === 'lost') {
      await supabase.functions.invoke('schedule-reminders', {
        body: { appointment_id: appt.id, cancel_all: true },
      })
    }
    // Prompt 8: marking a deal lost deletes its demo client account (real
    // auth.users delete needs the service role, not available client-side) —
    // no-ops if there was never a demo account for this appointment.
    if (outcome === 'lost' && appt.demo_client_id) {
      setLostLoading(true)
      try {
        await supabase.functions.invoke('cleanup-lost-demo', { body: { appointmentId: appt.id } })
      } catch (err) {
        console.error('[AppointmentCard] cleanup-lost-demo failed:', err)
      } finally {
        setLostLoading(false)
      }
    }
  }

  const isClosed = appt.status === 'completed' && appt.outcome === 'closed'

  // RLS can hide the lead row (closer sees leads only when assigned_closer_id matches).
  // Render a quiet placeholder instead of crashing the whole appointment queue.
  if (!lead) {
    return (
      <div className="glass" style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
        Appointment {appt.id?.slice(0, 8)} — lead not visible to this account
      </div>
    )
  }

  return (
    <>
      {/* ── Card — collapsed by default; click anywhere on the row to open details (Prompt 11) ── */}
      <div
        className="glass"
        style={{ overflow: 'hidden', marginBottom: 0, cursor: 'pointer' }}
        onClick={() => setModalOpen(true)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                {lead.business_name}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 3, flexWrap: 'wrap' }}>
              {lead.niche && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{lead.niche}</span>
              )}
              {lead.city && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                  <MapPin size={10} /> {lead.city}
                </span>
              )}
              {lead.google_rating != null && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: 'var(--text-muted)' }}>
                  <Star size={10} style={{ color: 'var(--warning)' }} fill="var(--warning)" />
                  {lead.google_rating}{lead.google_review_count != null ? ` · ${lead.google_review_count} reviews` : ''}
                </span>
              )}
              {lead.has_website != null && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: 'var(--text-muted)' }}>
                  <Globe size={10} /> {lead.has_website ? 'Has website' : 'No website'}
                </span>
              )}
              {appt.rep && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Set by {appt.rep.full_name}</span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {appt.scheduled_at && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                <Calendar size={11} />
                {formatInTimezone(appt.scheduled_at, viewerTz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
            <Badge label={appt.status} />
            <ChevronRight size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </div>
        </div>
      </div>

      {/* ── Detail Modal — popup overlay instead of inline expand (Prompt 11) ───── */}
      {modalOpen && createPortal(
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(8,8,16,0.85)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
          onClick={e => e.stopPropagation() /* click-outside does NOT close — exit via X, same convention as CallModal */}
        >
          <div style={{
            width: '100%', maxWidth: 720, maxHeight: '88vh',
            display: 'flex', flexDirection: 'column',
            background: '#0E0E1A',
            border: '0.5px solid var(--border)',
            borderRadius: 14,
            overflow: 'hidden',
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          }}>

            {/* Modal Header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 18px',
              borderBottom: '0.5px solid var(--border)',
              flexShrink: 0,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {lead.business_name}
                </p>
                {lead.niche && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>{lead.niche}</p>
                )}
              </div>
              <Badge label={appt.status} />
              <button
                onClick={() => setModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 8 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="scrollbar-thin" style={{ flex: 1, overflowY: 'auto' }}>

          {/* Contact row */}
          {(lead.phone || lead.email) && (
            <div style={{ display: 'flex', gap: 16, padding: '10px 16px', borderBottom: '0.5px solid var(--border)' }}>
              {lead.phone && (
                <a href={`tel:${lead.phone}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'none' }}>
                  <Phone size={13} /> {lead.phone}
                </a>
              )}
              {lead.email && (
                <a href={`mailto:${lead.email}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'none' }}>
                  <Mail size={13} /> {lead.email}
                </a>
              )}
            </div>
          )}

          {/* ── Closer Notes + Outcome — ABOVE packages: capture the call, then pick the tier ── */}
          <div style={{ padding: '16px 16px 0' }}>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Closer notes…" />
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <Select value={outcome} onChange={e => setOutcome(e.target.value)} style={{ flex: 1, height: 38 }}>
                <option value="">Mark outcome…</option>
                <option value="closed">Closed</option>
                <option value="lost">Lost</option>
                <option value="no_show">No Show</option>
              </Select>
              <Button size="sm" onClick={handleComplete} disabled={!outcome || update.isPending || lostLoading} style={{ flexShrink: 0 }}>
                {update.isPending ? 'Saving…' : lostLoading ? 'Cleaning up demo…' : 'Save Outcome'}
              </Button>
            </div>
            {outcome === 'closed' && (
              <Input type="number" value={dealValue} onChange={e => setDealValue(e.target.value)} placeholder="Deal value ($)" style={{ marginTop: 8, width: '100%' }} />
            )}
            {outcome && outcome !== 'closed' && (
              <Input value={lossReason} onChange={e => setLossReason(e.target.value)} placeholder="Loss reason…" style={{ marginTop: 8, width: '100%' }} />
            )}
          </div>

          {/* ── AI RECOMMENDATION PANEL — DOMINANT ───────────────────────── */}
          <div style={{ padding: '16px 16px 0' }}>
            {recLoading && !rec ? (
              <div className="glass-accent" style={{ padding: 20, borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <Loader2 size={14} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
                  <span style={{ fontSize: 12, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>
                    AI Analyzing…
                  </span>
                </div>
                {[90, 70, 80, 65].map((w, i) => (
                  <div key={i} style={{ height: 10, background: 'var(--bg-elevated)', borderRadius: 4, width: `${w}%`, marginBottom: 10, animation: 'pulse 2s infinite' }} />
                ))}
              </div>
            ) : recError ? (
              <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--danger-dim)', border: '0.5px solid rgba(239,68,68,0.20)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <AlertTriangle size={14} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--danger)' }}>AI recommendation failed.</span>
                <button onClick={loadRecommendation} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto' }}>
                  Retry
                </button>
              </div>
            ) : rec ? (
              <RecommendationPanel
                rec={rec}
                lead={lead}
                appt={appt}
                isClosed={isClosed}
                provisionLoading={provisionLoading}
                provisionResult={provisionResult}
                paymentLink={paymentLink}
                paymentLinkLoading={paymentLinkLoading}
                paymentLinkError={paymentLinkError}
                retryProvisionLoading={retryProvisionLoading}
                onMarkClosed={handleMarkClosed}
                onGeneratePaymentLink={handleGeneratePaymentLink}
                onRetryProvision={handleRetryProvision}
              />
            ) : null}
          </div>

          {/* ── Schedule + Reminders ─────────────────────────────────────────── */}
          <div style={{ padding: '16px 16px 0' }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, marginBottom: 8 }}>
              Appointment Time — {timezoneLabel(clientTz)} (client's local time)
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
              </div>
              <Button variant="secondary" size="sm" onClick={handleSchedule} disabled={!scheduledAt || update.isPending}>
                <Bell size={13} />
                Schedule + Reminders
              </Button>
            </div>
            {appt.scheduled_at && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Bell size={10} /> 3 SMS reminders auto-scheduled (24h, 1h, 10min before)
              </p>
            )}
          </div>

          {/* bottom padding under the package cards */}
          <div style={{ height: 16 }} />
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

// ── Presentation Walk — click-through presentation for Nate ──────────────────
// Replaces the static scrolling AI Recommendation panel. One step at a time:
// Intro (problem / ROI / price) → front-runner agents → sub-agents → Live Preview.
// Each step is a full-screen card with Back / Next navigation; agent steps show
// customer_benefit (benefit-framed language) if available, else description.

function PresentationWalk({ rec, appt, primary }) {
  const steps = useMemo(() => {
    const s = [{ kind: 'intro' }]
    let tpIdx = 0
    const hasSplit = (rec.front_runners?.length > 0 || rec.sub_agents?.length > 0)
    if (hasSplit) {
      for (const agent of (rec.front_runners || [])) {
        s.push({ kind: 'agent', tier: 'front', agent, talkingPoint: (rec.talking_points || [])[tpIdx++] || null })
      }
      for (const agent of (rec.sub_agents || [])) {
        s.push({ kind: 'agent', tier: 'sub', agent, talkingPoint: (rec.talking_points || [])[tpIdx++] || null })
      }
    } else {
      // Legacy flat list — treat first 2 as front-runners, rest as sub-agents.
      for (const [i, agent] of (rec.recommended_automations || []).entries()) {
        s.push({ kind: 'agent', tier: i < 2 ? 'front' : 'sub', agent, talkingPoint: (rec.talking_points || [])[tpIdx++] || null })
      }
    }
    s.push({ kind: 'dashboard' })
    return s
  }, [rec])

  const [idx, setIdx] = useState(0)
  const step = steps[idx]
  const progress = Math.round(((idx + 1) / steps.length) * 100)
  const stepAccent = step.kind === 'intro' ? 'var(--warning)'
    : step.kind === 'dashboard' ? 'var(--success)'
    : step.tier === 'front' ? (primary?.color || 'var(--accent)')
    : 'var(--text-muted)'
  const stepLabel = step.kind === 'intro' ? 'The Problem'
    : step.kind === 'dashboard' ? 'Live Preview'
    : step.tier === 'front' ? 'Core Solution'
    : 'Supporting Agent'

  return (
    <div className="glass-accent" style={{
      borderRadius: 10, marginBottom: 12, overflow: 'hidden',
      borderTop: `2px solid ${primary?.color || 'var(--accent)'}`,
    }}>
      {/* Header */}
      <div style={{ padding: '12px 16px 10px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '0.5px solid var(--border)' }}>
        <Zap size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, flex: 1 }}>
          AI Recommendation
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {idx + 1} / {steps.length}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 2, background: 'var(--bg-elevated)' }}>
        <div style={{ height: '100%', width: `${progress}%`, background: primary?.color || 'var(--accent)', transition: 'width 0.2s ease' }} />
      </div>

      {/* Step content */}
      <div style={{ padding: '16px 18px 12px' }}>
        <p style={{ fontSize: 9, color: stepAccent, textTransform: 'uppercase', letterSpacing: '0.09em', fontWeight: 500, margin: '0 0 12px' }}>
          {stepLabel}
        </p>
        {step.kind === 'intro' && <WalkIntroStep rec={rec} primary={primary} />}
        {step.kind === 'agent' && <WalkAgentStep agent={step.agent} tier={step.tier} primary={primary} talkingPoint={step.talkingPoint} />}
        {step.kind === 'dashboard' && (
          <WalkDashboardStep appt={appt} rec={rec} />
        )}
      </div>

      {/* Navigation */}
      <div style={{ padding: '0 18px 14px', display: 'flex', gap: 8 }}>
        <button
          onClick={() => setIdx(i => i - 1)}
          disabled={idx === 0}
          style={{
            height: 38, paddingInline: 14, display: 'flex', alignItems: 'center', gap: 5,
            background: 'var(--bg-elevated)', color: idx > 0 ? 'var(--text-secondary)' : 'var(--text-muted)',
            border: '0.5px solid var(--border)', borderRadius: 8, fontSize: 13,
            cursor: idx > 0 ? 'pointer' : 'not-allowed', opacity: idx > 0 ? 1 : 0.4,
          }}
        >
          <ChevronLeft size={14} /> Back
        </button>
        {idx < steps.length - 1 && (
          <button
            onClick={() => setIdx(i => i + 1)}
            style={{
              flex: 1, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              background: primary?.color || 'var(--accent)', color: '#0E0E1A',
              border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}
          >
            Next <ChevronRight size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

function WalkIntroStep({ rec, primary }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rec.headline && (
        <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.4, margin: 0 }}>
          "{rec.headline}"
        </p>
      )}
      {rec.roi_argument && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', background: 'rgba(34,197,94,0.06)', border: '0.5px solid rgba(34,197,94,0.15)', borderRadius: 8 }}>
          <DollarSign size={12} style={{ color: 'var(--success)', marginTop: 2, flexShrink: 0 }} />
          <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>{rec.roi_argument}</p>
        </div>
      )}
      {rec.pain_points?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {rec.pain_points.map((pt, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 3, fontSize: 10 }}>•</span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{pt}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 26, fontWeight: 500, color: primary?.color || 'var(--accent)', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
          ${(rec.custom_monthly_price)?.toLocaleString()}/mo
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          + $297 setup
        </span>
      </div>
    </div>
  )
}

function WalkAgentStep({ agent, tier, primary, talkingPoint }) {
  const borderColor = tier === 'front' ? (primary?.border || 'var(--accent-border)') : 'var(--border)'
  const bgColor = tier === 'front' ? (primary?.dim || 'var(--accent-dim)') : 'var(--bg-elevated)'
  const benefit = agent.customer_benefit || agent.description

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 19, fontWeight: 500, color: 'var(--text-primary)', margin: 0, lineHeight: 1.2 }}>
        {agent.name}
      </p>
      {benefit && (
        <div style={{ padding: '12px 14px', borderRadius: 8, background: bgColor, border: `0.5px solid ${borderColor}` }}>
          <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>{benefit}</p>
        </div>
      )}
      {talkingPoint && (
        <div style={{ padding: '9px 12px', background: 'rgba(108,99,255,0.06)', border: '0.5px solid var(--accent-border)', borderRadius: 8 }}>
          <p style={{ fontSize: 9, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 4 }}>What to say</p>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>{talkingPoint}</p>
        </div>
      )}
    </div>
  )
}

// No-auth fake-data preview — keyed to the appointment, fed entirely from the
// already-computed stack recommendation. No real client account, nothing to
// provision, nothing that can fail (see Prompt 18b — supersedes the old
// real-demo-login ClientPreviewCard). Prompt 26: the preview route now lives
// in THIS app (/preview/:appointmentId) — the separate ohvara-client-portal
// repo was abandoned (never pushed, dead remote), so this is a same-origin
// relative link, not a cross-app URL.
function WalkDashboardStep({ appt, rec }) {
  const previewUrl = `/preview/${appt.id}`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 5px', lineHeight: 1.4 }}>
          Show them their dashboard
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
          Open a live preview — let them see what they'd get before they commit.
        </p>
      </div>
      <a
        href={previewUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          height: 44, borderRadius: 8, fontSize: 14, fontWeight: 500,
          background: 'var(--success-dim)', color: 'var(--success)',
          border: '0.5px solid rgba(34,197,94,0.20)', textDecoration: 'none',
        }}
      >
        <ExternalLink size={14} /> Open Dashboard →
      </a>
      {rec.pushback_response && (
        <div style={{ padding: '10px 12px', background: 'rgba(108,99,255,0.06)', border: '0.5px solid var(--accent-border)', borderRadius: 8 }}>
          <p style={{ fontSize: 9, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 4 }}>
            If they push back on price
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>"{rec.pushback_response}"</p>
        </div>
      )}
    </div>
  )
}

// ── Recommendation Panel ───────────────────────────────────────────────────────

function RecommendationPanel({
  rec, lead, appt, isClosed, provisionLoading, provisionResult,
  paymentLink, paymentLinkLoading, paymentLinkError, retryProvisionLoading,
  onMarkClosed, onGeneratePaymentLink, onRetryProvision,
}) {
  const primary = PACKAGES[rec.recommended_tier]

  return (
    <div style={{ marginBottom: 16 }}>

      {/* Click-through presentation walk — replaces the static scrolling panel */}
      <PresentationWalk
        rec={rec}
        appt={appt}
        primary={primary}
      />

      {/* Action buttons — always visible below the walk */}
      {provisionResult ? (
        <div style={{ padding: '12px 14px', background: 'var(--success-dim)', border: '0.5px solid rgba(34,197,94,0.20)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: 13, color: 'var(--success)', fontWeight: 500, margin: 0 }}>
              ${provisionResult.monthlyValue?.toLocaleString()}/mo — Closed!
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Client created · Onboarding link ready · Admin notified
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Real Stripe Checkout Session — gated on a demo account existing */}
          <PaymentLinkRow
            demoReady={!!appt.demo_client_id}
            paymentLink={paymentLink}
            loading={paymentLinkLoading}
            error={paymentLinkError}
            onGenerate={onGeneratePaymentLink}
            onRetryProvision={onRetryProvision}
            retryProvisionLoading={retryProvisionLoading}
          />
          {/* Mark Closed — one custom stack, one price */}
          <button
            onClick={() => onMarkClosed(rec.recommended_tier)}
            disabled={provisionLoading || isClosed}
            style={{
              height: 44, width: '100%',
              background: isClosed ? 'var(--bg-elevated)' : 'var(--accent)',
              color: isClosed ? 'var(--text-muted)' : '#fff',
              border: 'none', borderRadius: 8,
              fontSize: 14, fontWeight: 500, cursor: isClosed ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'all 0.15s',
              boxShadow: isClosed ? 'none' : '0 0 20px rgba(108,99,255,0.3)',
            }}
          >
            {provisionLoading ? (
              <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Provisioning…</>
            ) : isClosed ? (
              <><CheckCircle size={15} /> Already Closed</>
            ) : (
              <><CheckCircle size={15} /> Mark Closed — ${rec.custom_monthly_price?.toLocaleString()}/mo</>
            )}
          </button>
        </div>
      )}

      {/* Lighter alternative — talking point if they push back */}
      {rec.alternative_automations?.length > 0 && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 8 }}>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 6 }}>
            If They Push Back — Lighter Option
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: rec.alternative_reason ? 6 : 0 }}>
            {rec.alternative_automations.map((a, i) => (
              <span key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-surface)', border: '0.5px solid var(--border)', borderRadius: 4, padding: '2px 7px' }}>
                {a.name}
              </span>
            ))}
          </div>
          {rec.alternative_reason && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>{rec.alternative_reason}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sample Dashboard Preview ───────────────────────────────────────────────────
// Shows only the automations in rec.recommended_automations, sample data only,
// clearly labeled. Nate uses this to walk the prospect through the actual
// dashboard they'd get — without needing a live client account.

function SampleDashboard({ rec, lead }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState(0) // 0 = overview, 1-N = automations[n-1]

  const automations = rec.recommended_automations || []
  if (!automations.length) return null
  const frontRunnerNames = new Set((rec.front_runners || []).map(a => a.name))

  const businessName = lead.business_name || 'This Business'
  const callsPerWeek = lead.calls_missed_per_week || 5
  const avgTicket    = lead.avg_ticket || 800
  const recoveredJobs = Math.max(1, Math.round(callsPerWeek * 4.33 * 0.25))
  const estRevenue    = recoveredJobs * avgTicket

  return (
    <div style={{ borderRadius: 10, overflow: 'hidden', border: '0.5px solid rgba(245,158,11,0.25)' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', padding: '10px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'rgba(245,158,11,0.06)', border: 'none', cursor: 'pointer',
          borderBottom: open ? '0.5px solid rgba(245,158,11,0.20)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Eye size={13} style={{ color: 'var(--warning)' }} />
          <span style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 500 }}>
            Preview for {businessName}
          </span>
          <span style={{
            fontSize: 9, padding: '1px 5px', borderRadius: 2,
            background: 'rgba(245,158,11,0.15)', color: 'var(--warning)',
            border: '0.5px solid rgba(245,158,11,0.25)',
            textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500,
          }}>
            Sample Data
          </span>
        </div>
        {open ? <ChevronUp size={13} style={{ color: 'var(--warning)' }} /> : <ChevronDown size={13} style={{ color: 'var(--warning)' }} />}
      </button>

      {open && (
        <div style={{ background: 'rgba(0,0,0,0.15)' }}>
          <div style={{ padding: '7px 14px', background: 'rgba(245,158,11,0.04)', borderBottom: '0.5px solid rgba(245,158,11,0.12)' }}>
            <p style={{ fontSize: 11, color: 'var(--warning)', margin: 0, fontStyle: 'italic' }}>
              Sample data only — shows what the client would see after onboarding. Walk the prospect through this.
            </p>
          </div>

          {/* Tab strip — index-based since automations are free-form (no catalog ids).
              Front-runner agents get a star marker to match the Core Solution / Supporting
              Agents split shown in the AI Recommendation panel above. */}
          <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', overflowX: 'auto' }}>
            {['Overview', ...automations.map(a => a.name)].map((label, idx) => {
              const isFrontRunner = idx > 0 && frontRunnerNames.has(automations[idx - 1].name)
              return (
                <button
                  key={idx}
                  onClick={() => setTab(idx)}
                  style={{
                    padding: '7px 13px', fontSize: 11, border: 'none', cursor: 'pointer',
                    background: 'none', whiteSpace: 'nowrap',
                    display: 'flex', alignItems: 'center', gap: 4,
                    color: tab === idx ? 'var(--accent)' : 'var(--text-muted)',
                    borderBottom: tab === idx ? '2px solid var(--accent)' : '2px solid transparent',
                    fontWeight: tab === idx ? 500 : 400,
                  }}
                >
                  {isFrontRunner && <Star size={9} style={{ color: 'var(--warning)', flexShrink: 0 }} />}
                  {label}
                </button>
              )
            })}
          </div>

          {/* Tab content */}
          <div style={{ padding: '14px 14px' }}>
            {tab === 0
              ? <SampleOverview automations={automations} recoveredJobs={recoveredJobs} estRevenue={estRevenue} callsPerWeek={callsPerWeek} />
              : <SampleAutomationTab automation={automations[tab - 1]} index={tab - 1} />
            }
          </div>
        </div>
      )}
    </div>
  )
}

function SampleOverview({ automations, recoveredJobs, estRevenue, callsPerWeek }) {
  const kpis = [
    { label: 'Calls Captured / Mo',   value: `${Math.round(callsPerWeek * 4.33 * 0.85)}+`, color: 'var(--accent)' },
    { label: 'Jobs Recovered / Mo',   value: `${recoveredJobs}`,                            color: 'var(--success)' },
    { label: 'Est. Revenue Impact',   value: `$${estRevenue.toLocaleString()}+`,             color: 'var(--success)' },
    { label: 'Automations Active',    value: `${automations.length}`,                        color: 'var(--info)' },
  ]
  return (
    <div>
      <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        Combined Impact — Sample Data
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 10 }}>
        {kpis.map((kpi, i) => (
          <div key={i} style={{ padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 8, border: '0.5px solid var(--border)' }}>
            <p style={{ fontSize: 18, fontWeight: 500, color: kpi.color, fontFamily: 'var(--font-mono)', margin: '0 0 2px', fontVariantNumeric: 'tabular-nums' }}>
              {kpi.value}
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>{kpi.label}</p>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
        Based on {callsPerWeek} missed calls/week — industry average 25% recovery. Actual results vary.
      </p>
    </div>
  )
}

function SampleAutomationTab({ automation, index }) {
  if (!automation) return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No sample data available.</p>
  const data = syntheticStatsFor(automation, index)
  return (
    <div>
      {automation.description && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>{automation.description}</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
        {data.kpis.map((kpi, i) => (
          <div key={i} style={{ padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 8, border: '0.5px solid var(--border)' }}>
            <p style={{ fontSize: 16, fontWeight: 500, color: data.color, fontFamily: 'var(--font-mono)', margin: '0 0 2px', fontVariantNumeric: 'tabular-nums' }}>
              {kpi.value}
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>{kpi.label}</p>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
        Recent Activity
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {data.feed.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-elevated)', borderRadius: 6 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: data.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Real Stripe Checkout Session — one combined link (monthly + $297 setup) at
// the lead's actual custom price, not a fixed-tier static link. Needs a demo
// account to exist first (Prompt 7) since the session is tagged to it.
function PaymentLinkRow({ demoReady, paymentLink, loading, error, onGenerate, onRetryProvision, retryProvisionLoading }) {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    if (!paymentLink) return
    try {
      await navigator.clipboard.writeText(paymentLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard permission denied — link is still visible/clickable below
    }
  }

  if (paymentLink) {
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <a
          href={paymentLink}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flex: 1, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            background: 'var(--success-dim)', color: 'var(--success)',
            borderRadius: 6, border: '0.5px solid rgba(34,197,94,0.20)',
            fontSize: 12, textDecoration: 'none', fontFamily: 'var(--font-mono)',
          }}
        >
          Open Payment Link ↗
        </a>
        <button
          onClick={copyLink}
          style={{
            flex: '0 0 110px', height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            border: '0.5px solid var(--border)', borderRadius: 6, fontSize: 12, cursor: 'pointer',
          }}
        >
          {copied ? <><CheckCircle size={12} style={{ color: 'var(--success)' }} /> Copied</> : <><Copy size={12} /> Copy Link</>}
        </button>
      </div>
    )
  }

  return (
    <div>
      <button
        onClick={onGenerate}
        disabled={loading || !demoReady}
        style={{
          width: '100%', height: 36,
          background: 'var(--success-dim)', color: 'var(--success)',
          border: '0.5px solid rgba(34,197,94,0.20)',
          borderRadius: 6, fontSize: 12,
          cursor: loading ? 'wait' : !demoReady ? 'not-allowed' : 'pointer',
          opacity: demoReady ? 1 : 0.5,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          fontFamily: 'var(--font-mono)',
        }}
      >
        {loading ? (
          <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</>
        ) : (
          <>Generate Payment Link</>
        )}
      </button>
      {!demoReady && (
        <button
          onClick={onRetryProvision}
          disabled={retryProvisionLoading}
          style={{
            width: '100%', height: 36, marginTop: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            background: 'var(--bg-elevated)',
            color: retryProvisionLoading ? 'var(--text-muted)' : 'var(--accent)',
            border: `0.5px solid ${retryProvisionLoading ? 'var(--border)' : 'var(--accent-border)'}`,
            borderRadius: 6, fontSize: 12,
            cursor: retryProvisionLoading ? 'wait' : 'pointer',
          }}
        >
          {retryProvisionLoading ? (
            <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Provisioning demo account…</>
          ) : (
            <><RefreshCw size={11} /> Demo account not ready — retry provisioning</>
          )}
        </button>
      )}
      {error && (
        <p style={{ fontSize: 10, color: 'var(--danger)', margin: '4px 0 0' }}>{error}</p>
      )}
    </div>
  )
}
