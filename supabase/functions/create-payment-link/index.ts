import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SETUP_FEE_CENTS = 29700 // $297 flat

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { monthlyPrice, businessName } = await req.json()

    if (!monthlyPrice || typeof monthlyPrice !== 'number' || monthlyPrice <= 0) {
      return new Response(
        JSON.stringify({ error: 'monthlyPrice (positive number) is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeKey) {
      return new Response(
        JSON.stringify({ error: 'Stripe not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const clientPortal = Deno.env.get('CLIENT_PORTAL_URL') || 'https://client.ohvara.com'
    const biz = businessName || 'Your Business'

    // Subscription checkout with setup fee added to the first invoice
    const body = new URLSearchParams({
      'mode': 'subscription',
      'success_url': `${clientPortal}/success?session={CHECKOUT_SESSION_ID}`,
      'cancel_url': `${clientPortal}/cancel`,

      // Recurring monthly
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(Math.round(monthlyPrice * 100)),
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][price_data][product_data][name]': 'Ohvara AI Automation',
      'line_items[0][price_data][product_data][description]': `${biz} — monthly plan`,
      'line_items[0][quantity]': '1',

      // One-time setup fee on first invoice
      'subscription_data[add_invoice_items][0][price_data][currency]': 'usd',
      'subscription_data[add_invoice_items][0][price_data][unit_amount]': String(SETUP_FEE_CENTS),
      'subscription_data[add_invoice_items][0][price_data][product_data][name]': 'Ohvara Setup Fee',
      'subscription_data[add_invoice_items][0][price_data][product_data][description]': `${biz} — one-time onboarding`,
      'subscription_data[add_invoice_items][0][quantity]': '1',

      'subscription_data[metadata][business_name]': biz,
    })

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[create-payment-link] Stripe error:', errText)
      return new Response(
        JSON.stringify({ error: 'Stripe session creation failed', detail: errText }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const session = await res.json()
    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[create-payment-link]', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
