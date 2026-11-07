import { useCallback } from 'react'
import { Select } from './Select'
import { CARRIER_CATALOG, matchCarriers, findCarrier, logUnknownCarrier } from '../lib/carriers/catalog'

// P868 — the one carrier picker (Submit, Book a call, Request service, VA servicing, admin). Every US life carrier
// from lib/carriers, not just contracted ones. Type "A" and the A carriers come up; a short name, parent or issuing
// company finds it too ("MOO" → Mutual of Omaha, shown as "Also called MOO"). A name that isn't listed can still be
// used as typed; it's logged for review (no screen). value / onChange are the carrier's name.
const OPTIONS = CARRIER_CATALOG.map(c => ({ value: c.name, label: c.name })).sort((a, b) => a.label.localeCompare(b.label))

export function CarrierSelect({ value, onChange, label = 'Carrier', placeholder = 'Type or pick a carrier', by = null, ...rest }) {
  const filter = useCallback(q => { const exact = findCarrier(q)?.name; return matchCarriers(q).map(h => ({ value: h.carrier.name, label: h.carrier.name, sub: h.alias ? `Also called ${h.alias}` : undefined, exact: h.carrier.name === exact })) }, [])
  const pick = v => {
    const c = findCarrier(v)
    if (!c) logUnknownCarrier(v, by)
    onChange(c ? c.name : v)
  }
  return <Select label={label} placeholder={placeholder} value={value} onChange={pick} options={OPTIONS} filter={filter} search allowCustom {...rest} />
}
