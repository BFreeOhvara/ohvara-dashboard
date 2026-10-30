import { useState } from 'react'
import { Headset, Check } from 'lucide-react'
import { dutySince } from '../../lib/duty'
import { useAgentDuty } from '../../hooks/useAgentDuty'
import { useAuth } from '../../hooks/useAuth'
import { Switch } from '../ui/Switch'
import { SettingsCard, SettingsChip } from '../agent/AgentUI'

// Goal 7 — Settings → Client contact, agents only. The agent's own Active switch for live
// transfers (agent_duty, migration 174), the same hook as Today's switch, so the two agree.
// It writes only their own row and sends nothing to anyone. Hidden until it answers, and
// while the table isn't there yet (Today says Coming soon instead).
export function DutyCard() {
  const { profile } = useAuth()
  const duty = useAgentDuty()
  const [saved, setSaved] = useState(false)

  if (duty.soon || duty.loading) return null
  const { on, since, failed } = duty

  function flip(next) {
    setSaved(false)
    duty.toggle(next, {
      onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000) },
    })
  }

  return (
    <SettingsCard icon={Headset} title="Live call transfers"
      sub="Turn this on when you can take a live call. Transfers only come to you while you're active."
      right={!failed ? <SettingsChip tone={on ? 'on' : 'off'}>{on ? 'Active' : 'Not active'}</SettingsChip> : null}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 16, borderTop: '1px solid var(--ov-line)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>Active</p>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--ov-mute)' }}>
            {on ? `${since ? `Active since ${dutySince(since, new Date(), profile?.timezone || undefined)}` : 'Active'}. Live calls can come to you.`
              : 'Not active. Live calls are booked on your calendar instead.'}
          </p>
        </div>
        <Switch checked={on} disabled={failed} onChange={flip} label="Active for live call transfers" />
      </div>

      {failed && <p role="alert" style={errText}>Couldn’t load your status. Refresh to try again.</p>}
      {duty.saveFailed && <p role="alert" style={errText}>Couldn’t save that. Try again.</p>}
      {saved && (
        <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600, color: 'var(--ov-st-cancelled)' }}>
          <Check size={15} strokeWidth={2.4} /> Saved
        </span>
      )}
    </SettingsCard>
  )
}

const errText = { margin: 0, fontSize: 13.5, color: 'var(--danger)' }
