import { useState } from 'react'
import { Segmented } from '../../components/ui/Segmented'
import { ComingSoon } from '../../components/agent/ComingSoon'
import { ScriptTab } from '../../components/agent/training/ScriptTab'
import { VideosTab } from '../../components/agent/training/VideosTab'

// Training Center (Prompt 415) — page shell only. Replaces the standalone
// TrainingPlaceholder that used to sit at /agent/training. Script is real
// (app_settings.training_script, migration 099). Videos is real too
// (Prompt 417, training_videos table, migration 101) — real YouTube embeds,
// admin add/remove/reorder. AI Voice Roleplay stays "coming soon" until its
// own prompt builds it out.
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
      {tab === 'videos' && <VideosTab />}
      {tab === 'roleplay' && (
        <ComingSoon
          title="AI Voice Roleplay"
          description="Practice calls with an AI-graded roleplay agent land here."
        />
      )}
    </div>
  )
}
