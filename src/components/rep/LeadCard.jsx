import { useState } from 'react'
import { MapPin, Phone, Mail, ChevronDown, ChevronUp, Save } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Select, Textarea } from '../ui/Input'
import { CallButton } from './CallButton'
import { useUpdateLeadStatus } from '../../hooks/useLeads'

const STATUSES = ['New', 'Contacted', 'Voicemail', 'No Answer', 'Interested', 'Booked', 'Not Interested']

export function LeadCard({ lead, onScriptOpen }) {
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState(lead.status)
  const [notes, setNotes] = useState(lead.notes || '')
  const [saving, setSaving] = useState(false)
  const updateStatus = useUpdateLeadStatus()

  async function handleSave() {
    setSaving(true)
    await updateStatus.mutateAsync({ leadId: lead.id, status, notes })
    setSaving(false)
  }

  return (
    <div className="bg-[#161b24] border border-[#2a3347] rounded-xl overflow-hidden">
      {/* Main row */}
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-100 truncate">{lead.business_name}</p>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {lead.contact_name && (
              <span className="text-xs text-slate-400">{lead.contact_name}</span>
            )}
            {lead.city && (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <MapPin size={10} /> {lead.city}, {lead.state}
              </span>
            )}
            {lead.niche && (
              <span className="text-xs text-slate-500">{lead.niche}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge label={lead.status} />
          <CallButton
            lead={lead}
            onScriptOpen={() => onScriptOpen(lead)}
            onCallEnd={() => {}}
          />
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-slate-500 hover:text-slate-300 p-1"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-[#2a3347] px-4 py-4 space-y-4">
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
              <p className="text-xs text-slate-500 mb-1">Pain Points</p>
              <p className="text-sm text-slate-300">{lead.pain_points}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Update Status"
              value={status}
              onChange={e => setStatus(e.target.value)}
            >
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>

          <Textarea
            label="Notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Add call notes…"
          />

          <Button
            variant="secondary"
            size="sm"
            onClick={handleSave}
            disabled={saving}
          >
            <Save size={13} />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  )
}
