// payment-intake core — P885. Reads one forwarded carrier email (inbound-email webhook), works out what it is
// (missed / lapsed / paid / other) and which policy it's about, and hands it to payment_intake_receive().
// No network, no database here: index.ts supplies the store. Tests: core.test.ts.

export type Kind = 'missed' | 'lapsed' | 'paid' | 'other'
export type Parsed = {
  kind: Kind
  policy_number: string | null
  client_name: string | null
  due_date: string | null // YYYY-MM-DD
  amount: string | null
  carrier_hint: string | null
}
export type Inbound = { token: string | null; messageId: string; from: string; subject: string; text: string }
export type Store = {
  receive(token: string, messageId: string, from: string, subject: string, body: string, parsed: Parsed): Promise<Record<string, unknown>>
}

// ── what kind of email it is ──
const LAPSED = /\b(has|have|had)\s+lapsed\b|\bpolicy\s+(is\s+|was\s+|has\s+been\s+)?(lapsed|terminated)\b|\bterminat\w*\s+for\s+non-?\s?payment\b|\blapse\s+notice\b(?!.*pending)/i
const MISSED = new RegExp([
  'lapse\\s*-?\\s*pending', 'pending\\s+lapse', 'grace\\s+period', 'past\\s+due', 'overdue',
  'payment\\s+(was\\s+|has\\s+been\\s+)?(missed|not\\s+received|returned|declined|rejected|failed|unsuccessful|dishonou?red)',
  '(missed|failed|returned|declined|rejected)\\s+(premium\\s+)?(payment|draft|premium)', 'insufficient\\s+funds', '\\bnsf\\b',
  'returned\\s+(item|check|eft|ach)', 'draft\\s+(was\\s+)?(returned|failed|unsuccessful)', 'unable\\s+to\\s+(process|collect|draft)',
  'premium\\s+(is\\s+)?(due|unpaid)\\s+and\\s+unpaid', 'non-?\\s?payment',
].join('|'), 'i')
const PAID = /\b(payment|premium)\s+(was\s+|has\s+been\s+)?(received|processed|successful|applied)\b|\bthank\s+you\s+for\s+your\s+payment\b|\bpayment\s+confirmation\b/i

export function kindOf(subject: string, text: string): Kind {
  const all = `${subject}\n${text}`
  if (LAPSED.test(all)) return 'lapsed'
  if (MISSED.test(all)) return 'missed'
  if (PAID.test(all)) return 'paid'
  return 'other'
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

// A forwarded email: the original sender is in the "From:" line of the forwarded block.
export function carrierHint(from: string, text: string): string | null {
  const fwd = text.match(/^\s*(?:>\s*)?From:\s*(.+)$/im)
  const raw = (fwd?.[1] ?? from ?? '').trim()
  const named = raw.match(/^"?([^"<]+?)"?\s*</)
  if (named) return named[1].trim().slice(0, 120)
  const dom = raw.match(/@([A-Za-z0-9.-]+)/)
  return dom ? dom[1].toLowerCase().slice(0, 120) : null
}

export function parseNotice(subject: string, text: string, from = ''): Parsed {
  const all = `${subject}\n${text}`
  const due = all.match(DUE)
  const pol = all.match(POLICY)
  const name = all.match(NAME)
  const amt = all.match(AMOUNT)
  return {
    kind: kindOf(subject, text),
    policy_number: pol ? pol[1].toUpperCase() : null,
    client_name: name ? name[1].replace(/\s+/g, ' ').trim() : null,
    due_date: due ? isoDate(due[1]) : null,
    amount: amt ? amt[1].replace(/,/g, '') : null,
    carrier_hint: carrierHint(from, text),
  }
}

// ── the inbound webhook ──
// Postmark inbound JSON (From, To, OriginalRecipient, MailboxHash, Subject, TextBody, HtmlBody, MessageID) and a
// plain shape (from, to, subject, text, html, message_id) both work. The token is the +part of pay+<token>@...
const TOKEN = /pay\+([a-z0-9]{10})@/i
export function tokenFrom(...addrs: (string | undefined | null)[]): string | null {
  for (const a of addrs) {
    if (!a) continue
    if (/^[a-z0-9]{10}$/i.test(a.trim())) return a.trim().toLowerCase()
    const m = a.match(TOKEN)
    if (m) return m[1].toLowerCase()
  }
  return null
}
export const stripHtml = (h: string) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, ' ')

export function readInbound(b: Record<string, unknown>): Inbound {
  const s = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '')
  const toFull = Array.isArray(b.ToFull) ? (b.ToFull as { Email?: string; MailboxHash?: string }[]) : []
  const token = tokenFrom(s('MailboxHash'), s('OriginalRecipient'), s('To'), s('to'), s('recipient'),
    ...toFull.flatMap(t => [t.MailboxHash, t.Email]))
  const text = s('TextBody') || s('text') || s('StrippedTextReply') || stripHtml(s('HtmlBody') || s('html'))
  const messageId = s('MessageID') || s('message_id') || s('MessageId')
  return { token, messageId, from: s('From') || s('from'), subject: s('Subject') || s('subject'), text }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let x = 0
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return x === 0
}

// The secret comes as the x-ohvara-intake header, the password of HTTP Basic auth (Postmark: https://u:SECRET@...),
// or ?key=SECRET. Always 200 for a handled email, even an unknown address, so the mail service doesn't retry forever;
// 401 on a bad secret, 400 on junk.
export async function handle(req: Request, store: Store, secret: string | undefined): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  if (!secret) return json(503, { error: 'Intake is not set up (PAYMENT_INTAKE_SECRET missing)' })
  const url = new URL(req.url)
  const basic = (req.headers.get('authorization') ?? '').match(/^Basic\s+(.+)$/i)
  let pass = req.headers.get('x-ohvara-intake') ?? url.searchParams.get('key') ?? ''
  if (!pass && basic) { try { pass = atob(basic[1]).split(':').slice(1).join(':') } catch { pass = '' } }
  if (!sameSecret(pass, secret)) return json(401, { error: 'Not allowed' })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json(400, { error: 'Send JSON' }) }
  const m = readInbound(body)
  if (!m.token) return json(200, { status: 'unknown_address' })
  if (!m.messageId) return json(400, { error: 'No message id' })
  const parsed = parseNotice(m.subject, m.text, m.from)
  const out = await store.receive(m.token, m.messageId, m.from.slice(0, 300), m.subject.slice(0, 500), m.text.slice(0, 8000), parsed)
  return json(200, { ...out, kind: parsed.kind })
}
