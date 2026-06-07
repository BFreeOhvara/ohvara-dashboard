import { useState } from 'react'
import { ChevronDown, ChevronUp, MapPin, Phone, Mail, Sparkles, Loader2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Select, Textarea, Input } from '../ui/Input'
import { useUpdateAppointment } from '../../hooks/useAppointments'
import { supabase } from '../../lib/supabase'

export function AppointmentCard({ appt }) {
  const [expanded, setExpanded] = useState(false)
  const [outcome, setOutcome] = useState('')
  const [dealValue, setDealValue] = useState('')
  const [lossReason, setLossReason] = useState('')
  const [notes, setNotes] = useState(appt.closer_notes || '')
  const [briefing, setBriefing] = useState(null)
  const [briefingLoading, setBriefingLoading] = useState(false)
  const update = useUpdateAppointment()
  const lead = appt.lead

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
  }

  return (
    <div className="bg-[#161b24] border border-[#2a3347] rounded-xl overflow-hidden">
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-100 truncate">{lead.business_name}</p>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {lead.contact_name && <span className="text-xs text-slate-400">{lead.contact_name}</span>}
            {lead.city && (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <MapPin size={10} /> {lead.city}
              </span>
            )}
            {appt.rep && <span className="text-xs text-slate-500">Set by {appt.rep.full_name}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {appt.scheduled_at && (
            <span className="text-xs text-slate-400">
              {new Date(appt.scheduled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          <Badge label={appt.status} />
          <button onClick={() => setExpanded(v => !v)} className="text-slate-500 hover:text-slate-300 p-1">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#2a3347] px-4 py-4 space-y-4">
          {/* Lead context */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {lead.phone && (
              <a href={`tel:${lead.phone}`} className="flex items-center gap-2 text-slate-400 hover:text-slate-200">
                <Phone size={13} /> {lead.phone}
              </a>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`} className="flex items-center gap-2 text-slate-400 hover:text-slate-200">
                <Mail size={13} /> {lead.email}
              </a>
            )}
          </div>

          {lead.pain_points && (
            <div>
              <p className="text-xs text-slate-500 mb-1">Pain Points from Rep</p>
              <p className="text-sm text-slate-300">{lead.pain_points}</p>
            </div>
          )}

          {/* AI Briefing */}
          <div>
            {!briefing ? (
              <Button variant="secondary" size="sm" onClick={loadBriefing} disabled={briefingLoading}>
                {briefingLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {briefingLoading ? 'Generating…' : 'Prep Call Briefing'}
              </Button>
            ) : (
              <div className="bg-[#1e2433] rounded-lg p-3">
                <p className="text-xs text-indigo-400 font-medium mb-2">AI Prep Briefing</p>
                <p className="text-sm text-slate-300 whitespace-pre-wrap">{briefing}</p>
              </div>
            )}
          </div>

          {/* Outcome */}
          <div className="grid grid-cols-2 gap-3">
            <Select label="Outcome" value={outcome} onChange={e => setOutcome(e.target.value)}>
              <option value="">Select outcome…</option>
              <option value="closed">Closed</option>
              <option value="lost">Lost</option>
              <option value="no_show">No Show</option>
            </Select>
            {outcome === 'closed' && (
              <Input label="Deal Value ($)" type="number" value={dealValue} onChange={e => setDealValue(e.target.value)} placeholder="0.00" />
            )}
          </div>

          {outcome && outcome !== 'closed' && (
            <Input label="Loss Reason" value={lossReason} onChange={e => setLossReason(e.target.value)} placeholder="Price, timing, not a fit…" />
          )}

          <Textarea label="Closer Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Notes for this appointment…" />

          <Button size="sm" onClick={handleComplete} disabled={!outcome || update.isPending}>
            {update.isPending ? 'Saving…' : 'Mark Complete'}
          </Button>
        </div>
      )}
    </div>
  )
}
