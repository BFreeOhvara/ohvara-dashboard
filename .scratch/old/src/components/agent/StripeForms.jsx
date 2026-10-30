import { useEffect, useState } from 'react'
import { Elements, PaymentElement, useElements, useStripe, EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js'
import { Loader2, Lock } from 'lucide-react'
import { getStripe, invokeBilling, stripeAppearance } from '../../lib/billing'
import { useTheme } from '../../hooks/useTheme'

// Prompt 734 — the two places a card is typed, both Stripe's own fields
// inside our page (never our inputs, never through our server). Loaded with
// React.lazy so @stripe/react-stripe-js only ships to someone who opens one.
//
//   CardForm         — Update card: a SetupIntent + Payment Element; the
//                      confirmed card becomes the default via set_default_card.
//   CheckoutEmbed    — Subscribe: Stripe Embedded Checkout for one tier.

function Waiting({ label }) {
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 4px', fontSize: 14, color: 'var(--ov-mute)' }}>
      <Loader2 size={17} className="animate-spin" /> {label}
    </div>
  )
}

export function CardForm({ onSaved, onCancel }) {
  const [theme] = useTheme()
  const [setup, setSetup] = useState(null) // { client_secret, publishable_key }
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    invokeBilling('setup_card')
      .then(d => { if (live) setSetup(d) })
      .catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [])

  if (error) return <p role="alert" className="ov-mb-error">{error}</p>
  if (!setup) return <Waiting label="Opening the secure card form…" />
  return (
    <Elements stripe={getStripe(setup.publishable_key)} options={{ clientSecret: setup.client_secret, appearance: stripeAppearance(theme) }}>
      <CardFields onSaved={onSaved} onCancel={onCancel} />
    </Elements>
  )
}

function CardFields({ onSaved, onCancel }) {
  const stripe = useStripe()
  const elements = useElements()
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(e) {
    e.preventDefault()
    if (!stripe || !elements || busy) return
    setBusy(true)
    setError('')
    try {
      // 3-D Secure, if the bank asks, opens as Stripe's own pop-up; no redirect.
      const { error: err, setupIntent } = await stripe.confirmSetup({ elements, redirect: 'if_required' })
      if (err) throw new Error(err.message || 'That card couldn\'t be saved.')
      const pm = typeof setupIntent.payment_method === 'string' ? setupIntent.payment_method : setupIntent.payment_method?.id
      const d = await invokeBilling('set_default_card', { payment_method: pm })
      onSaved(d)
    } catch (e2) {
      setError(e2.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PaymentElement onReady={() => setReady(true)} options={{ layout: 'tabs', wallets: { applePay: 'never', googlePay: 'never' } }} />
      {!ready && <Waiting label="Loading the card form…" />}
      {error && <p role="alert" className="ov-mb-error">{error}</p>}
      <div className="ov-mb-actions">
        <span className="ov-mb-secure"><Lock size={13} strokeWidth={2} aria-hidden="true" /> Your card goes straight to Stripe</span>
        <button type="button" className="ov-ghost ov-mb-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="ov-solid ov-mb-btn" disabled={!ready || busy}>
          {busy ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : 'Save card'}
        </button>
      </div>
    </form>
  )
}

export function CheckoutEmbed({ tier, onError }) {
  const [session, setSession] = useState(null) // { client_secret, publishable_key }

  useEffect(() => {
    let live = true
    invokeBilling('checkout', { tier })
      .then(d => { if (live) setSession(d) })
      .catch(e => { if (live) onError(e) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier])

  if (!session) return <Waiting label="Opening secure checkout…" />
  return (
    <div className="ov-mb-embed">
      <EmbeddedCheckoutProvider stripe={getStripe(session.publishable_key)} options={{ clientSecret: session.client_secret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  )
}
