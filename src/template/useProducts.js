// P955 — what the agent bought, for the screens: the picked products, the nav keys (tabs for what they bought) and the
// one small suggestion. Sample or real, through the same data door.
import { useMemo } from 'react'
import { useSampleBilling, useSampleClients } from './data'
import { has, navFor, suggestion } from '../lib/products.js'
import { pickedOf } from './productsView.js'

export function useProducts() {
  const { data: b } = useSampleBilling()
  const picked = pickedOf(b)
  const key = picked.join(',')
  return useMemo(() => ({ b, picked, has: k => has(picked, k), suggest: suggestion(picked) }), [b, key]) // eslint-disable-line react-hooks/exhaustive-deps
}

export function useNavKeys() {
  const { picked } = useProducts()
  const { data: clients } = useSampleClients()
  const n = clients?.length || 0
  const key = picked.join(',')
  return useMemo(() => navFor(picked, { clients: n }), [key, n]) // eslint-disable-line react-hooks/exhaustive-deps
}
