// send-agent-invite — the logic, kept free of Supabase/Deno imports so it can
// be exercised with fakes (index.ts wires the real database, env and fetch).
//
// Prompt 731: an agent invites another agent from the account menu. Ohvara
// mints the single-use /join/<token> link and sends it by text or email; the
// agent never sees it. Nothing this returns, and nothing it logs, contains the
// token, the link or the destination.

export type Channel = 'email' | 'sms'

export type Env = {
  resendKey?: string
  fromEmail?: string
  twilioSid?: string
  twilioToken?: string
  twilioFrom?: string
  appUrl?: string
}

export type Caller = { id: string; role: string | null; is_active: boolean | null; full_name: string | null }

export type Deps = {
  env: Env
  // The signed-in caller from the request's JWT, with their profile; null when the JWT is bad.
  caller(jwt: string): Promise<Caller | null>
  smsLive(): Promise<boolean>
  // Invites this agent created since `since`, optionally only those to one destination.
  countSent(createdBy: string, since: string, dest?: { channel: Channel; to: string }): Promise<number>
  emailHasAccount(email: string): Promise<boolean>
  // End this agent's unused, unexpired invites to the destination (one live link per destination).
  expireLive(createdBy: string, dest: { channel: Channel; to: string }, at: string): Promise<void>
  insertInvite(row: {
    token: string; role: 'agent'; created_by: string; expires_at: string
    channel: Channel; invited_email: string | null; invited_phone: string | null
  }): Promise<string>
  deleteInvite(id: string): Promise<void>
  fetch: typeof fetch
  randomBytes(n: number): Uint8Array
  now(): Date
  log(msg: string): void
}

export type Result = { status: number; body: Record<string, unknown> }

export const DAILY_LIMIT = 10
export const PER_DEST_LIMIT = 3
const DAY_MS = 24 * 3600e3
const WEEK_MS = 7 * DAY_MS

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export const MSG = {
  badEmail: 'Enter a valid email',
  badPhone: 'Enter a valid phone number',
  emailSoon: 'Email invites are coming soon.',
  smsSoon: 'Texting invites is coming soon.',
  tooMany: "You've sent a lot of invites today. Try again tomorrow.",
  hasAccount: 'That person already has an account.',
  failed: "Couldn't send that. Try again.",
}

export function toE164(raw: string): string | null {
  const d = String(raw || '').replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return null
}

// Same generator as the admin flow (useCreateInvite): 12 chars, 64-symbol
// URL-safe alphabet, byte % 64 is unbiased.
export function makeToken(bytes: Uint8Array): string {
  return Array.from(bytes, b => ALPHABET[b % 64]).join('')
}

export function emailReady(env: Env) {
  return !!(env.resendKey && env.fromEmail)
}

export async function status(deps: Deps) {
  const { env } = deps
  const twilio = !!(env.twilioSid && env.twilioToken && env.twilioFrom)
  return { email: emailReady(env), sms: twilio && (await deps.smsLive()) }
}

const firstName = (full: string | null) => (full || '').trim().split(/\s+/)[0] || 'An agent'

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function smsBody(inviter: string, link: string) {
  return `${inviter} invited you to Ohvara. Create your account: ${link} (works once, expires in 7 days). Reply STOP to opt out.`
}

export function emailContent(inviter: string, link: string) {
  const who = escapeHtml(inviter)
  return {
    subject: `${inviter} invited you to Ohvara`,
    html:
      `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">` +
      `<p>${who} invited you to sign up for Ohvara.</p>` +
      `<p><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#0D1730;color:#fff;text-decoration:none;font-weight:700">Create your account</a></p>` +
      `<p style="color:#555;font-size:13px">This link works once and expires in 7 days.</p></div>`,
    text: `${inviter} invited you to sign up for Ohvara.\n\nCreate your account: ${link}\n\nThis link works once and expires in 7 days.`,
  }
}

async function deliver(deps: Deps, channel: Channel, to: string, inviter: string, link: string): Promise<boolean> {
  const { env } = deps
  try {
    if (channel === 'email') {
      const c = emailContent(inviter, link)
      // No reply_to: the inviting agent's email is never exposed.
      const res = await deps.fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.fromEmail, to: [to], subject: c.subject, html: c.html, text: c.text }),
      })
      // Only the status and error name: Resend's message can quote the address.
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { name?: string }
        deps.log(`resend ${res.status} ${data?.name ?? ''}`)
      }
      return res.ok
    }
    const res = await deps.fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${env.twilioSid}:${env.twilioToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: env.twilioFrom!, Body: smsBody(inviter, link) }),
    })
    // Only the status and Twilio's error code: its message can quote the number.
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { code?: unknown }
      deps.log(`twilio ${res.status} ${data?.code ?? ''}`)
    }
    return res.ok
  } catch (err) {
    deps.log(`${channel} send threw: ${err instanceof Error ? err.name : 'error'}`)
    return false
  }
}

export async function handle(deps: Deps, jwt: string, body: Record<string, unknown>): Promise<Result> {
  const caller = await deps.caller(jwt)
  if (!caller) return { status: 401, body: { error: 'Unauthorized' } }
  // Agents only, active ones; admin/fulfillment make invites on the Users page.
  if (caller.role !== 'agent' || caller.is_active === false) {
    return { status: 403, body: { error: 'Only agents can send invites.' } }
  }

  if (body.action === 'status') return { status: 200, body: await status(deps) }
  if (body.action !== 'send') return { status: 400, body: { error: 'Unknown action' } }

  const channel = body.channel
  if (channel !== 'email' && channel !== 'sms') return { status: 400, body: { error: 'Pick text or email' } }

  let to: string | null
  if (channel === 'email') {
    const e = String(body.to ?? '').trim().toLowerCase()
    to = EMAIL_RE.test(e) ? e : null
    if (!to) return { status: 400, body: { error: MSG.badEmail } }
  } else {
    to = toE164(String(body.to ?? ''))
    if (!to) return { status: 400, body: { error: MSG.badPhone } }
  }

  const avail = await status(deps)
  if (!avail[channel]) return { status: 409, body: { error: channel === 'email' ? MSG.emailSoon : MSG.smsSoon } }

  const now = deps.now()
  const since = new Date(now.getTime() - DAY_MS).toISOString()
  const dest = { channel, to }
  if ((await deps.countSent(caller.id, since)) >= DAILY_LIMIT) return { status: 429, body: { error: MSG.tooMany } }
  if ((await deps.countSent(caller.id, since, dest)) >= PER_DEST_LIMIT) return { status: 429, body: { error: MSG.tooMany } }

  // Reveals that an address is registered; accepted (agents invite people they know).
  if (channel === 'email' && (await deps.emailHasAccount(to))) return { status: 409, body: { error: MSG.hasAccount } }

  // Supersede: the destination keeps one live link. The older rows are expired,
  // not deleted, so they still count toward the limits above.
  await deps.expireLive(caller.id, dest, now.toISOString())

  const token = makeToken(deps.randomBytes(12))
  const id = await deps.insertInvite({
    token, role: 'agent', created_by: caller.id,
    expires_at: new Date(now.getTime() + WEEK_MS).toISOString(),
    channel, invited_email: channel === 'email' ? to : null, invited_phone: channel === 'sms' ? to : null,
  })

  const link = `${(deps.env.appUrl || 'https://portal.ohvara.com').replace(/\/$/, '')}/join/${token}`
  const ok = await deliver(deps, channel, to, firstName(caller.full_name), link)
  if (!ok) {
    // Never leave a live token that nobody received.
    await deps.deleteInvite(id)
    return { status: 502, body: { error: MSG.failed } }
  }
  return { status: 200, body: { ok: true } }
}
