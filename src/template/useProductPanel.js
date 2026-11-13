import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useProducts } from './useProducts'

// Which drawer is open on Billing. ?add=leads or ?add=servicing opens that drawer (the "Add Leads" cards and the
// Not on your plan links point here); it follows the address, so a link on the page itself works too.
export function useProductPanel() {
  const { picked } = useProducts()
  const [params, setParams] = useSearchParams()
  const raw = params.get('add')
  // P990: a lead plan includes Servicing, so ?add=servicing opens nothing there.
  const want = raw === 'servicing' && picked.includes('leads') ? null : raw
  const [panel, setPanel] = useState(() => (['leads', 'servicing'].includes(want) && !picked.includes(want) ? want : null))
  const [seen, setSeen] = useState(want)
  if (want !== seen) { setSeen(want); if (['leads', 'servicing'].includes(want) && !picked.includes(want)) setPanel(want) }
  const close = () => { setPanel(null); if (raw) { const p = new URLSearchParams(params); p.delete('add'); setParams(p, { replace: true }) } }
  return [panel, setPanel, close]
}
