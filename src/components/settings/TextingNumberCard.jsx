import { Smartphone } from 'lucide-react'
import { useRecoveryConfig } from '../../hooks/useRecoveryConfig'
import { SettingsCard, SettingsChip } from '../agent/AgentUI'
import { textingNumberState } from '../../lib/textingNumber'

// Settings → Texting number (agents). Read-only: Ohvara texts every client
// from one shared number, so there is nothing for an agent to set or buy.
// The state comes from the pure helper in lib/textingNumber.js.
export function TextingNumberCard() {
  const { data: config } = useRecoveryConfig()
  const { chip, line } = textingNumberState({ smsLive: !!config?.sms_live, configLoaded: !!config })

  return (
    <SettingsCard icon={Smartphone} title="Texting number"
      sub="One number for every text Ohvara sends your clients."
      right={chip ? <SettingsChip tone={chip === 'Live' ? 'on' : 'off'}>{chip}</SettingsChip> : null}>
      <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ov-soft)', lineHeight: 1.55 }}>{line}</p>
    </SettingsCard>
  )
}
