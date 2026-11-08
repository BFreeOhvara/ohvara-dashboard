import { money, monDay, dayLong } from '../../../lib/adminPayouts'
import { useAdminPay } from './useAdminPay'

// Prompt 774 — Pay on a phone (mockup AdmPay.dc.html). P890: VAs are paid by
// the hour from clock in and out, so this is the next pay day (Automatic /
// Paused, plus Not live yet before payouts are switched on) and past runs.
// Same numbers as desktop Payouts (lib/adminPayouts.js); nothing here moves money.

const STATE = {
  auto: { badge: 'Pays automatically', cls: 'is-auto', note: 'Monday 8 AM. Nothing for you to do.' },
  paused: { badge: 'Paused', cls: 'is-warn', note: 'Automatic payouts are paused. Nobody gets paid Monday until you turn them back on in Payout settings.' },
  off: { badge: 'Not live yet', cls: 'is-warn', note: 'Payouts are off, so Monday’s run moves no money. Turn them on in Settings.' },
}

export function AdminPhonePay() {
  const pay = useAdminPay()
  const { model } = pay
  const { past } = model
  const st = STATE[pay.state]

  return (
    <div className="ph-stack" style={{ gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h1 className="ph-h1">Pay</h1>
      </div>

      <section className="ov-hero aph-payhero" aria-label="Next pay day">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="aph-payk">Next pay day · {monDay(model.nextPayDate)}</span>
          {!pay.loading && <span className={`aph-badge ${st.cls}`}><i aria-hidden="true" />{st.badge}</span>}
        </div>
        <div className="aph-paysub">
          {pay.loading ? 'Loading…' : pay.error ? `Couldn’t load pay: ${pay.error}` : 'VAs are paid by the hour from clock in and out.'}
        </div>
        {!pay.loading && <div className={`aph-paynote ${st.cls}`}>{st.note}</div>}
      </section>

      <section aria-label="Past pay runs">
        <div className="ph-sechead" style={{ marginBottom: 10 }}>
          <h2 className="ph-h2">Past pay runs</h2><span style={{ flex: 1 }} />
          {model.paidSince && <span className="ph-mute"><span className="ph-mono">{money(model.paidTotal)}</span> since {dayLong(model.paidSince)}</span>}
        </div>
        <div className="ov-card ph-card">
          {!past.length ? <div className="ph-empty">No pay runs yet.</div> : past.map(r => (
            <div key={r.id} className="ph-row" style={{ cursor: 'default', minHeight: 60 }}>
              <span className="ph-row-main">
                <span className="ph-row-title">{r.day}</span>
                <span className="ph-row-sub">{r.sub}</span>
              </span>
              <span className="ph-row-end">
                <b className="ph-mono" style={{ fontSize: 15 }}>{money(r.cents)}</b>
                <span style={{ color: 'var(--ov-up)', fontWeight: 700, fontSize: 12 }}>Paid</span>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
