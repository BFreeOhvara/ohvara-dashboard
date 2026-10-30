import { PhoneIncoming } from 'lucide-react'
import { isDutyMissing, dutySince } from '../../lib/duty'
import { useOnDutyAgents } from '../../hooks/useAgentDuty'
import { SettingsCard, SettingsChip, LoadError } from '../agent/AgentUI'
import { DISPLAY } from '../../lib/exportStyles'

// Goal 7 — Admin Overview (desktop and phone): who is on duty for live
// transfers right now, from on_duty_agents() (migration 174). View only.
// Hidden until it answers (no flash while 174 isn't applied) and while the function isn't there.
const note = { margin: 0, fontSize: 14, color: 'var(--ov-mute)' }

export function OnDutyNow() {
  const { data, error, isLoading, refetch } = useOnDutyAgents()
  if (isLoading || isDutyMissing(error)) return null
  const rows = data || []

  return (
    <SettingsCard icon={PhoneIncoming} title="On duty now" gap={12}
      sub="Agents who can take a live transfer right now."
      right={!error ? (
        <SettingsChip tone={rows.length ? 'on' : 'off'}>
          <span style={{ fontFamily: DISPLAY, fontVariantNumeric: 'tabular-nums' }}>{rows.length}</span> on duty
        </SettingsChip>
      ) : null}>
      {error ? <LoadError what="who is on duty" onRetry={refetch} />
        : !rows.length ? <p style={note}>Nobody is on duty</p>
        : (
          <div>
            {rows.map((a, i) => (
              <div key={a.agent_id} style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 12, rowGap: 2,
                padding: '12px 0', borderTop: i ? '1px solid var(--ov-line)' : 'none',
              }}>
                <span style={{ minWidth: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)', overflowWrap: 'anywhere' }}>
                  {a.full_name || a.display_name || 'Unnamed'}
                </span>
                <span style={{ fontSize: 13.5, color: 'var(--ov-mute)' }}>
                  Since <span style={{ fontFamily: DISPLAY, fontVariantNumeric: 'tabular-nums', color: 'var(--ov-mid)' }}>{dutySince(a.since || a.updated_at)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
    </SettingsCard>
  )
}
