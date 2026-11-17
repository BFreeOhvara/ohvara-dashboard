// payment-intake core — P885 + P1027. Reads one forwarded carrier email (an inbound-email webhook), works out what it is
// and which policy it's about, and hands it to payment_intake_receive(). Gmail's forwarding-confirmation email is
// kept as a code for the agent's setup screen instead.
// Webhooks: Resend Receiving (email.received, Svix-signed; the body is fetched from the Receiving API), Postmark
// inbound JSON, or plain JSON with the shared secret. No network or database here: index.ts supplies the store, the
// Resend fetch and the AI reader. Tests: core.test.ts.

export type Kind = 'missed' | 'lapsed' | 'paid' | 'other'
// P1027: the finer reading. failed/returned/grace/pending_lapse → a missed payment; login = "log in to view".
export type Category = 'failed' | 'returned' | 'grace' | 'pending_lapse' | 'lapsed' | 'login' | 'paid' | 'ignore' | 'other'
export type Parsed = {
  kind: Kind
  category: Category
  policy_number: string | null
  client_name: string | null
  due_date: string | null // YYYY-MM-DD
  amount: string | null
  carrier_hint: string | null
  sender_domain: string | null
  read_by?: 'rules' | 'ai'
}
export type Inbound = { token: string | null; messageId: string; from: string; subject: string; text: string }
export type Store = {
  receive(token: string, messageId: string, from: string, subject: string, body: string, parsed: Parsed): Promise<Record<string, unknown>>
  gmailCode?(token: string, code: string | null, link: string | null, forAddr: string | null): Promise<Record<string, unknown>>
}
// What the AI reader returns (any field may be missing). index.ts calls Claude; tests stub it.
export type AiRead = (subject: string, text: string) => Promise<Partial<Pick<Parsed, 'category' | 'policy_number' | 'client_name' | 'due_date' | 'amount'>> | null>
export type ResendFetch = (emailId: string) => Promise<Record<string, unknown> | null>
export type Options = { resendSecret?: string; fetchResend?: ResendFetch; ai?: AiRead; now?: () => number }

// ── what kind of email it is ──
const LAPSED = /\b(has|have|had)\s+lapsed\b|\bpolicy\s+(is\s+|was\s+|has\s+been\s+)?(lapsed|terminated)\b|\bterminat\w*\s+for\s+non-?\s?payment\b|\blapse\s+notice\b(?!.*pending)/i
const PENDING = /lapse\s*-?\s*pending|pending\s+lapse|\bwill\s+(lapse|terminate|be\s+terminated)\b|about\s+to\s+lapse|lapse\s+warning|\bfinal\s+notice\b|\bat\s+risk\s+of\s+lapsing\b/i
const GRACE = /grace\s+period/i
const RETURNED = /returned\s+(item|check|eft|ach|payment|draft|premium)|payment\s+(was\s+|has\s+been\s+)?(returned|dishonou?red)|\bnsf\b|insufficient\s+funds|draft\s+(was\s+)?returned/i
const MISSED = new RegExp([
  'past\\s+due', 'overdue',
  'payment\\s+(was\\s+|has\\s+been\\s+)?(missed|not\\s+received|declined|rejected|failed|unsuccessful)',
  '(missed|failed|declined|rejected)\\s+(premium\\s+)?(payment|draft|premium)', 'draft\\s+(was\\s+)?(failed|unsuccessful)',
  'unable\\s+to\\s+(process|collect|draft)', 'premium\\s+(is\\s+)?(due|unpaid)\\s+and\\s+unpaid', 'non-?\\s?payment',
  '(have\\s+not|haven\'t)\\s+received\\s+(your|the)\\s+(premium|payment)', 'premium\\s+not\\s+received',
].join('|'), 'i')
const PAID = /\b(payment|premium)\s+(was\s+|has\s+been\s+)?(received|processed|successful|applied)\b|\bthank\s+you\s+for\s+your\s+payment\b|\bpayment\s+confirmation\b/i
const LOGIN = /\blog\s*-?\s*in\b[^.\n]{0,40}\b(view|see|read|access|review)\b|\bsign\s*-?\s*in\b[^.\n]{0,40}\b(view|see|read|access|review)\b|\bnew\s+(document|message|notice|correspondence|letter)s?\b[^.\n]{0,30}\b(available|waiting|posted|ready)\b|\b(document|notice|correspondence)\s+(is\s+)?(now\s+)?available\b/i
const POLICY_WORDS = /\b(polic(y|ies)|premium|coverage|insured|policyholder|beneficiar(y|ies)|lapse|grace\s+period|draft|bank\s+draft|eft|contract\s+(no|number|#)|certificate)\b/i

export function categoryOf(subject: string, text: string): Category {
  const all = `${subject}\n${text}`
  if (PENDING.test(all)) return 'pending_lapse'
  if (LAPSED.test(all)) return 'lapsed'
  if (RETURNED.test(all)) return 'returned'
  if (GRACE.test(all)) return 'grace'
  if (MISSED.test(all)) return 'failed'
  if (PAID.test(all)) return 'paid'
  if (LOGIN.test(all) && POLICY_WORDS.test(all)) return 'login'
  if (!POLICY_WORDS.test(all)) return 'ignore'
  return 'other'
}
export function kindFor(c: Category): Kind {
  return c === 'failed' || c === 'returned' || c === 'grace' || c === 'pending_lapse' ? 'missed' : c === 'lapsed' || c === 'paid' ? c : 'other'
}
// 238's four kinds (kept for callers and tests).
export function kindOf(subject: string, text: string): Kind {
  const c = categoryOf(subject, text)
  // An unclear email is 'other' either way; a login notice is not a missed payment until someone looks.
  return kindFor(c)
}

// ── dates ──
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')
export function isoDate(s: string): string | null {
  const t = s.trim()
  let y: number, m: number, d: number
  let r = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (r) { y = +r[1]; m = +r[2]; d = +r[3] } else if ((r = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
    m = +r[1]; d = +r[2]; y = +r[3]; if (y < 100) y += 2000
  } else if ((r = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/))) {
    m = MONTHS.indexOf(r[1].slice(0, 3).toLowerCase()) + 1; d = +r[2]; y = +r[3]
  } else if ((r = t.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/))) {
    d = +r[1]; m = MONTHS.indexOf(r[2].slice(0, 3).toLowerCase()) + 1; y = +r[3]
  } else return null
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return `${y}-${pad(m)}-${pad(d)}`
}
const DATE = String.raw`(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4})`
const DUE = new RegExp(String.raw`(?:premium\s+due|payment\s+due|due|draft|bill(?:ing)?|paid[-\s]to)\s*(?:date|on)?\s*[:\-]?\s*` + DATE, 'i')

// ── the rest ──
const POLICY = /\b(?:policy|contract|certificate)\s*(?:number|no\.?|num(?:ber)?|#|id)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,24}[0-9][A-Z0-9-]*)/i
const NAME = /\b(?:insured|policy\s*holder|policyholder|policy\s+owner|owner|client|annuitant)(?:'s)?[ \t]*(?:name)?[ \t]*[:\-][ \t]*([A-Za-z][A-Za-z'.-]*(?:,?[ \t]+[A-Za-z][A-Za-z'.-]*){1,3})[ \t]*(?:\r?\n|$)/im
const AMOUNT = /\$\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/

// A forwarded email: the original sender is in the "From:" line of the forwarded block. A Gmail/Outlook auto-forward
// keeps the carrier as the outer From.
function senderLine(from: string, text: string): string {
  const fwd = text.match(/^\s*(?:>\s*)?From:\s*(.+)$/im)
  return (fwd?.[1] ?? from ?? '').trim()
}
export function carrierHint(from: string, text: string): string | null {
  const raw = senderLine(from, text)
  const named = raw.match(/^"?([^"<]+?)"?\s*</)
  if (named) return named[1].trim().slice(0, 120)
  const dom = raw.match(/@([A-Za-z0-9.-]+)/)
  return dom ? dom[1].toLowerCase().slice(0, 120) : null
}
export function senderDomain(from: string, text: string): string | null {
  const dom = senderLine(from, text).match(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/)
  return dom ? dom[1].toLowerCase().slice(0, 120) : null
}

export function parseNotice(subject: string, text: string, from = ''): Parsed {
  const all = `${subject}\n${text}`
  const due = all.match(DUE)
  const pol = all.match(POLICY)
  const name = all.match(NAME)
  const amt = all.match(AMOUNT)
  const category = categoryOf(subject, text)
  return {
    kind: kindFor(category),
    category,
    policy_number: pol ? pol[1].toUpperCase() : null,
    client_name: name ? name[1].replace(/\s+/g, ' ').trim() : null,
    due_date: due ? isoDate(due[1]) : null,
    amount: amt ? amt[1].replace(/,/g, '') : null,
    carrier_hint: carrierHint(from, text),
    sender_domain: senderDomain(from, text),
    read_by: 'rules',
  }
}

// When the rules can't tell what it is, or who it's about, the AI reads it. The rules win where both answered,
// except a rules "other" (unclear), which the AI may settle.
const CATS: Category[] = ['failed', 'returned', 'grace', 'pending_lapse', 'lapsed', 'login', 'paid', 'ignore', 'other']
export function needsAi(p: Parsed): boolean {
  if (p.category === 'other' || p.category === 'login') return true
  return p.category !== 'ignore' && p.category !== 'paid' && !p.policy_number && !p.client_name
}
export function mergeAi(p: Parsed, a: Awaited<ReturnType<AiRead>>): Parsed {
  if (!a) return p
  const cat = a.category && CATS.includes(a.category) ? a.category : null
  const category = p.category === 'other' && cat ? cat : p.category === 'login' && cat && cat !== 'other' && cat !== 'ignore' ? cat : p.category
  const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
  const due = str(a.due_date, 10)
  return {
    ...p,
    category,
    kind: kindFor(category),
    policy_number: p.policy_number ?? (str(a.policy_number, 30)?.toUpperCase() ?? null),
    client_name: p.client_name ?? str(a.client_name, 80),
    due_date: p.due_date ?? (due && isoDate(due) ? isoDate(due) : null),
    amount: p.amount ?? (str(a.amount, 20)?.replace(/[$,\s]/g, '') || null),
    read_by: 'ai',
  }
}

// ── Gmail's forwarding confirmation ──
// From forwarding-noreply@google.com, subject "(#123456789) Gmail Forwarding Confirmation - Receive Mail from x@gmail.com".
export function gmailConfirm(from: string, subject: string, text: string): { code: string | null; link: string | null; forAddr: string | null } | null {
  if (!/forwarding-noreply@google\.com/i.test(from) && !/gmail\s+forwarding\s+confirmation/i.test(subject)) return null
  const code = (subject.match(/\(#(\d{6,12})\)/) ?? text.match(/confirmation\s+code:?\s*(\d{6,12})/i))?.[1] ?? null
  const link = text.match(/https:\/\/(?:mail-settings|mail|isolated\.mail)\.google\.com\/[^\s"'<>)\]]+/)?.[0]?.slice(0, 600) ?? null
  const forAddr = (subject.match(/from\s+(\S+@\S+)/i) ?? text.match(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+)\s+has\s+requested/i))?.[1]?.slice(0, 200) ?? null
  return { code, link, forAddr }
}

// ── addresses ──
// P1027: dana-7k2f@notices.ohvara.com (local part = name + 4). P885: pay+<10>@in.ohvara.com, or the bare token.
const TOKEN = /pay\+([a-z0-9]{10})@/i
const LOCAL = /(?:^|[<\s"',])([a-z]{1,20}-[a-z0-9]{4})@(?:[a-z0-9-]+\.)*ohvara\.com\b/i
export function tokenFrom(...addrs: (string | undefined | null)[]): string | null {
  for (const a of addrs) {
    if (!a) continue
    const t = a.trim()
    if (/^[a-z0-9]{10}$/i.test(t)) return t.toLowerCase()
    if (/^[a-z]{1,20}-[a-z0-9]{4}$/i.test(t)) return t.toLowerCase()
    const m = t.match(TOKEN)
    if (m) return m[1].toLowerCase()
    const l = t.match(LOCAL)
    if (l) return l[1].toLowerCase()
  }
  return null
}
export const stripHtml = (h: string) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, ' ')

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : typeof v === 'string' ? [v] : [])

export function readInbound(b: Record<string, unknown>): Inbound {
  const s = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '')
  const toFull = Array.isArray(b.ToFull) ? (b.ToFull as { Email?: string; MailboxHash?: string }[]) : []
  const token = tokenFrom(s('MailboxHash'), s('OriginalRecipient'), s('To'), ...strs(b.to), s('recipient'),
    ...strs(b.received_for), ...toFull.flatMap(t => [t.MailboxHash, t.Email]))
  const text = s('TextBody') || s('text') || s('StrippedTextReply') || stripHtml(s('HtmlBody') || s('html'))
  const messageId = s('MessageID') || s('message_id') || s('MessageId') || s('id')
  return { token, messageId, from: s('From') || s('from'), subject: s('Subject') || s('subject'), text }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let x = 0
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return x === 0
}

// Resend signs webhooks with Svix: base64(HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)), header "v1,<sig> ...".
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
export async function svixSign(secret: string, id: string, ts: string, body: string): Promise<string> {
  const raw = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`))))
}
export async function svixOk(secret: string, headers: Headers, body: string, nowMs: number): Promise<boolean> {
  const id = headers.get('svix-id') ?? '', ts = headers.get('svix-timestamp') ?? '', sig = headers.get('svix-signature') ?? ''
  if (!id || !ts || !sig || !/^\d+$/.test(ts) || Math.abs(nowMs / 1000 - Number(ts)) > 300) return false
  let want: string
  try { want = await svixSign(secret, id, ts, body) } catch { return false }
  return sig.split(' ').some(p => sameSecret(p.replace(/^v1,/, ''), want))
}

async function process(m: Inbound, store: Store, ai?: AiRead): Promise<Response> {
  if (!m.token) return json(200, { status: 'unknown_address' })
  if (!m.messageId) return json(400, { error: 'No message id' })
  const g = gmailConfirm(m.from, m.subject, m.text)
  if (g) {
    if (!store.gmailCode) return json(200, { status: 'gmail_code_ignored' })
    return json(200, { ...(await store.gmailCode(m.token, g.code, g.link, g.forAddr)), kind: 'gmail' })
  }
  let parsed = parseNotice(m.subject, m.text, m.from)
  if (ai && needsAi(parsed)) {
    try { parsed = mergeAi(parsed, await ai(m.subject.slice(0, 500), m.text.slice(0, 6000))) } catch { /* the rules' reading stands */ }
  }
  const out = await store.receive(m.token, m.messageId, m.from.slice(0, 300), m.subject.slice(0, 500), m.text.slice(0, 8000), parsed)
  return json(200, { ...out, kind: parsed.kind, category: parsed.category })
}

// Two ways in:
//   Resend (svix-id header): the signature is checked with opts.resendSecret, the email is fetched by id.
//   Postmark / plain: the shared secret as the x-ohvara-intake header, Basic auth password, or ?key=.
// Always 200 for a handled email, even an unknown address, so the mail service doesn't retry forever.
export async function handle(req: Request, store: Store, secret: string | undefined, opts: Options = {}): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  if (req.headers.get('svix-id')) {
    if (!opts.resendSecret || !opts.fetchResend) return json(503, { error: 'Resend intake is not set up' })
    const raw = await req.text()
    if (!(await svixOk(opts.resendSecret, req.headers, raw, (opts.now ?? Date.now)()))) return json(401, { error: 'Not allowed' })
    let ev: { type?: string; data?: Record<string, unknown> }
    try { ev = JSON.parse(raw) } catch { return json(400, { error: 'Send JSON' }) }
    if (ev.type !== 'email.received') return json(200, { status: 'ignored_event' })
    const id = typeof ev.data?.email_id === 'string' ? ev.data.email_id : typeof ev.data?.id === 'string' ? ev.data.id : ''
    if (!id) return json(400, { error: 'No email id' })
    const full = await opts.fetchResend(id)
    if (!full) return json(502, { error: 'Could not fetch the email' }) // Resend retries the webhook.
    const m = readInbound({ ...ev.data, ...full })
    if (!m.token) m.token = tokenFrom(...strs(ev.data?.to))
    m.messageId = m.messageId || id
    return process(m, store, opts.ai)
  }
  if (!secret) return json(503, { error: 'Intake is not set up (PAYMENT_INTAKE_SECRET missing)' })
  const url = new URL(req.url)
  const basic = (req.headers.get('authorization') ?? '').match(/^Basic\s+(.+)$/i)
  let pass = req.headers.get('x-ohvara-intake') ?? url.searchParams.get('key') ?? ''
  if (!pass && basic) { try { pass = atob(basic[1]).split(':').slice(1).join(':') } catch { pass = '' } }
  if (!sameSecret(pass, secret)) return json(401, { error: 'Not allowed' })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json(400, { error: 'Send JSON' }) }
  return process(readInbound(body), store, opts.ai)
}
