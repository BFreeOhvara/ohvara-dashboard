import { Check } from 'lucide-react'

// P1016 — pick the kind of life insurance leads you get: one card per type, "Most popular" on one. Controlled: `value`
// is a type key, `onChange(key)`. Same look as the sign-up's other choices (signupCheckout.css .sc-opt).
export function LeadTypePicker({ types, value, onChange, name = 'lead-type', disabled = false }) {
  return (
    <div className="sc-types" role="radiogroup" aria-label="Lead type" data-testid="lead-type-picker">
      {types.map(t => {
        const on = value === t.key
        return (
          <label key={t.key} className={`sc-opt${on ? ' is-on' : ''}`} data-testid={`lead-type-${t.key}`}>
            <input type="radio" name={name} className="sr-only" checked={on} disabled={disabled} onChange={() => onChange(t.key)} />
            <span className="sc-rad" aria-hidden="true">{on && <Check size={12} strokeWidth={3} />}</span>
            <span>
              <b>{t.label}{t.most_popular && <em className="sc-most">Most popular</em>}</b>
              {t.blurb && <small>{t.blurb}</small>}
            </span>
          </label>
        )
      })}
    </div>
  )
}
