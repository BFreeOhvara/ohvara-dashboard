import { feeWords } from './spendPlan.js'

// P917 — the card on file as a card: brand, last 4 and expiry. Real data may only carry a label ("Visa ending 4242").
export function cardOf(card) {
  if (!card?.onFile) return null
  const m = /^(\w[\w ]*?) ending (\d{4})$/.exec(card.label || '')
  return { brand: card.brand || m?.[1] || 'Card', last4: card.last4 || m?.[2] || null, exp: card.exp || null }
}

// P917 — every charge: the nightly lead spend, the monthly plan, the setup fee, with its date, amount and status.
// Tonight's charge comes first (scheduled, or waiting while a declined day is retried). Real data has no list yet:
// its history rows show as paid.
export function chargesOf(b) {
  const n = b.nightNow
  const unpaid = n?.ahead?.find(d => d.status === 'failed')
  const next = n && b.card?.onFile && !b.paused && !b.cancel
    ? [{ id: 'c-next', at: b.nightly?.at || 'Tonight', label: `Lead spend for ${n.forDay} + ${feeWords}`, kind: 'lead', amount: n.tonight.total, status: unpaid ? 'waiting' : 'scheduled' }]
    : []
  const past = b.charges || (b.history || []).map(h => ({ ...h, kind: /plan/i.test(h.label) ? 'plan' : /setup/i.test(h.label) ? 'setup' : 'lead', status: 'paid' }))
  return [...next, ...past]
}
