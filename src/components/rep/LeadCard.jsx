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

  // When the closer books the lead, the assign-closer Edge Function fires via DB trigger
  async function handleSave() {
    setSaving(true)
    await updateStatus.mutateAsync({ leadId: lead.id, status, notes })
    setSaving(false)
  }

  return (
    <div className="bg-[var(--bg-1)] border border-[var(--border)] rounded-[10px] overflow-hidden transition-colors hover:border-[var(--bg-3)]">
      {/* Header row — information density over decoration */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">{lead.business_name}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {lead.contact_name && (
              <span className="text-xs text-[var(--text-secondary)]">{lead.contact_name}</span>
            )}
            {lead.city && (
              <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                <MapPin size={9} /> {lead.city}{lead.state && `, ${lead.state}`}
              </span>
            )}
            {lead.niche && (
              <span className="text-xs text-[var(--text-muted)]">{lead.niche}</span>
            )}
          </div>
        </div>

        {/* Actions — primary call button must dominate */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge label={lead.status} />
          <CallButton
            lead={lead}
            onScriptOpen={() => onScriptOpen(lead)}
            onCallEnd={() => {}}
          />
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 transition-colors"
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {/* Expanded — note-taking + status update */}
      {expanded && (
        <div className="border-t border-[var(--border)] px-4 py-4 space-y-3">
          {/* Contact links */}
          <div className="flex gap-4 flex-wrap text-xs">
            {lead.phone && (
              <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                <Phone size={11} /> {lead.phone}
              </a>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                <Mail size={11} /> {lead.email}
              </a>
            )}
          </div>

          {lead.pain_points && (
            <div className="bg-[var(--bg-2)] rounded-lg px-3 py-2">
              <p className="section-label mb-1">Pain Points</p>
              <p className="text-xs text-[var(--text-secondary)]">{lead.pain_points}</p>
            </div>
          )}

          <Select
            label="Status"
            value={status}
            onChange={e => setStatus(e.target.value)}
          >
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>

          <Textarea
            label="Call Notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="What happened on this call?"
          />

          <Button variant="secondary" size="sm" onClick={handleSave} disabled={saving}>
            <Save size={11} />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  )
}
