import { useState } from 'react'
import { MapPin, Phone, Calendar, Star, Globe, ChevronRight } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { useAuth } from '../../hooks/useAuth'
import { formatInTimezone, inferTimezoneFromState, timezoneAbbr, DEFAULT_TIMEZONE } from '../../lib/timezones'
import { CallModal as AppointmentCardModal } from './AppointmentCardModal'

export function AppointmentCard({ appt }) {
  const { profile } = useAuth()
  const lead = appt.lead
  const viewerTz = profile?.timezone || DEFAULT_TIMEZONE
  // Prompt 224: the time shown is the CLIENT's local time (inferred from
  // lead.state — same mechanism CallModal.jsx already uses when a rep books
  // it), explicitly labeled so it's never misread as the viewer's own zone.
  // Nate's own equivalent only shown if it actually differs.
  const clientTz = inferTimezoneFromState(lead?.state)
  const showsViewerEquivalent = lead && clientTz !== viewerTz

  const [modalOpen, setModalOpen] = useState(false)

  if (!lead) {
    return (
      <div className="glass" style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
        Appointment {appt.id?.slice(0, 8)} — lead not visible to this account
      </div>
    )
  }

  return (
    <>
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
              {lead.niche && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{lead.niche}</span>}
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
              {appt.rep && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Set by {appt.rep.full_name}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {appt.scheduled_at && (
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                  <Calendar size={11} />
                  {formatInTimezone(appt.scheduled_at, clientTz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} {timezoneAbbr(clientTz)}
                </span>
                {showsViewerEquivalent && (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    yours: {formatInTimezone(appt.scheduled_at, viewerTz, { hour: 'numeric', minute: '2-digit' })} {timezoneAbbr(viewerTz)}
                  </span>
                )}
              </span>
            )}
            <Badge label={appt.status} />
            <ChevronRight size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </div>
        </div>
      </div>

      {modalOpen && <AppointmentCardModal appt={appt} onClose={() => setModalOpen(false)} />}
    </>
  )
}
