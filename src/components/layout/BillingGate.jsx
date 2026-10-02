import { Link, useLocation } from 'react-router-dom'
import { Lock, AlertTriangle } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAppSettings } from '../../hooks/useAppSettings'
import { billingAccess, formatBillingDate, formatWeekly } from '../../lib/billing'
import { card, primaryBtn, sectionTitle, MONO } from '../../lib/exportStyles'

// Prompt 673 — wraps every page's content. Inert unless
// app_settings.agent_billing_enforced is on (it's off until Stripe is live).
//
// Locked = a full lock screen in place of the page, not a read-only overlay:
// a half-working portal invites "why can't I book?" confusion, and the agent's
// existing clients are still being worked by Fulfillment regardless. Settings
// stays reachable so Billing is always one click away. The sidebar stays too.
export function BillingGate({ children }) {
  const { profile } = useAuth()
  const { data: settings } = useAppSettings()
  const { pathname } = useLocation()

  const { locked, grace } = billingAccess(profile, !!settings?.agent_billing_enforced)
  const price = formatWeekly(settings?.agent_billing_weekly_cents)

  if (locked && pathname !== '/settings') {
    return (
      <div style={{ ...card, maxWidth: 520, margin: '48px auto 0', textAlign: 'center', padding: '36px 28px' }}>
        <div style={{
          width: 44, height: 44, borderRadius: 999, margin: '0 auto 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--accent-dim)', color: 'var(--accent)',
        }}>
          <Lock size={20} />
        </div>
        <p style={{ ...sectionTitle, marginBottom: 8 }}>Your portal access is paused</p>
        <p style={{ margin: '0 0 22px', fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          Access runs on a <span style={{ fontFamily: MONO }}>{price}</span>/week subscription, and this week isn't paid.
          Pay in Billing to pick up where you left off. Clients you've already booked are still being worked.
        </p>
        <Link to="/settings#billing" style={{ ...primaryBtn, textDecoration: 'none' }}>Go to Billing</Link>
      </div>
    )
  }

  return (
    <>
      {grace && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 20,
          padding: '12px 16px', borderRadius: 12,
          background: 'var(--warning-dim)', border: '1px solid var(--warning-bd)',
        }}>
          <AlertTriangle size={16} style={{ color: 'var(--warning)', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 200, fontSize: 13.5, color: 'var(--text-primary)' }}>
            This week's payment didn't go through. Update your card by{' '}
            <b>{formatBillingDate(profile.billing_grace_until)}</b> to keep your access.
          </span>
          <Link to="/settings#billing" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--warning)' }}>Fix payment</Link>
        </div>
      )}
      {children}
    </>
  )
}
