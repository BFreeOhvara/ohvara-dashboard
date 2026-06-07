import { useState, useMemo } from 'react'
import { ChevronDown, ChevronUp, MapPin, Phone, Mail, Sparkles, Loader2, Calendar, Bell } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Select, Textarea, Input } from '../ui/Input'
import { useUpdateAppointment } from '../../hooks/useAppointments'
import { supabase } from '../../lib/supabase'
import { recommendStack, buildPitchAnchorTemplate, TIERS } from '../../lib/stackRecommendation'

// Stack tier badge colors
const TIER_STYLES = {
  'Starter':    'bg-blue-900/40 text-blue-300 border border-blue-800',
  'Growth':     'bg-indigo-900/40 text-indigo-300 border border-indigo-800',
  'Full Stack': 'bg-purple-900/40 text-purple-300 border border-purple-800',
}

export function AppointmentCard({ appt }) {
  const [expanded, setExpanded] = useState(false)
  const [outcome, setOutcome] = useState('')
  const [dealValue, setDealValue] = useState('')
  const [lossReason, setLossReason] = useState('')
  const [notes, setNotes] = useState(appt.closer_notes || '')
  const [scheduledAt, setScheduledAt] = useState(
    appt.scheduled_at ? new Date(appt.scheduled_at).toISOString().slice(0, 16) : ''
  )
  const [briefing, setBriefing] = useState(null)
  const [briefingLoading, setBriefingLoading] = useState(false)
  const [pitchAnchor, setPitchAnchor] = useState(null)
  const [pitchLoading, setPitchLoading] = useState(false)
  const update = useUpdateAppointment()
  const lead = appt.lead

  // Run recommendation synchronously — no API call needed
  const recommendation = useMemo(() => recommendStack(lead), [lead])
  const { tier, reasons } = recommendation

  async function loadBriefing() {
    setBriefingLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('generate-ai-script', {
        body: {
          mode: 'briefing',
          lead_id: lead.id,
          business_name: lead.business_name,
          contact_name: lead.contact_name,
          niche: lead.niche,
          city: lead.city,
          pain_points: lead.pain_points,
          notes: lead.notes,
        },
      })
      if (error) throw error
      setBriefing(data.briefing)
    } finally {
      setBriefingLoading(false)
    }
  }

  async function loadPitchAnchor() {
    // Show template immediately while Claude generates the real one
    setPitchAnchor(buildPitchAnchorTemplate(lead, recommendation))
    setPitchLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('generate-ai-script', {
        body: {
          mode: 'pitch_anchor',
          business_name: lead.business_name,
          niche: lead.niche,
          job_title: lead.job_title,
          monthly_labor_cost: lead.monthly_labor_cost,
          pain_points: lead.pain_points,
          recommended_tier: tier.name,
          recommended_price: tier.price,
        },
      })
      if (!error && data?.pitch_anchor) setPitchAnchor(data.pitch_anchor)
    } finally {
      setPitchLoading(false)
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

    // If cancelling/no-show, also cancel pending reminders
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
    // Schedule reminders via Edge Function
    await supabase.functions.invoke('schedule-reminders', {
      body: {
        appointment_id: appt.id,
        scheduled_at: iso,
        lead_phone: lead.phone,
        contact_name: lead.contact_name,
      },
    })
  }

  return (
    <div className="bg-[var(--bg-1)] border border-[var(--border)] rounded-xl overflow-hidden">
      {/* Card header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{lead.business_name}</p>
            {/* Stack recommendation badge — always visible */}
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${TIER_STYLES[tier.name]}`}>
              {tier.name} · ${tier.price.toLocaleString()}/mo
            </span>
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
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 transition-colors"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[var(--border)] px-4 py-4 space-y-4">

          {/* ── Contact info ── */}
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

          {/* ── Pain points ── */}
          {lead.pain_points && (
            <div className="bg-[var(--bg-2)] rounded-lg px-3 py-2.5">
              <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">Pain Points from Rep</p>
              <p className="text-sm text-[var(--text-secondary)]">{lead.pain_points}</p>
            </div>
          )}

          {/* ── Stack Recommendation detail ── */}
          <div className="bg-[var(--bg-2)] rounded-lg px-3 py-2.5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Stack Recommendation</p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded ${TIER_STYLES[tier.name]}`}>{tier.name}</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mb-2">{tier.features}</p>

            {/* Pitch anchor */}
            {!pitchAnchor ? (
              <button
                onClick={loadPitchAnchor}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                Generate pitch anchor →
              </button>
            ) : (
              <div className="flex items-start gap-2">
                <p className="text-sm text-[var(--text-primary)] font-medium leading-snug flex-1">
                  {pitchLoading ? buildPitchAnchorTemplate(lead, recommendation) : pitchAnchor}
                </p>
                {pitchLoading && <Loader2 size={13} className="animate-spin text-indigo-400 flex-shrink-0 mt-0.5" />}
              </div>
            )}

            {/* Scoring reasons */}
            {reasons.length > 0 && (
              <div className="mt-2 pt-2 border-t border-[var(--border)] space-y-0.5">
                {reasons.map((r, i) => (
                  <p key={i} className="text-xs text-[var(--text-muted)]">· {r}</p>
                ))}
              </div>
            )}
          </div>

          {/* ── Schedule appointment ── */}
          <div>
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">Appointment Time</p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={e => setScheduledAt(e.target.value)}
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSchedule}
                disabled={!scheduledAt || update.isPending}
              >
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

          {/* ── AI Prep Briefing ── */}
          <div>
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">Prep Briefing</p>
            {!briefing ? (
              <Button variant="secondary" size="sm" onClick={loadBriefing} disabled={briefingLoading}>
                {briefingLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {briefingLoading ? 'Generating…' : 'Generate Prep Briefing'}
              </Button>
            ) : (
              <div className="bg-[var(--bg-2)] rounded-lg p-3">
                <p className="text-xs font-medium text-indigo-400 mb-2">AI Prep Briefing</p>
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{briefing}</p>
              </div>
            )}
          </div>

          {/* ── Outcome ── */}
          <div>
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">Mark Outcome</p>
            <div className="grid grid-cols-2 gap-3">
              <Select value={outcome} onChange={e => setOutcome(e.target.value)}>
                <option value="">Select outcome…</option>
                <option value="closed">Closed</option>
                <option value="lost">Lost</option>
                <option value="no_show">No Show</option>
              </Select>
              {outcome === 'closed' && (
                <Input
                  type="number"
                  value={dealValue}
                  onChange={e => setDealValue(e.target.value)}
                  placeholder="Deal value ($)"
                />
              )}
            </div>
          </div>

          {outcome && outcome !== 'closed' && (
            <Input
              value={lossReason}
              onChange={e => setLossReason(e.target.value)}
              placeholder="Loss reason — price, timing, not a fit…"
            />
          )}

          <Textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Closer notes…"
          />

          <Button
            size="sm"
            onClick={handleComplete}
            disabled={!outcome || update.isPending}
          >
            {update.isPending ? 'Saving…' : 'Mark Complete'}
          </Button>
        </div>
      )}
    </div>
  )
}

// ---- helpers ----
async function cancelReminders(appointmentId) {
  await supabase.functions.invoke('schedule-reminders', {
    body: { appointment_id: appointmentId, cancel_all: true },
  })
}
