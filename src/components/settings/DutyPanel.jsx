import { Headset } from 'lucide-react'
import { useMyDuty, useSetMyDuty, isMissingDutyTable } from '../../hooks/useAgentDuty'
import { Switch } from '../ui/Switch'
import { SettingsCard, SettingsChip } from '../agent/AgentUI'

// Settings → Contact. The agent's own on-duty switch for live transfers
// (agent_duty, migration 162). No row means off duty.
export function DutyPanel() {
  const { data: onDuty, isLoading, error } = useMyDuty()
  const save = useSetMyDuty()
  const missing = isMissingDutyTable(error)
  const on = !!onDuty

  return (
    <SettingsCard icon={Headset} title="On duty for live transfers"
      sub="Turn on when you can take a live transfer. Off means no transfers come to you."
      right={!isLoading && !missing ? <SettingsChip tone={on ? 'on' : 'off'}>{on ? 'On duty' : 'Off duty'}</SettingsChip> : null}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 16, borderTop: '1px solid var(--ov-line)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>On duty</p>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--ov-mute)' }}>
            {on ? 'On. Live transfers can come to you.' : 'Off. No live transfers come to you.'}
          </p>
        </div>
        <Switch checked={on} disabled={isLoading || missing || save.isPending} onChange={v => save.mutate(v)} label="On duty" />
      </div>

      {missing && (
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ov-mute)', lineHeight: 1.5 }}>Duty status isn't set up yet.</p>
      )}
      {error && !missing && (
        <p className="ph-err" role="alert" style={{ margin: 0, fontSize: 13.5, color: 'var(--danger)' }}>Couldn't load your duty status. Try again.</p>
      )}
      {save.isError && (
        <p className="ph-err" role="alert" style={{ margin: 0, fontSize: 13.5, color: 'var(--danger)' }}>Couldn't save. Try again.</p>
      )}
    </SettingsCard>
  )
}
