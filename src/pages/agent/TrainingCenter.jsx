import { useState } from 'react'
import { Segmented } from '../../components/ui/Segmented'
import { ComingSoon } from '../../components/agent/ComingSoon'
import { ScriptTab } from '../../components/agent/training/ScriptTab'

// Training Center (Prompt 415) — page shell only. Replaces the standalone
// TrainingPlaceholder that used to sit at /agent/training. Script is real
// (app_settings.training_script, migration 099); Videos and AI Voice
// Roleplay stay "coming soon" until their own prompts build them out — no
// upload/playback or AI-call logic here yet.
const TABS = [
  { value: 'script',   label: 'Script' },
  { value: 'videos',   label: 'Videos' },
  { value: 'roleplay', label: 'AI Voice Roleplay' },
]

export default function TrainingCenter() {
  const [tab, setTab] = useState('script')

  return (
    <div>
      <Segmented value={tab} onChange={setTab} options={TABS} style={{ marginBottom: 20 }} />

      {tab === 'script' && <ScriptTab />}
      {tab === 'videos' && (
        <ComingSoon
          title="Videos"
          description="Onboarding and product videos land here once they're recorded."
        />
      )}
      {tab === 'roleplay' && (
        <ComingSoon
          title="AI Voice Roleplay"
          description="Practice calls with an AI-graded roleplay agent land here."
        />
      )}
    </div>
  )
}
