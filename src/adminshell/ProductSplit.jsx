import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PhoneIncoming, Users, RotateCcw, Receipt, Layers } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { adminRevenue } from '../lib/leadSpend'
import { realClock } from '../lib/admReal'
import { SampleTag } from '../template/kit'
import { usd } from '../template/motion'
import { Tile } from './kit'
import { useAdmProductSplit, useAdmSource } from './data'
import { realSplit, splitRows, periodRange } from './products955'

// P955 — Revenue › By product: Leads · Servicing · Reactivation · Setup for the period, each with how many agents have
// it. Sample: data.js productSplitFor (Leads + Servicing + Setup = the Revenue tile; Reactivation lists on top). Real:
// admin_billing_revenue's by_product + counts (migration 268) for the period's dates; not on the server yet = says so.
const money = usd()
const ICON = { leads: PhoneIncoming, servicing: Users, reactivation: RotateCcw, setup: Receipt }
const SUB = {
  leads: n => `${n} ${n === 1 ? 'agent' : 'agents'} · lead plans + booking desk`,
  servicing: n => `${n} ${n === 1 ? 'agent' : 'agents'} · servicing plans + extra clients`,
  reactivation: n => `${n} ${n === 1 ? 'agent' : 'agents'} · lists paid, less refunds`,
  setup: () => 'One time, with Leads or Servicing',
}

function useRealSplit(period, on) {
  const range = useMemo(() => (on ? periodRange(period, realClock()) : null), [period, on])
  const q = useQuery({
    queryKey: ['p955', 'admin', 'revenue', period, range?.from, range?.to], enabled: !!range, refetchInterval: 60000,
    queryFn: () => adminRevenue(supabase, range.from, range.to),
  })
  return { split: realSplit(q.data), isLoading: q.isLoading && !!range, error: q.error }
}

export default function ProductSplit({ period, i = 2 }) {
  const src = useAdmSource()
  const real = src === 'real'
  const { data: sample } = useAdmProductSplit(period)
  const r = useRealSplit(period, real)
  const split = real ? r.split : sample
  const { rows, total } = splitRows(split)
  return (
    <Tile i={i} className="adm-split-prod" title="By product" sub="What each product brought in" aside={real ? null : <SampleTag>Sample</SampleTag>}>
      {real && r.isLoading ? <p className="tp-sub">Loading…</p>
        : real && !split ? <p className="fx-calm">Not on the server yet: the split shows once billing by product is live.</p>
          : (
            <ul className="adm-sum" data-testid="adm-product-split">
              {rows.map(x => {
                const Icon = ICON[x.key]
                return (
                  <li key={x.key} data-product={x.key}><Icon size={14} aria-hidden="true" /><span className="tp-grow">{x.label}<small>{SUB[x.key](x.agents)}</small></span><b className="tp-money">{money(x.amount)}</b></li>
                )
              })}
              <li className="is-total"><Layers size={14} aria-hidden="true" /><span className="tp-grow">All products</span><b className="tp-money">{money(total)}</b></li>
            </ul>
          )}
    </Tile>
  )
}
