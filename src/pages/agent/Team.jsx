import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import Hierarchy from './Hierarchy'
import { TeamMessages } from '../../components/team/TeamMessages'
import { LiveRoom } from '../../components/team/LiveRoom'
import { Segmented } from '../../components/ui/Segmented'
import { useAuth } from '../../hooks/useAuth'

// Team (Prompt 357) — "Hierarchy" renamed to "Team" and given two new
// sub-tabs. Hierarchy's existing upline/downline/invite-link content is
// unchanged, just nested here instead of standing alone. Messages is a real
// team chat (migration 084 + useTeamChat.js). Meetings was a placeholder
// until Prompt 393 — same hash-deep-link pattern as Settings.jsx
// (/agent/hierarchy#meetings), used by the Live Room "notify team" button.

const TABS = [
  { value: 'hierarchy', label: 'Hierarchy' },
  { value: 'messages', label: 'Messages' },
  { value: 'meetings', label: 'Meetings' },
]

export default function Team() {
  const { profile } = useAuth()
  const { hash } = useLocation()
  const hashTab = TABS.some(t => t.value === hash.slice(1)) ? hash.slice(1) : null
  const [picked, setTab] = useState(null)
  const tab = picked || hashTab || 'hierarchy'

  return (
    <div>
      <Segmented value={tab} onChange={setTab} options={TABS} style={{ marginBottom: 20 }} />

      {tab === 'hierarchy' && <Hierarchy />}

      {tab === 'messages' && (
        // Explicit height: this tab lives inside the normal padded page body
        // (not the full-bleed layout DashboardLayout gives standalone
        // /*/messages routes), so TeamMessages' internal flex:1 panels need
        // a real bounding height to scroll within instead of growing the
        // whole page.
        //
        // Prompt 391: negative side/bottom margins cancel DashboardLayout's
        // main 40px horizontal + 72px bottom padding (both hardcoded inline
        // styles there, not responsive, so this cancels cleanly at every
        // breakpoint) so the box spans edge-to-edge and reaches the true
        // page bottom instead of stopping short of it — height bumped by
        // the same 72px reclaimed from the bottom padding. The Segmented
        // tab row above stays exactly where it was; only this box moves.
        <div style={{
          height: 'calc(100vh - 188px)', minHeight: 480, display: 'flex', flexDirection: 'column',
          marginLeft: -40, marginRight: -40, marginBottom: -72,
        }}>
          <TeamMessages />
        </div>
      )}

      {tab === 'meetings' && <LiveRoom profile={profile} />}
    </div>
  )
}
