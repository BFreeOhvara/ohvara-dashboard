const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DEFAULT_SETUP_FEE = 297

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const {
      clientId,
      businessName,
      monthlyPrice,
      setupFee,
      customerEmail,
    } = await req.json()

    if (!clientId || !businessName || typeof monthlyPrice !== 'number' || monthlyPrice <= 0) {
      return new Response(
        JSON.stringify({ error: 'clientId, businessName, and a positive monthlyPrice are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeKey) {
      return new Response(
        JSON.stringify({ error: 'STRIPE_SECRET_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const fee = typeof setupFee === 'number' && setupFee > 0 ? setupFee : DEFAULT_SETUP_FEE
    const dashboardUrl = Deno.env.get('DASHBOARD_URL') || 'https://ohvara-dashboard.vercel.app'

    // ONE Checkout Session, two line items: a recurring monthly price + a
    // one-time setup fee. Stripe allows mixing a non-recurring price into a
    // subscription-mode session — it's billed once on the first invoice
    // alongside the first month, the subscription itself then renews monthly.
    const body: Record<string, string> = {
      'mode': 'subscription',
      'payment_method_types[]': 'card',
      'success_url': `${dashboardUrl}/client?payment=success`,
      'cancel_url': `${dashboardUrl}/client?payment=cancelled`,
      'metadata[clientId]': clientId,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(Math.round(monthlyPrice * 100)),
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][price_data][product_data][name]': 'Ohvara AI Automation — Monthly',
      'line_items[0][price_data][product_data][description]': `${businessName} — custom automation stack`,
      'line_items[0][quantity]': '1',
      'line_items[1][price_data][currency]': 'usd',
      'line_items[1][price_data][unit_amount]': String(Math.round(fee * 100)),
      'line_items[1][price_data][product_data][name]': 'Ohvara Setup Fee',
      'line_items[1][price_data][product_data][description]': `${businessName} — one-time setup`,
      'line_items[1][quantity]': '1',
    }
    if (customerEmail) body['customer_email'] = customerEmail

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[create-checkout-session] Stripe error:', errText)
      return new Response(
        JSON.stringify({ error: 'Stripe checkout session creation failed', detail: errText }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const session = await res.json()

    return new Response(
      JSON.stringify({
        success: true,
        checkoutUrl: session.url,
        sessionId: session.id,
        monthlyPrice,
        setupFee: fee,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[create-checkout-session]', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
