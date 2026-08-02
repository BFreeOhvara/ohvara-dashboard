import { useState } from 'react'
import { Segmented } from '../../components/ui/Segmented'
import CompensationGrid from './CompensationGrid'
import Balance from './Balance'

// Commissions — Prompt 376, real Balance wired in at Prompt 412 (migration
// 098's estimated_commission). Prompt 411: Balance is now the first/default
// tab (was Compensation Grid) and "Balance & Reserve" is just "Balance" —
// Brayden's decision to drop the reserve/holdback concept entirely (Prompt
// 412) means the name shouldn't reference it anymore either.
const TABS = [
  { value: 'balance', label: 'Balance' },
  { value: 'grid',    label: 'Compensation Grid' },
]

export default function Commissions() {
  const [tab, setTab] = useState('balance')

  return (
    <div>
      <Segmented value={tab} onChange={setTab} options={TABS} style={{ marginBottom: 20 }} />

      {tab === 'balance' && <Balance />}
      {tab === 'grid' && <CompensationGrid />}
    </div>
  )
}
