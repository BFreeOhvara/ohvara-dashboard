// stripe-balance-webhook — credits an agent's prepaid lead balance when a
// create-balance-topup Checkout is paid (Roadmap Goal 3). index.ts wires Deno;
// all the logic is here, free of Deno globals, so it runs against signed fake
// events and an in-memory ledger in core.test.ts.
//
//   POST (Stripe) checkout.session.completed
//
// 1. The Stripe-Signature header is checked against
//    STRIPE_BALANCE_WEBHOOK_SECRET (this endpoint's own whsec_…, not
//    agent-billing's). Bad or missing → 400, nothing credited.
// 2. livemode true → 200, ignored (test mode only until going live is its own
//    checked step).
// 3. Only checkout.session.completed with mode payment, payment_status paid
//    and the balance-topup marker is credited; anything else → 200, ignored.
// 4. credit_topup(agent_id, amount_total, session id, event id) (migration
//    176). The ledger's unique keys credit each session id and each event id
//    once; 'duplicate' is a success, so a replay or retry writes nothing.
//    A database error → 500, so Stripe retries.
//
// Stripe webhook endpoint (test mode):
//   URL: https://jjextitmbptoaolacocs.supabase.co/functions/v1/stripe-balance-webhook
//   Event: checkout.session.completed

// The marker create-balance-topup puts on the session. Keep in step.
export const TOPUP_KIND = 'balance_topup'

export type CreditResult = { result: 'credited' | 'duplicate'; ledger_id: string | null; balance_cents: number | null }

export type Store = {
  // Calls public.credit_topup. Throws on a database error.
  creditTopup(args: { agent_id: string; amount_cents: number; session_id: string; event_id: string }): Promise<CreditResult>
}

export type Env = {
  webhookSecret?: string
  now?: () => number
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const MAX_SKEW_SECONDS = 5 * 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── signature ───────────────────────────────────────────────────────────────

export async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Stripe-Signature: t=<ts>,v1=<hex>[,v1=<hex>…]. Signed payload is `${t}.${body}`.
// More than one v1 shows up while a signing secret is being rolled.
export async function verifySignature(header: string | null, rawBody: string, secret: string, nowMs: number) {
  if (!header || !secret) return false
  let t = ''
  const v1: string[] = []
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=')
    if (k === 't') t = v
    if (k === 'v1' && v) v1.push(v)
  }
  const ts = Number(t)
  if (!t || !v1.length || !Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > MAX_SKEW_SECONDS) return false
  const expected = await hmacHex(secret, `${t}.${rawBody}`)
  return v1.some(sig => safeEqual(expected, sig))
}

// ── the event ───────────────────────────────────────────────────────────────

type Topup = { agent_id: string; amount_cents: number; session_id: string }

// The top-up to credit, or the reason it's ignored. Reads only the signed
// payload; the amount is what Stripe charged (amount_total).
export function topupOf(event: any): Topup | { ignored: string } {
  if (event?.type !== 'checkout.session.completed') return { ignored: `type ${event?.type}` }
  const s = event.data?.object || {}
  if (s.metadata?.kind !== TOPUP_KIND) return { ignored: 'not a balance top-up' }
  if (s.mode !== 'payment') return { ignored: `mode ${s.mode}` }
  if (s.payment_status !== 'paid') return { ignored: `payment ${s.payment_status}` }
  if (typeof s.id !== 'string' || !s.id.startsWith('cs_')) return { ignored: 'no session id' }
  const agentId = s.metadata?.agent_id
  if (typeof agentId !== 'string' || !UUID.test(agentId)) return { ignored: 'no agent' }
  if (s.client_reference_id && s.client_reference_id !== agentId) return { ignored: 'agent mismatch' }
  if (s.currency !== 'usd') return { ignored: `currency ${s.currency}` }
  if (!Number.isInteger(s.amount_total) || s.amount_total <= 0) return { ignored: 'no amount' }
  return { agent_id: agentId, amount_cents: s.amount_total, session_id: s.id }
}

export async function handle(req: Request, store: Store, env: Env): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!env.webhookSecret) {
    console.error('stripe-balance-webhook: signing secret not set')
    return json({ error: 'Not configured' }, 503)
  }

  const raw = await req.text()
  const nowMs = env.now ? env.now() : Date.now()
  if (!(await verifySignature(req.headers.get('stripe-signature'), raw, env.webhookSecret, nowMs))) {
    console.warn('stripe-balance-webhook: bad or missing signature')
    return json({ error: 'Bad signature' }, 400)
  }

  let event: any
  try { event = JSON.parse(raw) } catch { return json({ error: 'Bad payload' }, 400) }
  const eventId = typeof event?.id === 'string' ? event.id : ''

  if (event?.livemode !== false) {
    // Test mode only: a live (or unmarked) event never credits.
    console.warn(`stripe-balance-webhook ${eventId}: ignored (livemode ${event?.livemode})`)
    return json({ received: true, ignored: 'livemode' })
  }

  const topup = topupOf(event)
  if ('ignored' in topup) {
    console.log(`stripe-balance-webhook ${eventId}: ignored (${topup.ignored})`)
    return json({ received: true, ignored: topup.ignored })
  }
  if (!eventId.startsWith('evt_')) return json({ received: true, ignored: 'no event id' })

  // Non-2xx makes Stripe retry; the ledger's unique keys stop a double credit.
  try {
    const r = await store.creditTopup({ ...topup, event_id: eventId })
    console.log(`stripe-balance-webhook ${eventId} ${topup.session_id}: ${r.result}`)
    return json({ received: true, result: r.result })
  } catch (e) {
    console.error(`stripe-balance-webhook ${eventId} ${topup.session_id}: credit failed:`, (e as Error).message)
    return json({ error: 'Credit failed' }, 500)
  }
}
