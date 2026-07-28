import { useState } from 'react'
import { Segmented } from '../../components/ui/Segmented'
import { ComingSoon } from '../../components/agent/ComingSoon'
import CompensationGrid from './CompensationGrid'

// Commissions — Prompt 376. Was a bare ComingSoon placeholder (the real
// comp-grid rates it was waiting on landed in Prompt 370 as their own
// standalone page); folded back in here as the first real sub-tab now that
// Brayden confirmed Commissions should be the only nav entry, not two
// separate money-related items. Balance & Reserve stays a placeholder —
// real payout/accrual tracking is a separate, still-unbuilt data source
// from the comp-grid's static rate table.
const TABS = [
  { value: 'grid',    label: 'Compensation Grid' },
  { value: 'balance', label: 'Balance & Reserve' },
]

export default function Commissions() {
  const [tab, setTab] = useState('grid')

  return (
    <div>
      <Segmented value={tab} onChange={setTab} options={TABS} style={{ marginBottom: 20 }} />

      {tab === 'grid' && <CompensationGrid />}
      {tab === 'balance' && (
        <ComingSoon
          title="Balance & Reserve"
          description="Your accrued and reserved commission balance lands here once carrier payout data is wired in."
        />
      )}
    </div>
  )
}
