// P893: the status filter pills on Leads and Clients. Each pill sits in its own status colour with its count; the
// picked one turns a darker shade of that colour. No sliding fill (that is the header tabs' motion only).
// Clicking the picked pill again, or All, clears the filter.
import './p893.css'

export function FilterPills({ items, value, onChange, label, allKey = 'all', className = '' }) {
  return (
    <div className={`fx-fpills ${className}`.trim()} role="group" aria-label={label}>
      {items.map(o => {
        const on = value === o.key
        const tone = o.key === allKey ? 'mute' : o.tone
        return (
          <button key={o.key} type="button" aria-pressed={on} title={o.title}
            className={`fx-fpill is-${tone}${o.key === allKey ? ' is-all' : ''}${on ? ' is-on' : ''}`}
            onClick={() => onChange(on || o.key === allKey ? allKey : o.key)}>
            {o.label}{o.count != null && <b className="tp-num">{o.count}</b>}
          </button>
        )
      })}
    </div>
  )
}
