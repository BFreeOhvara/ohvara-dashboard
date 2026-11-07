// doc-send core — P886. Sends queued documents to carriers by fax or email and records what happened. No network or
// database here (Store + Senders are injected), so node tests cover it: core.test.ts.
//
// POST {action:'run'}  (pg_cron, x-ohvara-cron)  → claim queued sends, send each, record delivered / failed
// POST ?hook=fax&key=<DOC_FAX_WEBHOOK_SECRET>    → the fax provider's result (Telnyx fax.delivered / fax.failed)
//
// SANDBOX (doc_settings.send_live off, the default): nothing is faxed or emailed. A send is marked delivered with a
// sandbox receipt, except the test addresses, which fail so the Retry path can be tried: a fax number ending 0000,
// or an email starting fail@ / fail+.

export type Claimed = {
  send_id: string; channel: 'fax' | 'email'; destination: string; sandbox: boolean; provider: string | null
  attempt: number; document_id: string; title: string; path: string | null; carrier: string | null
  client: string; policy_number: string | null
}
export type Result = { status: 'delivered' | 'failed' | 'sending'; failure?: string; receipt?: Record<string, unknown>; providerRef?: string; pages?: number }
export type Store = {
  claim(limit: number): Promise<Claimed[]>
  result(sendId: string, status: 'delivered' | 'failed', failure: string | null, receipt: Record<string, unknown>, providerRef: string | null, pages: number | null): Promise<void>
  byProviderRef(ref: string): Promise<string | null>
  setProviderRef(sendId: string, ref: string): Promise<void>
}
export type Senders = {
  fax?(c: Claimed): Promise<Result>     // live fax (Telnyx); returns 'sending' + providerRef, the webhook finishes it
  email?(c: Claimed): Promise<Result>   // live email (Resend) with the PDF attached
}

export const isTestFailure = (c: Pick<Claimed, 'channel' | 'destination'>) =>
  c.channel === 'fax' ? /0000$/.test(c.destination) : /^fail[@+]/i.test(c.destination)

export function sandboxResult(c: Claimed): Result {
  if (isTestFailure(c)) {
    return { status: 'failed', failure: c.channel === 'fax' ? 'Busy signal after 3 tries (sandbox test number)' : 'Mailbox not found (sandbox test address)', receipt: { sandbox: true } }
  }
  return { status: 'delivered', pages: 2, providerRef: `sandbox-${c.send_id.slice(0, 8)}`, receipt: { sandbox: true, channel: c.channel, to: c.destination } }
}

// Fax numbers go out as E.164.
export const e164 = (digits: string) => `+1${digits.replace(/\D/g, '').slice(-10)}`

export async function run(store: Store, senders: Senders, limit = 10) {
  const claimed = await store.claim(limit)
  const out: { send_id: string; status: string }[] = []
  for (const c of claimed) {
    let r: Result
    try {
      if (c.sandbox) r = sandboxResult(c)
      else if (!c.path) r = { status: 'failed', failure: 'The file is missing from the policy' }
      else if (c.channel === 'fax' && senders.fax) r = await senders.fax(c)
      else if (c.channel === 'email' && senders.email) r = await senders.email(c)
      else r = { status: 'failed', failure: `No ${c.channel} service is set up yet` }
    } catch (e) {
      r = { status: 'failed', failure: `Couldn't send: ${String((e as Error)?.message ?? e).slice(0, 160)}` }
    }
    if (r.status === 'sending') {
      if (r.providerRef) await store.setProviderRef(c.send_id, r.providerRef)
    } else {
      await store.result(c.send_id, r.status, r.failure ?? null, r.receipt ?? {}, r.providerRef ?? null, r.pages ?? null)
    }
    out.push({ send_id: c.send_id, status: r.status })
  }
  return out
}

// Telnyx fax webhook: { data: { event_type: 'fax.delivered' | 'fax.failed' | ..., payload: { fax_id, page_count,
// failure_reason, to } } }. Anything else is acknowledged and ignored.
export function readFaxHook(body: unknown): { ref: string; status: 'delivered' | 'failed'; failure: string | null; pages: number | null; receipt: Record<string, unknown> } | null {
  const d = (body as { data?: { event_type?: string; payload?: Record<string, unknown>; occurred_at?: string } })?.data
  const type = d?.event_type
  const p = d?.payload ?? {}
  const ref = typeof p.fax_id === 'string' ? p.fax_id : null
  if (!ref || (type !== 'fax.delivered' && type !== 'fax.failed')) return null
  const pages = typeof p.page_count === 'number' ? p.page_count : null
  return {
    ref, status: type === 'fax.delivered' ? 'delivered' : 'failed',
    failure: type === 'fax.failed' ? FAX_FAIL[String(p.failure_reason)] ?? `Fax failed (${String(p.failure_reason ?? 'unknown')})` : null,
    pages, receipt: { provider: 'telnyx', fax_id: ref, to: p.to ?? null, at: d?.occurred_at ?? null, pages },
  }
}
const FAX_FAIL: Record<string, string> = {
  user_busy: 'Busy signal', no_answer: 'No answer', destination_unreachable: 'Number not reachable',
  receiver_no_response: 'No fax machine answered', rejected: 'The fax machine refused it', invalid_number: 'Not a valid fax number',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export async function handle(req: Request, store: Store, senders: Senders, opts: { isCron: () => Promise<boolean>; hookSecret?: string }) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const url = new URL(req.url)
  if (url.searchParams.get('hook') === 'fax') {
    if (!opts.hookSecret || url.searchParams.get('key') !== opts.hookSecret) return json({ error: 'Unauthorised' }, 401)
    let body: unknown
    try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
    const h = readFaxHook(body)
    if (!h) return json({ ignored: true })
    const sendId = await store.byProviderRef(h.ref)
    if (!sendId) return json({ ignored: true, reason: 'unknown fax' })
    await store.result(sendId, h.status, h.failure, h.receipt, h.ref, h.pages)
    return json({ ok: true, send_id: sendId, status: h.status })
  }
  if (!(await opts.isCron())) return json({ error: 'Unauthorised' }, 401)
  return json({ sent: await run(store, senders) })
}
