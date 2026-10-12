// Prompt 753 — pieces shared by the fulfillment payout functions
// (fulfillment-connect-session, fulfillment-pay-week) and the Connect half of
// agent-billing's Stripe webhook. No Deno APIs here, so node --test can load it
// with a mocked Stripe.
//
// Money only ever moves one way here: Ohvara's Stripe balance → a Transfer to
// the rep's Express connected account → Stripe pays it out to their bank or
// debit card. Bank and tax numbers live only in Stripe; the most we keep is
// the bank name and last 4 digits.

// ── Stripe REST, injectable ─────────────────────────────────────────────────

export class StripeError extends Error {
  code?: string; type?: string; param?: string; status: number
  constructor(e: any, status: number, fallback: string) {
    super(e?.message || fallback)
    this.code = e?.code
    this.type = e?.type
    this.param = e?.param
    this.status = status
  }
}

// method + path (no /v1/) + params; params are form-encoded with bracketed
// nesting. A Stripe error must throw StripeError.
export type Stripe = (
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params?: Record<string, unknown>,
  opts?: { idempotencyKey?: string },
) => Promise<any>

export const STRIPE_VERSION = '2024-06-20'

export function formEncode(obj: Record<string, unknown>, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') formEncode(item as Record<string, unknown>, `${key}[${i}]`, out)
        else out.append(`${key}[${i}]`, String(item))
      })
    } else if (typeof v === 'object') {
      formEncode(v as Record<string, unknown>, key, out)
    } else {
      out.append(key, String(v))
    }
  }
  return out
}

// The real client, for index.ts files.
export function stripeClient(key: string, fetchImpl: typeof fetch = fetch): Stripe {
  return async (method, path, params, opts) => {
    const qs = method === 'GET' && params ? `?${formEncode(params)}` : ''
    const res = await fetchImpl(`https://api.stripe.com/v1/${path}${qs}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Stripe-Version': STRIPE_VERSION,
        ...(method !== 'GET' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(opts?.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
      },
      body: method !== 'GET' && params ? formEncode(params) : undefined,
    })
    const data = await res.json()
    if (!res.ok) throw new StripeError(data?.error, res.status, `Stripe ${method} ${path} failed (${res.status})`)
    return data
  }
}

// ── what we keep about a connected account ──────────────────────────────────

export type PayoutAccount = {
  rep_id: string
  stripe_account_id: string
  details_submitted: boolean
  payouts_enabled: boolean
  transfers_active: boolean
  requirements_due: string[]
  disabled_reason: string | null
  external_kind: 'bank' | 'card' | null
  bank_name: string | null
  last4: string | null
}

export type AccountStatus = 'none' | 'incomplete' | 'ready' | 'action_needed'

const CARD_BRANDS: Record<string, string> = {
  Visa: 'Visa', MasterCard: 'Mastercard', 'American Express': 'American Express', Discover: 'Discover',
}

// The external account payouts go to: the default for USD, else the first.
export function externalOf(account: any) {
  const list: any[] = account?.external_accounts?.data || []
  const ext = list.find(e => e.default_for_currency) || list[0]
  if (!ext) return { external_kind: null, bank_name: null, last4: null } as const
  if (ext.object === 'card') {
    return { external_kind: 'card' as const, bank_name: `${CARD_BRANDS[ext.brand] || ext.brand || 'Debit'} debit`, last4: ext.last4 ?? null }
  }
  return { external_kind: 'bank' as const, bank_name: ext.bank_name || 'Bank account', last4: ext.last4 ?? null }
}

export function summarize(repId: string, account: any): PayoutAccount {
  const req = account?.requirements || {}
  const due = [...new Set([...(req.past_due || []), ...(req.currently_due || [])])] as string[]
  return {
    rep_id: repId,
    stripe_account_id: account.id,
    details_submitted: !!account.details_submitted,
    payouts_enabled: !!account.payouts_enabled,
    transfers_active: account?.capabilities?.transfers === 'active',
    requirements_due: due,
    disabled_reason: req.disabled_reason || null,
    ...externalOf(account),
  }
}

export function statusOf(a: Pick<PayoutAccount, 'details_submitted' | 'payouts_enabled' | 'transfers_active' | 'requirements_due' | 'last4'> | null): AccountStatus {
  if (!a) return 'none'
  if (!a.details_submitted) return 'incomplete'
  if (a.payouts_enabled && a.transfers_active && !a.requirements_due.length && a.last4) return 'ready'
  return 'action_needed'
}

export const canPay = (a: PayoutAccount | null) => !!a && a.payouts_enabled && a.transfers_active

// "Chase •••• 4821"
export const destinationLabel = (a: Pick<PayoutAccount, 'bank_name' | 'last4'> | null) =>
  a?.last4 ? `${a.bank_name || 'Bank'} •••• ${a.last4}` : null

// ── emails (Resend) ─────────────────────────────────────────────────────────

export type Email = { to: string; subject: string; html: string; text: string }

const money = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const shortDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
export const weekLabel = (start: string, end: string) => `${shortDay(start)} – ${shortDay(end)}`
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

function wrap(title: string, body: string, appUrl: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"></head>` +
    `<body style="margin:0;background:#F6FAF9;font-family:Arial,Helvetica,sans-serif;color:#07332E">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">` +
    `<table role="presentation" width="100%" style="max-width:520px;background:#FFFFFF;border-radius:16px;border:1px solid #D8E6E3">` +
    `<tr><td style="padding:28px 28px 8px;font-size:20px;font-weight:700">${esc(title)}</td></tr>` +
    `<tr><td style="padding:0 28px 24px;font-size:15px;line-height:1.55">${body}` +
    `<p style="margin:20px 0 0"><a href="${esc(appUrl)}/fulfillment/pay" style="color:#00806F;font-weight:700">Open My pay</a></p>` +
    `</td></tr></table></td></tr></table></body></html>`
}

export function sentEmail(to: string, p: { period_start: string; period_end: string; amount_cents: number }, dest: string | null, appUrl: string): Email {
  const week = weekLabel(p.period_start, p.period_end)
  const where = dest ? ` to ${dest}` : ''
  return {
    to,
    subject: `Your pay is on its way: ${money(p.amount_cents)}`,
    html: wrap('Your pay is on its way', `<p style="margin:0">We sent <b>${money(p.amount_cents)}</b> for ${esc(week)}${esc(where)}. It usually lands in 1–2 business days.</p>`, appUrl),
    text: `We sent ${money(p.amount_cents)} for ${week}${where}. It usually lands in 1–2 business days.\n\n${appUrl}/fulfillment/pay`,
  }
}

export function problemEmail(to: string, p: { period_start: string; period_end: string; amount_cents: number }, reason: string, appUrl: string): Email {
  const week = weekLabel(p.period_start, p.period_end)
  return {
    to,
    subject: `There's a problem with your pay for ${week}`,
    html: wrap('There\'s a problem with your pay', `<p style="margin:0">Your ${money(p.amount_cents)} for ${esc(week)} didn't go out. ${esc(reason)}</p><p style="margin:12px 0 0">Open Payout settings to fix it, or message Brayden.</p>`, appUrl),
    text: `Your ${money(p.amount_cents)} for ${week} didn't go out. ${reason}\n\nOpen Payout settings to fix it, or message Brayden: ${appUrl}/fulfillment/pay?settings=1`,
  }
}

// ── Connect events (agent-billing's webhook hands these over) ───────────────

export type ConnectStore = {
  repByAccount(accountId: string): Promise<string | null>
  saveAccount(row: PayoutAccount): Promise<void>
  payoutByTransfer(transferId: string): Promise<{ id: string; rep_id: string; period_start: string; period_end: string; amount_cents: number; status: string } | null>
  markPayout(id: string, patch: Record<string, unknown>): Promise<void>
  rep(id: string): Promise<{ email: string | null; payout_email_problem: boolean } | null>
  sendEmail(e: Email): Promise<void>
}

export const CONNECT_EVENTS = ['account.updated', 'account.external_account.created', 'account.external_account.updated', 'account.external_account.deleted', 'transfer.reversed']

export const isConnectEvent = (event: any) => CONNECT_EVENTS.includes(event?.type)

// account.*: re-fetch the account (so an out-of-order event can't write stale
// state) and store its summary. transfer.reversed: the week goes back to
// failed and the rep is told.
export async function handleConnectEvent(store: ConnectStore, stripe: Stripe, event: any, appUrl: string) {
  const o = event.data?.object || {}
  if (event.type.startsWith('account.')) {
    const accountId = event.type === 'account.updated' ? o.id : (event.account || o.account)
    if (!accountId) return { ignored: 'no account' }
    const repId = await store.repByAccount(accountId)
    if (!repId) return { ignored: 'not a fulfillment payout account' }
    const account = await stripe('GET', `accounts/${accountId}`)
    const row = summarize(repId, account)
    await store.saveAccount(row)
    return { synced: repId, status: statusOf(row) }
  }
  if (event.type === 'transfer.reversed') {
    const p = await store.payoutByTransfer(o.id)
    if (!p) return { ignored: 'not a fulfillment payout' }
    if (p.status === 'failed') return { already: 'failed' }
    const reason = 'The payment was reversed.'
    await store.markPayout(p.id, { status: 'failed', failure_reason: reason })
    const rep = await store.rep(p.rep_id)
    if (rep?.email && rep.payout_email_problem) {
      try { await store.sendEmail(problemEmail(rep.email, p, reason, appUrl)) } catch (e) { console.error('payout email failed:', (e as Error).message) }
    }
    return { reversed: p.id }
  }
  return { ignored: event.type }
}
