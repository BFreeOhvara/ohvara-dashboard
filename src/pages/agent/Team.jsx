import { useState } from 'react'
import Hierarchy from './Hierarchy'
import { TeamMessages } from '../../components/team/TeamMessages'
import { ComingSoon } from '../../components/agent/ComingSoon'
import { Segmented } from '../../components/ui/Segmented'

// Team (Prompt 357) — "Hierarchy" renamed to "Team" and given two new
// sub-tabs. Hierarchy's existing upline/downline/invite-link content is
// unchanged, just nested here instead of standing alone. Messages is a real
// team chat (migration 084 + useTeamChat.js); Meetings is a placeholder only
// — an always-on video room was scoped out of this prompt, see LIVE_STATE.

const TABS = [
  { value: 'hierarchy', label: 'Hierarchy' },
  { value: 'messages', label: 'Messages' },
  { value: 'meetings', label: 'Meetings' },
]

export default function Team() {
  const [tab, setTab] = useState('hierarchy')

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

      {tab === 'meetings' && (
        <ComingSoon
          title="Coming soon"
          description="An always-on team room is planned here — join anytime, see who else is in, with a mic/camera toggle. Not built yet."
        />
      )}
    </div>
  )
}
