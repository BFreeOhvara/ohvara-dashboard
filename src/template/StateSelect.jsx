import { Select } from './Select'
import { STATE_OPTIONS } from './selectOptions'

// P868 — the one state field for all three portals: the 50 states plus DC, A–Z. Type a letter to jump ("T" for
// Tennessee, again for Texas), or type more of the name. value / onChange use the two-letter code ('TX').

export function StateSelect({ value, onChange, label = 'State', placeholder = 'Pick a state', ...rest }) {
  return <Select label={label} placeholder={placeholder} value={String(value || '').toUpperCase()} onChange={onChange} options={STATE_OPTIONS} search={false} {...rest} />
}
