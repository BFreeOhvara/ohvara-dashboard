import { useState, useEffect } from 'react'
import {
  ChevronDown, ChevronUp, MapPin, Phone, Mail, Sparkles, Loader2,
  Calendar, Bell, Zap, DollarSign, Target, MessageSquare, TrendingUp,
  CheckCircle, AlertTriangle,
} from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Select, Textarea, Input } from '../ui/Input'
import { useUpdateAppointment } from '../../hooks/useAppointments'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'

// Package display config — matches North Star locked pricing
const PACKAGES = {
  basic:   { name: 'Basic',   setup: 497, monthly: 497,  color: 'var(--info)',    dim: 'var(--info-dim)',    border: 'rgba(56,189,248,0.20)' },
  pro:     { name: 'Pro',     setup: 497, monthly: 797,  color: 'var(--accent)',  dim: 'var(--accent-dim)', border: 'var(--accent-border)' },
  premium: { name: 'Premium', setup: 497, monthly: 1297, color: 'var(--success)', dim: 'var(--success-dim)', border: 'rgba(34,197,94,0.20)' },
  elite:   { name: 'Elite',   setup: 497, monthly: 1797, color: 'var(--warning)', dim: 'var(--warning-dim)', border: 'rgba(245,158,11,0.20)' },
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
  const [stripeLinks, setStripeLinks] = useState({})
  const [stripeLoading, setStripeLoading] = useState({})
  const update = useUpdateAppointment()
  const lead = appt.lead

  // Auto-load recommendation on mount
  useEffect(() => {
    if (!lead) return
    if (!rec && !recLoading) loadRecommendation()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRecommendation() {
    setRecLoading(true)
    setRecError(false)
    try {
      const { data, error } = await supabase.functions.invoke('recommend-stack', {
        body: {
          businessName: lead.business_name,
          niche: lead.niche,
          location: lead.city ? `${lead.city}${lead.state ? ', ' + lead.state : ''}` : null,
          monthlyLaborCost: lead.monthly_labor_cost,
          repNotes: lead.notes || lead.pain_points,
          jobTitle: lead.job_title,
          closerName: profile?.full_name,
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

  async function handleStripeLinks(tier) {
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
      // Fallback — open Stripe dashboard
      const p = PACKAGES[tier]
      window.open(`https://dashboard.stripe.com/payment-links/create`, '_blank', 'noopener')
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

          {/* ── Closer Notes + Outcome ───────────────────────────────────────── */}
          <div style={{ padding: '16px 16px 16px' }}>
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
          </div>
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
  const alt = PACKAGES[rec.alternative_tier]

  // The three alternatives (all packages except the recommended one)
  const allTiers = ['basic', 'pro', 'premium', 'elite']
  const alternatives = allTiers.filter(t => t !== rec.recommended_tier)

  return (
    <div style={{ marginBottom: 16 }}>

      {/* ── Recommended Package — Dominant ─────────────────────────────────── */}
      <div className="glass-accent" style={{ padding: 20, borderRadius: 10, marginBottom: 12 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500 }}>
              AI Recommendation
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

        {/* Package name + price */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontSize: 28, fontWeight: 500, color: primary?.color || 'var(--accent)', letterSpacing: '-0.02em', lineHeight: 1, fontFamily: 'var(--font-mono)' }}>
              {primary?.name}
            </span>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
              $497 setup + ${primary?.monthly?.toLocaleString()}/mo
            </span>
          </div>
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
                <><CheckCircle size={15} /> Mark Closed — {PACKAGES[rec.recommended_tier]?.name} ${PACKAGES[rec.recommended_tier]?.monthly?.toLocaleString()}/mo</>
              )}
            </button>
          </div>
        )}
      </div>

      {/* ── Alternative Packages ───────────────────────────────────────────── */}
      <div>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, marginBottom: 10 }}>
          Alternative Packages
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {alternatives.map(tier => (
            <AlternativePackageCard
              key={tier}
              tier={tier}
              isAlt={tier === rec.alternative_tier}
              altReason={rec.alternative_reason}
              stripeLinks={stripeLinks}
              stripeLoading={stripeLoading}
              onGenerate={onStripeLinks}
              onMarkClosed={onMarkClosed}
              provisionLoading={provisionLoading}
              isClosed={isClosed}
            />
          ))}
        </div>
        {rec.upsell_path && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, fontStyle: 'italic' }}>
            <TrendingUp size={11} style={{ display: 'inline', marginRight: 4, color: 'var(--accent)' }} />
            Upsell: {rec.upsell_path}
          </p>
        )}
      </div>
    </div>
  )
}

function AlternativePackageCard({ tier, isAlt, altReason, stripeLinks, stripeLoading, onGenerate, onMarkClosed, provisionLoading, isClosed }) {
  const p = PACKAGES[tier]
  const [open, setOpen] = useState(false)
  return (
    <div
      className="glass"
      style={{ flex: '1 1 140px', minWidth: 130, padding: 12, borderRadius: 8, cursor: 'pointer' }}
      onClick={() => setOpen(v => !v)}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <PackageBadge tier={tier} />
        {isAlt && <span style={{ fontSize: 9, color: 'var(--warning)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Suggested alt</span>}
      </div>
      <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', marginBottom: 2 }}>
        ${p.monthly.toLocaleString()}/mo
      </p>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: open ? 10 : 0 }}>$497 setup</p>
      {open && (
        <div onClick={e => e.stopPropagation()}>
          {isAlt && altReason && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, fontStyle: 'italic' }}>{altReason}</p>
          )}
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
      )}
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
