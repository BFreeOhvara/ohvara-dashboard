import { CreditCard } from 'lucide-react'

// Prompt 775 — no payments inside the phone app. In the app the Billing page,
// the More billing card button, the paused-access screen and the plan-limit
// "Upgrade" are replaced by this line. No link out: Apple's rules on linking
// to outside purchases differ by country and keep changing, so the app shows
// none (P775 rule: when unsure, show no link).
export const NATIVE_BILLING_TEXT = 'Billing is managed on the Ohvara website.'

export function NativeBillingNote({ style }) {
  return (
    <section className="ov-card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 18px', ...style }}>
      <span style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ov-data-a-tint)', color: 'var(--ov-data-a)' }}>
        <CreditCard size={19} strokeWidth={2} aria-hidden="true" />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--ov-hi)' }}>{NATIVE_BILLING_TEXT}</span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 13.5, color: 'var(--ov-mute)' }}>Your plan and payments can’t be changed in the app.</span>
      </span>
    </section>
  )
}
