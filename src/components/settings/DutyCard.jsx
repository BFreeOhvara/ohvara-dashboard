import { useState } from 'react'
import { Headset, Check } from 'lucide-react'
import { DUTY_LIVE, isDutyMissing } from '../../lib/duty'
import { useMyDuty, useSetMyDuty } from '../../hooks/useAgentDuty'
import { Switch } from '../ui/Switch'
import { SettingsCard, SettingsChip } from '../agent/AgentUI'

// Goal 7 — Settings → Client contact, agents only. The agent's own on-duty
// switch for live transfers (agent_duty, migration 172). It writes only their
// own row and sends nothing to anyone. Hidden behind DUTY_LIVE, and hidden
// when the table isn't there yet.
export function DutyCard() {
  if (!DUTY_LIVE) return null
  return <DutyCardLive />
}

function DutyCardLive() {
  const { data: row, isLoading, error } = useMyDuty()
  const save = useSetMyDuty()
  const [saved, setSaved] = useState(false)

  if (isDutyMissing(error) || isDutyMissing(save.error)) return null
  const on = !!row?.on_duty

  function flip(next) {
    setSaved(false)
    save.mutate(next, {
      onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000) },
    })
  }

  return (
    <SettingsCard icon={Headset} title="On duty for live transfers"
      sub="Turn this on when you can take a live transfer call. Off means none come to you."
      right={!isLoading && !error ? <SettingsChip tone={on ? 'on' : 'off'}>{on ? 'On duty' : 'Off duty'}</SettingsChip> : null}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 16, borderTop: '1px solid var(--ov-line)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>On duty</p>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--ov-mute)' }}>
            {isLoading ? 'Loading…' : on ? 'On. Live transfers can come to you.' : 'Off. No live transfers come to you.'}
          </p>
        </div>
        <Switch checked={on} disabled={isLoading || !!error || save.isPending} onChange={flip} label="On duty for live transfers" />
      </div>

      {error && <p role="alert" style={errText}>Couldn’t load your duty status. Refresh to try again.</p>}
      {save.isError && <p role="alert" style={errText}>Couldn’t save that. Try again.</p>}
      {saved && (
        <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600, color: 'var(--ov-st-cancelled)' }}>
          <Check size={15} strokeWidth={2.4} /> Saved
        </span>
      )}
    </SettingsCard>
  )
}

const errText = { margin: 0, fontSize: 13.5, color: 'var(--danger)' }
