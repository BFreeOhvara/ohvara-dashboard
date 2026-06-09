import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Pricing (North Star locked) ───────────────────────────────────────────────
const PACKAGES = {
  basic:   { name: 'Basic',   setup: 497, monthly: 497  },
  pro:     { name: 'Pro',     setup: 497, monthly: 797  },
  premium: { name: 'Premium', setup: 497, monthly: 1297 },
  elite:   { name: 'Elite',   setup: 497, monthly: 1797 },
}

// ── Strategy 1: Pre-created payment links from env vars ────────────────────────
// Set these in Supabase Edge Function secrets:
//   STRIPE_SETUP_LINK_BASIC, STRIPE_MONTHLY_LINK_BASIC
//   STRIPE_SETUP_LINK_PRO,   STRIPE_MONTHLY_LINK_PRO
//   STRIPE_SETUP_LINK_PREMIUM, STRIPE_MONTHLY_LINK_PREMIUM
//   STRIPE_SETUP_LINK_ELITE, STRIPE_MONTHLY_LINK_ELITE
function getEnvLinks(tier: string): { setupLink: string | null; monthlyLink: string | null } {
  const t = tier.toUpperCase()
  return {
    setupLink:   Deno.env.get(`STRIPE_SETUP_LINK_${t}`) || null,
    monthlyLink: Deno.env.get(`STRIPE_MONTHLY_LINK_${t}`) || null,
  }
}

// ── Strategy 2: Dynamically create Stripe checkout sessions ───────────────────
// Requires STRIPE_SECRET_KEY + STRIPE_PRICE_SETUP_* + STRIPE_PRICE_MONTHLY_*
async function createStripeCheckout(
  tier: string,
  businessName: string,
  customerEmail: string | undefined,
  type: 'setup' | 'monthly'
): Promise<string | null> {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) return null

  const pkg = PACKAGES[tier as keyof typeof PACKAGES]
  if (!pkg) return null

  const priceEnvKey = type === 'setup'
    ? `STRIPE_PRICE_SETUP_${tier.toUpperCase()}`
    : `STRIPE_PRICE_MONTHLY_${tier.toUpperCase()}`
  const priceId = Deno.env.get(priceEnvKey)

  // If no price ID configured, fall back to ad-hoc amount
  const body: Record<string, string> = {
    'payment_method_types[]': 'card',
    'mode': type === 'monthly' ? 'subscription' : 'payment',
    'success_url': `${Deno.env.get('CLIENT_PORTAL_URL') || 'https://client.ohvara.com'}/success?session={CHECKOUT_SESSION_ID}`,
    'cancel_url': `${Deno.env.get('CLIENT_PORTAL_URL') || 'https://client.ohvara.com'}/cancel`,
  }

  if (customerEmail) body['customer_email'] = customerEmail

  if (priceId) {
    body['line_items[0][price]'] = priceId
    body['line_items[0][quantity]'] = '1'
  } else {
    // Ad-hoc price
    const amount = type === 'setup' ? pkg.setup : pkg.monthly
    body['line_items[0][price_data][currency]'] = 'usd'
    body['line_items[0][price_data][unit_amount]'] = String(amount * 100)
    body['line_items[0][price_data][product_data][name]'] = `Ohvara ${pkg.name} — ${type === 'setup' ? 'Setup Fee' : 'Monthly Plan'}`
    body['line_items[0][price_data][product_data][description]'] = `${businessName || 'Your Business'} — Ohvara AI Automation`
    body['line_items[0][quantity]'] = '1'
    if (type === 'monthly') {
      body['line_items[0][price_data][recurring][interval]'] = 'month'
    }
  }

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body),
    })

    if (!res.ok) {
      console.warn('[generate-stripe-links] Stripe error:', await res.text())
      return null
    }

    const session = await res.json()
    return session.url || null
  } catch (err) {
    console.warn('[generate-stripe-links] Stripe call failed:', err)
    return null
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { tier, businessName, customerEmail } = await req.json()

    if (!tier || !PACKAGES[tier as keyof typeof PACKAGES]) {
      return new Response(
        JSON.stringify({ error: 'Invalid tier. Must be basic, pro, premium, or elite.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const pkg = PACKAGES[tier as keyof typeof PACKAGES]

    // Try Strategy 1: pre-created payment links (fastest, no API call)
    const envLinks = getEnvLinks(tier)

    const setupLink   = envLinks.setupLink   || await createStripeCheckout(tier, businessName, customerEmail, 'setup')
    const monthlyLink = envLinks.monthlyLink || await createStripeCheckout(tier, businessName, customerEmail, 'monthly')

    return new Response(
      JSON.stringify({
        tier,
        packageName: pkg.name,
        setupAmount: pkg.setup,
        monthlyAmount: pkg.monthly,
        setupLink,
        monthlyLink,
        // If both null, the frontend falls back to Stripe dashboard
        fallback: !setupLink && !monthlyLink,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[generate-stripe-links]', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
