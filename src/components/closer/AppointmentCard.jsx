import { useState, useEffect } from 'react'
import {
  ChevronDown, ChevronUp, MapPin, Phone, Mail, Sparkles, Loader2,
  Calendar, Bell, Zap, DollarSign, Target, MessageSquare,
  CheckCircle, AlertTriangle, Star, RefreshCw, Globe, Activity, Eye,
} from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Select, Textarea, Input } from '../ui/Input'
import { useUpdateAppointment } from '../../hooks/useAppointments'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'

// Package display config — matches North Star locked pricing.
// services mirror the recommend-stack edge function PACKAGES (Elite itemized in full).
const PACKAGES = {
  basic: {
    name: 'Basic', setup: 497, monthly: 497,
    color: 'var(--info)', dim: 'var(--info-dim)', border: 'rgba(56,189,248,0.20)',
    services: ['AI Receptionist (24/7)', 'Missed Call Text Back'],
  },
  pro: {
    name: 'Pro', setup: 497, monthly: 797,
    color: 'var(--accent)', dim: 'var(--accent-dim)', border: 'var(--accent-border)',
    services: [
      'AI Receptionist (24/7)', 'Missed Call Text Back', 'Review Generation',
      'Lead Follow-Up Automation', 'Appointment Reminders',
    ],
  },
  premium: {
    name: 'Premium', setup: 497, monthly: 1297,
    color: 'var(--success)', dim: 'var(--success-dim)', border: 'rgba(34,197,94,0.20)',
    services: [
      'AI Receptionist (24/7)', 'Missed Call Text Back', 'Review Generation',
      'Lead Follow-Up Automation', 'Appointment Reminders', 'AI Dispatcher', 'SMS Marketing',
    ],
  },
  elite: {
    name: 'Elite', setup: 497, monthly: 1797,
    color: 'var(--warning)', dim: 'var(--warning-dim)', border: 'rgba(245,158,11,0.20)',
    services: [
      'AI Receptionist (24/7)', 'Missed Call Text Back', 'Review Generation',
      'Lead Follow-Up Automation', 'Appointment Reminders', 'AI Dispatcher', 'SMS Marketing',
      'Professional Website', 'Multiple AI agents (up to 5 lines)', 'Priority support',
      'Custom reporting dashboard',
    ],
  },
}

const TIER_ORDER = ['basic', 'pro', 'premium', 'elite']

// Map custom price → closest display tier (for color/name, not billing)
function priceToTier(monthly) {
  if (monthly >= 1500) return 'elite'
  if (monthly >= 1000) return 'premium'
  if (monthly >= 650)  return 'pro'
  return 'basic'
}

// Sample data for the "Preview for [Business Name]" panel — synthetic, clearly labeled.
const SAMPLE_DATA = {
  ai_receptionist: {
    label: 'AI Receptionist', color: 'var(--accent)',
    kpis: [
      { label: 'Calls Answered / Mo', value: '247' },
      { label: 'After-Hours Captured', value: '89' },
      { label: 'Booking Rate', value: '73%' },
    ],
    feed: [
      'New caller booked HVAC inspection — 2 min ago',
      'After-hours call captured, quote requested — 41 min ago',
      '3 calls handled while crew was on job — 2h ago',
    ],
  },
  missed_call_text_back: {
    label: 'Missed Call Text Back', color: 'var(--info)',
    kpis: [
      { label: 'Texts Sent / Mo', value: '31' },
      { label: 'Reply Rate', value: '67%' },
      { label: 'Bookings Recovered', value: '8' },
    ],
    feed: [
      '"Thanks! Can you come Wednesday?" — 8 min ago',
      'Missed caller booked roof inspection — 2h ago',
      '4 texts sent during job rush — Yesterday',
    ],
  },
  review_generation: {
    label: 'Review Generation', color: 'var(--warning)',
    kpis: [
      { label: 'Reviews Generated', value: '12' },
      { label: 'Avg Rating', value: '4.9★' },
      { label: 'Profile Views', value: '+34%' },
    ],
    feed: [
      '5★ "Best in the area!" — 3h ago',
      '5★ "Fast, professional, fair price" — Yesterday',
      '4★ "Would recommend to anyone" — 2 days ago',
    ],
  },
  lead_followup: {
    label: 'Lead Follow-Up', color: 'var(--success)',
    kpis: [
      { label: 'Leads Followed Up', value: '47' },
      { label: 'Recovery Rate', value: '23%' },
      { label: 'Revenue Recovered', value: '$3,200' },
    ],
    feed: [
      '"OK let\'s do it" — week-old lead replied — 1h ago',
      'Ghosted quote → booked after 3rd touch — Yesterday',
      '4 follow-up sequences triggered — 2 days ago',
    ],
  },
  appointment_reminders: {
    label: 'Appointment Reminders', color: 'var(--info)',
    kpis: [
      { label: 'Reminders Sent', value: '89' },
      { label: 'No-Show Rate', value: '-62%' },
      { label: 'Confirmations', value: '91%' },
    ],
    feed: [
      '"See you Thursday at 2pm!" — 10 min ago',
      '24h reminder sent for tomorrow\'s install — 2h ago',
      'Client rescheduled early, crew reallocated — Yesterday',
    ],
  },
  ai_dispatcher: {
    label: 'AI Dispatcher', color: 'var(--accent)',
    kpis: [
      { label: 'Calls Routed / Mo', value: '156' },
      { label: 'Avg Hold Time', value: '< 2s' },
      { label: 'Crew Utilization', value: '+28%' },
    ],
    feed: [
      'Emergency AC → nearest crew routed — 5 min ago',
      'Commercial inquiry → sales line — 1h ago',
      '12 calls auto-routed, 0 manual transfers — Yesterday',
    ],
  },
  sms_marketing: {
    label: 'SMS Marketing', color: 'var(--warning)',
    kpis: [
      { label: 'Open Rate', value: '89%' },
      { label: 'Response Rate', value: '34%' },
      { label: 'Revenue Attributed', value: '$1,800' },
    ],
    feed: [
      '"Summer tune-up" campaign → 8 bookings — 2 days ago',
      'Win-back SMS → 5 past customers returned — 3w ago',
      'Seasonal reminder → 12 jobs booked — 6w ago',
    ],
  },
  website: {
    label: 'Professional Website', color: 'var(--success)',
    kpis: [
      { label: 'Monthly Visitors', value: '847' },
      { label: 'Contact Forms', value: '12' },
      { label: 'Mobile Score', value: '97/100' },
    ],
    feed: [
      'New contact: "Need emergency AC repair" — 4h ago',
      '43 organic visitors from Google — Yesterday',
      'Commercial inquiry via contact form — 2 days ago',
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

function PackageBadge({ tier, size = 'sm' }) {
  const p = PACKAGES[tier]
  if (!p) return null
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: size === 'sm' ? '2px 7px' : '4px 10px',
      borderRadius: 4,
      background: p.dim, color: p.color,
      border: `0.5px solid ${p.border}`,
      fontSize: size === 'sm' ? 11 : 13,
      fontWeight: 500,
    }}>
      {p.name}
    </span>
  )
}

export function AppointmentCard({ appt }) {
  const { profile } = useAuth()
  const [expanded, setExpanded] = useState(true)
  const [rec, setRec] = useState(null)
  const [recLoading, setRecLoading] = useState(false)
  const [recError, setRecError] = useState(false)
  const [outcome, setOutcome] = useState('')
  const [dealValue, setDealValue] = useState('')
  const [lossReason, setLossReason] = useState('')
  const [notes, setNotes] = useState(appt.closer_notes || '')
  const [scheduledAt, setScheduledAt] = useState(
    appt.scheduled_at ? new Date(appt.scheduled_at).toISOString().slice(0, 16) : ''
  )
  const [provisionLoading, setProvisionLoading] = useState(false)
  const [provisionResult, setProvisionResult] = useState(null)
  const [overridePrice, setOverridePrice] = useState('')
  const [stripeLinks, setStripeLinks] = useState({})
  const [stripeLoading, setStripeLoading] = useState({})
  const update = useUpdateAppointment()
  const lead = appt.lead

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

  // Pre-generate Stripe links for ALL 4 tiers so every card is one click from payment.
  // silent=true: a failure just leaves that tier's Generate button as fallback.
  useEffect(() => {
    if (!lead) return
    TIER_ORDER.forEach(tier => handleStripeLinks(tier, { silent: true }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      const parsedOverride = overridePrice ? parseFloat(overridePrice) : null
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
          overridePrice: parsedOverride && parsedOverride > 0 ? parsedOverride : null,
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

  async function handleStripeLinks(tier, { silent = false } = {}) {
    if (stripeLoading[tier]) return
    setStripeLoading(prev => ({ ...prev, [tier]: true }))
    try {
      const { data, error } = await supabase.functions.invoke('generate-stripe-links', {
        body: {
          tier,
          businessName: lead.business_name,
          closerName: profile?.full_name,
          appointmentId: appt.id,
        },
      })
      if (error || !data) throw new Error(error?.message || 'No links returned')
      setStripeLinks(prev => ({ ...prev, [tier]: { setup: data.setupLink, monthly: data.monthlyLink } }))
    } catch {
      // Fallback — open Stripe dashboard, but only on an explicit click
      if (!silent) window.open(`https://dashboard.stripe.com/payment-links/create`, '_blank', 'noopener')
    } finally {
      setStripeLoading(prev => ({ ...prev, [tier]: false }))
    }
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
    <div className="glass" style={{ overflow: 'hidden', marginBottom: 0 }}>

      {/* ── Card Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
              {lead.business_name}
            </span>
            {rec?.recommended_tier && <PackageBadge tier={rec.recommended_tier} />}
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
            {appt.rep && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Set by {appt.rep.full_name}</span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {appt.scheduled_at && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
              <Calendar size={11} />
              {new Date(appt.scheduled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          <Badge label={appt.status} />
          <button
            onClick={() => setExpanded(v => !v)}
            style={{ color: 'var(--text-muted)', background: 'none', border: 'none', padding: 4, cursor: 'pointer', borderRadius: 4, transition: 'color 100ms' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {/* ── Expanded Content ─────────────────────────────────────────────────── */}
      {expanded && (
        <div style={{ borderTop: '0.5px solid var(--border)' }}>

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
            <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <Select value={outcome} onChange={e => setOutcome(e.target.value)} style={{ flex: '1 1 140px' }}>
                <option value="">Mark outcome…</option>
                <option value="closed">Closed</option>
                <option value="lost">Lost</option>
                <option value="no_show">No Show</option>
              </Select>
              {outcome === 'closed' && (
                <Input type="number" value={dealValue} onChange={e => setDealValue(e.target.value)} placeholder="Deal value ($)" style={{ flex: '0 0 140px' }} />
              )}
              {outcome && outcome !== 'closed' && (
                <Input value={lossReason} onChange={e => setLossReason(e.target.value)} placeholder="Loss reason…" style={{ flex: '1 1 180px' }} />
              )}
              <Button size="sm" onClick={handleComplete} disabled={!outcome || update.isPending}>
                {update.isPending ? 'Saving…' : 'Save Outcome'}
              </Button>
            </div>
            {!isClosed && (
              <div style={{ marginTop: 10 }}>
                <Input
                  type="number"
                  value={overridePrice}
                  onChange={e => setOverridePrice(e.target.value)}
                  placeholder="Override monthly price (optional — leave blank to bill list price)"
                  style={{ maxWidth: 320 }}
                />
              </div>
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
                stripeLinks={stripeLinks}
                stripeLoading={stripeLoading}
                onMarkClosed={handleMarkClosed}
                onStripeLinks={handleStripeLinks}
              />
            ) : null}
          </div>

          {/* ── Sample Dashboard Preview ─────────────────────────────────────── */}
          {rec?.recommended_automations?.length > 0 && (
            <div style={{ padding: '0 16px 16px' }}>
              <SampleDashboard rec={rec} lead={lead} />
            </div>
          )}

          {/* ── Schedule + Reminders ─────────────────────────────────────────── */}
          <div style={{ padding: '16px 16px 0' }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, marginBottom: 8 }}>
              Appointment Time
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
      )}
    </div>
  )
}

// ── Recommendation Panel ───────────────────────────────────────────────────────

function RecommendationPanel({
  rec, lead, appt, isClosed, provisionLoading, provisionResult,
  stripeLinks, stripeLoading, onMarkClosed, onStripeLinks,
}) {
  const primary = PACKAGES[rec.recommended_tier]

  // Directional ordering: recommended first, then nearest tier above (upsell),
  // nearest tier below (fallback), then the remaining tiers by distance.
  const rIdx = TIER_ORDER.indexOf(rec.recommended_tier)
  const above = TIER_ORDER.slice(rIdx + 1)                 // higher tiers, nearest first
  const below = TIER_ORDER.slice(0, rIdx).reverse()        // lower tiers, nearest first
  const orderedAlternatives = [
    ...(above[0] ? [{ tier: above[0], label: '⬆️ Upsell Option', direction: 'up' }] : []),
    ...(below[0] ? [{ tier: below[0], label: '⬇️ Fallback Option', direction: 'down' }] : []),
    ...above.slice(1).map(t => ({ tier: t, label: '⬆️ Top-Tier Upsell', direction: 'up' })),
    ...below.slice(1).map(t => ({ tier: t, label: '⬇️ Budget Option', direction: 'down' })),
  ]

  // One-sentence fit reason per alternative card
  function reasonFor(tier, direction) {
    if (tier === rec.alternative_tier && rec.alternative_reason) return rec.alternative_reason
    if (direction === 'up') {
      return (tier === 'elite' && rec.upsell_path)
        ? rec.upsell_path
        : 'Pitch this if they mention multiple locations, crews, or want the full package.'
    }
    return 'Offer this if they hesitate on price — still solves their core problem.'
  }

  return (
    <div style={{ marginBottom: 16 }}>

      {/* ── Recommended Package — Dominant ─────────────────────────────────── */}
      <div className="glass-accent" style={{
        padding: 20, borderRadius: 10, marginBottom: 12,
        borderTop: `2px solid ${primary?.color || 'var(--accent)'}`,
        boxShadow: '0 0 0 1px var(--accent-border), 0 0 24px rgba(108,99,255,0.18)',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>
              AI Recommendation
            </span>
            <span style={{
              fontSize: 10, padding: '2px 7px', borderRadius: 3,
              background: 'var(--accent)', color: '#fff',
              fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>
              Recommended
            </span>
          </div>
          <span style={{
            fontSize: 10, padding: '2px 6px', borderRadius: 3,
            background: rec.confidence === 'high' ? 'var(--success-dim)' : 'var(--warning-dim)',
            color: rec.confidence === 'high' ? 'var(--success)' : 'var(--warning)',
            border: `0.5px solid ${rec.confidence === 'high' ? 'rgba(34,197,94,0.20)' : 'rgba(245,158,11,0.20)'}`,
            fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {rec.confidence} confidence
          </span>
        </div>

        {/* Custom price + automation list */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 30, fontWeight: 500, color: primary?.color || 'var(--accent)', letterSpacing: '-0.02em', lineHeight: 1, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
              ${(rec.custom_monthly_price || primary?.monthly)?.toLocaleString()}/mo
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              + $497 setup
            </span>
            {rec.custom_monthly_price && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: 3 }}>
                Custom stack · {primary?.name} tier
              </span>
            )}
          </div>
          {/* Show selected automations if available, else tier services */}
          {rec.recommended_automations?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, margin: '10px 0' }}>
              {rec.recommended_automations.map((id, i) => {
                const data = SAMPLE_DATA[id]
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <CheckCircle size={12} style={{ color: primary?.color || 'var(--accent)', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{data?.label || id}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <ServiceChecklist tier={rec.recommended_tier} />
          )}
          {rec.headline && (
            <p style={{ fontSize: 14, color: 'var(--text-primary)', marginTop: 8, lineHeight: 1.4, fontWeight: 500 }}>
              "{rec.headline}"
            </p>
          )}
        </div>

        {/* ROI Argument */}
        {rec.roi_argument && (
          <div style={{ padding: '10px 14px', background: 'rgba(34,197,94,0.06)', border: '0.5px solid rgba(34,197,94,0.15)', borderRadius: 8, marginBottom: 14, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <DollarSign size={13} style={{ color: 'var(--success)', marginTop: 2, flexShrink: 0 }} />
            <div>
              <p style={{ fontSize: 10, color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 4 }}>ROI Argument</p>
              <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>{rec.roi_argument}</p>
            </div>
          </div>
        )}

        {/* Pain Points */}
        {rec.pain_points?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={11} style={{ color: lead.notes || lead.pain_points ? 'var(--warning)' : 'var(--text-muted)' }} />
              Pain Points {!(lead.notes || lead.pain_points) && <span style={{ color: 'var(--warning)', fontStyle: 'italic' }}>— no rep notes captured</span>}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {rec.pain_points.map((pt, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2, fontSize: 11 }}>•</span>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{pt}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Why Pitch This */}
        {rec.why_pitch_this && (
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Target size={11} /> Why Pitch This
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>{rec.why_pitch_this}</p>
          </div>
        )}

        {/* Talking Points */}
        {rec.talking_points?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <MessageSquare size={11} /> Talking Points
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rec.talking_points.map((pt, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)', flexShrink: 0, marginTop: 2 }}>{i + 1}.</span>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{pt}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pushback Response */}
        {rec.pushback_response && (
          <div style={{ padding: '10px 14px', background: 'rgba(108,99,255,0.06)', border: '0.5px solid var(--accent-border)', borderRadius: 8, marginBottom: 16 }}>
            <p style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 4 }}>If They Push Back on Price</p>
            <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>"{rec.pushback_response}"</p>
          </div>
        )}

        {/* ── Action Buttons ─────────────────────────────────────────────────── */}
        {provisionResult ? (
          <div style={{ padding: '12px 14px', background: 'var(--success-dim)', border: '0.5px solid rgba(34,197,94,0.20)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
            <div>
              <p style={{ fontSize: 13, color: 'var(--success)', fontWeight: 500, margin: 0 }}>
                {PACKAGES[provisionResult.tier]?.name} · ${provisionResult.monthlyValue?.toLocaleString()}/mo — Closed!
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                Client created · Onboarding link ready · Admin notified
              </p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Stripe links for recommended package */}
            <StripeButtonRow
              tier={rec.recommended_tier}
              stripeLinks={stripeLinks}
              stripeLoading={stripeLoading}
              onGenerate={onStripeLinks}
            />
            {/* Mark Closed */}
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
                <><CheckCircle size={15} /> Mark Closed — ${(rec.custom_monthly_price || PACKAGES[rec.recommended_tier]?.monthly)?.toLocaleString()}/mo</>
              )}
            </button>
          </div>
        )}
      </div>

      {/* ── Alternative Packages — all expanded, directionally ordered ──────── */}
      <div>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, marginBottom: 10 }}>
          Alternative Packages
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {orderedAlternatives.map(({ tier, label, direction }) => (
            <AlternativePackageCard
              key={tier}
              tier={tier}
              directionLabel={label}
              isAlt={tier === rec.alternative_tier}
              reason={reasonFor(tier, direction)}
              stripeLinks={stripeLinks}
              stripeLoading={stripeLoading}
              onGenerate={onStripeLinks}
              onMarkClosed={onMarkClosed}
              provisionLoading={provisionLoading}
              isClosed={isClosed}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// Always-expanded tier card: header (name + price + setup + product count),
// itemized checklist, one-line fit reason, Stripe links, Mark Closed.
function AlternativePackageCard({ tier, directionLabel, isAlt, reason, stripeLinks, stripeLoading, onGenerate, onMarkClosed, provisionLoading, isClosed }) {
  const p = PACKAGES[tier]
  return (
    <div
      className="glass"
      style={{ padding: '14px 16px', borderRadius: 8, borderTop: `2px solid ${p.color}` }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18, fontWeight: 500, color: p.color, fontFamily: 'var(--font-mono)', letterSpacing: '-0.01em' }}>
            {p.name}
          </span>
          <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
            ${p.monthly.toLocaleString()}/mo
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>+ $497 setup</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.services.length} products included</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isAlt && <span style={{ fontSize: 9, color: 'var(--warning)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Suggested alt</span>}
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{directionLabel}</span>
        </div>
      </div>

      <ServiceChecklist tier={tier} compact />

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px', fontStyle: 'italic' }}>{reason}</p>

      <StripeButtonRow tier={tier} stripeLinks={stripeLinks} stripeLoading={stripeLoading} onGenerate={onGenerate} compact />
      <button
        onClick={() => onMarkClosed(tier)}
        disabled={provisionLoading || isClosed}
        style={{
          width: '100%', height: 32, marginTop: 6,
          background: 'var(--accent)', color: '#fff',
          border: 'none', borderRadius: 6, fontSize: 12,
          cursor: isClosed ? 'not-allowed' : 'pointer',
          opacity: isClosed ? 0.5 : 1,
        }}
      >
        {provisionLoading ? 'Closing…' : `Close — ${p.name}`}
      </button>
    </div>
  )
}

// ── Sample Dashboard Preview ───────────────────────────────────────────────────
// Shows only the automations in rec.recommended_automations, sample data only,
// clearly labeled. Nate uses this to walk the prospect through the actual
// dashboard they'd get — without needing a live client account.

function SampleDashboard({ rec, lead }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('overview')

  const automations = rec.recommended_automations || []
  if (!automations.length) return null

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

          {/* Tab strip */}
          <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', overflowX: 'auto' }}>
            {['overview', ...automations].map(id => {
              const label = id === 'overview' ? 'Overview' : (SAMPLE_DATA[id]?.label || id)
              return (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  style={{
                    padding: '7px 13px', fontSize: 11, border: 'none', cursor: 'pointer',
                    background: 'none', whiteSpace: 'nowrap',
                    color: tab === id ? 'var(--accent)' : 'var(--text-muted)',
                    borderBottom: tab === id ? '2px solid var(--accent)' : '2px solid transparent',
                    fontWeight: tab === id ? 500 : 400,
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>

          {/* Tab content */}
          <div style={{ padding: '14px 14px' }}>
            {tab === 'overview'
              ? <SampleOverview automations={automations} recoveredJobs={recoveredJobs} estRevenue={estRevenue} callsPerWeek={callsPerWeek} />
              : <SampleAutomationTab id={tab} />
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

function SampleAutomationTab({ id }) {
  const data = SAMPLE_DATA[id]
  if (!data) return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No sample data available.</p>
  return (
    <div>
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

function StripeButtonRow({ tier, stripeLinks, stripeLoading, onGenerate, compact = false }) {
  const p = PACKAGES[tier]
  const links = stripeLinks[tier]
  const loading = stripeLoading[tier]

  if (links) {
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <a
          href={links.setup}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flex: 1, height: compact ? 30 : 36,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            borderRadius: 6, border: '0.5px solid var(--border)',
            fontSize: compact ? 11 : 12, textDecoration: 'none', fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          $497 Setup ↗
        </a>
        <a
          href={links.monthly}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flex: 1, height: compact ? 30 : 36,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--success-dim)', color: 'var(--success)',
            borderRadius: 6, border: '0.5px solid rgba(34,197,94,0.20)',
            fontSize: compact ? 11 : 12, textDecoration: 'none', fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          ${p.monthly.toLocaleString()}/mo ↗
        </a>
      </div>
    )
  }

  return (
    <button
      onClick={() => onGenerate(tier)}
      disabled={loading}
      style={{
        width: '100%', height: compact ? 30 : 36,
        background: 'var(--success-dim)', color: 'var(--success)',
        border: '0.5px solid rgba(34,197,94,0.20)',
        borderRadius: 6, fontSize: compact ? 11 : 12,
        cursor: loading ? 'wait' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {loading ? (
        <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</>
      ) : (
        <>Generate $497 + ${p.monthly.toLocaleString()}/mo Links</>
      )}
    </button>
  )
}
