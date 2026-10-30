// send-agent-invite — the logic, kept free of Supabase/Deno imports so it can
// be exercised with fakes (index.ts wires the real database, env and fetch).
//
// Prompt 731: an agent invites another agent from the account menu. Ohvara
// mints the single-use /join/<token> link and sends it by text or email; the
// agent never sees it. Nothing this returns, and nothing it logs, contains the
// token, the link or the destination.

import { LOCKED_MESSAGE } from '../_shared/portalAccess.ts'

export type Channel = 'email' | 'sms'
export type InviteRole = 'agent' | 'fulfillment'

export type Env = {
  resendKey?: string
  fromEmail?: string
  twilioSid?: string
  twilioToken?: string
  // Prompt 776 — texts go through the Messaging Service, not a bare number.
  twilioService?: string
  appUrl?: string
}

export type Caller = { id: string; role: string | null; is_active: boolean | null; full_name: string | null }

export type Deps = {
  env: Env
  // The signed-in caller from the request's JWT, with their profile; null when the JWT is bad.
  caller(jwt: string): Promise<Caller | null>
  // A self-signup agent who hasn't chosen a plan (_shared/portalAccess.ts).
  lockedSelfSignup(userId: string): Promise<boolean>
  smsLive(): Promise<boolean>
  // Invites this agent created since `since`, optionally only those to one destination.
  countSent(createdBy: string, since: string, dest?: { channel: Channel; to: string }): Promise<number>
  emailHasAccount(email: string): Promise<boolean>
  // End this agent's unused, unexpired invites to the destination (one live link per destination).
  expireLive(createdBy: string, dest: { channel: Channel; to: string }, at: string): Promise<void>
  insertInvite(row: {
    token: string; role: InviteRole; created_by: string; expires_at: string
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
  const twilio = !!(env.twilioSid && env.twilioToken && env.twilioService)
  return { email: emailReady(env), sms: twilio && (await deps.smsLive()) }
}

const firstName = (full: string | null) => (full || '').trim().split(/\s+/)[0] || 'An agent'

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

// Prompt 781 — the role line both the text and the email use.
export const roleLine = (role: InviteRole) => (role === 'fulfillment' ? 'as part of the Fulfillment team' : 'as an agent')

// Prompt 781 — the short /j/<code> link, written without https:// so the text
// reads "portal.ohvara.com/j/…" (phones still make it a link).
export function smsBody(inviter: string, shortLink: string, role: InviteRole = 'agent') {
  return `Ohvara: ${inviter} invited you to join Ohvara ${roleLine(role)}. Create your account: ${shortLink} (expires in 7 days). Reply STOP to opt out.`
}

export function emailContent(inviter: string, link: string, appUrl?: string, role: InviteRole = 'agent') {
  const who = escapeHtml(inviter)
  const href = escapeHtml(link)
  const invitedLine = `${who} invited you to join Ohvara ${roleLine(role)}.`
  const logoUrl = `${(appUrl || 'https://portal.ohvara.com').replace(/\/$/, '')}/email/ohvara-logo-email.png`
  const font = "font-family:'Segoe UI',Helvetica,Arial,sans-serif;"
  return {
    subject: `${inviter} invited you to Ohvara`,
    html:
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">` +
      `<title>${who} invited you to Ohvara</title></head>` +
      `<body style="margin:0;padding:0;background:#EEF1F5;${font}">` +
      `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#EEF1F5;font-size:1px;line-height:1px">${invitedLine}</div>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EEF1F5" style="background:#EEF1F5"><tr><td align="center" style="padding:32px 16px">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:16px;overflow:hidden">` +
      // Hero
      `<tr><td align="center" bgcolor="#0A1F44" style="background:#0A1F44;padding:44px 36px 48px;text-align:center">` +
      `<img src="${logoUrl}" width="72" height="72" alt="Ohvara" style="display:block;margin:0 auto;border:0;outline:none;width:72px;height:72px">` +
      `<div style="${font}font-size:14px;font-weight:700;letter-spacing:3px;color:#FFFFFF;margin-top:10px">OHVARA</div>` +
      `<div style="${font}font-size:32px;font-weight:700;line-height:1.2;color:#FFFFFF;margin:30px 0 10px">You're invited</div>` +
      `<div style="${font}font-size:16px;line-height:1.5;color:#C4CFE3;margin-bottom:30px">${invitedLine}</div>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr>` +
      `<td align="center" bgcolor="#00BFA6" style="background:#00BFA6;border-radius:999px">` +
      `<a href="${href}" style="${font}display:inline-block;padding:15px 34px;font-size:16px;font-weight:700;color:#0A1F44;text-decoration:none;border-radius:999px">Create your account</a>` +
      `</td></tr></table></td></tr>` +
      // Body
      `<tr><td align="center" style="padding:28px 36px 36px;text-align:center">` +
      `<div style="${font}font-size:14px;line-height:1.5;color:#3B4658">This link works once and expires in 7 days.</div>` +
      `<div style="height:1px;line-height:1px;font-size:1px;background:#E3E8EF;margin:24px 0">&nbsp;</div>` +
      `<div style="${font}font-size:12px;line-height:1.6;color:#6B778A">Button not working? Paste this link into your browser:<br>` +
      `<a href="${href}" style="color:#0A1F44;word-break:break-all">${href}</a></div>` +
      `<div style="${font}font-size:12px;line-height:1.6;color:#6B778A;margin-top:20px">You got this email because ${who} invited you. If you weren't expecting it, you can ignore it.</div>` +
      `</td></tr></table>` +
      `<div style="${font}font-size:12px;color:#8A94A6;text-align:center;margin-top:18px">Sent by Ohvara · Questions? <a href="mailto:support@ohvara.com" style="color:#8A94A6">support@ohvara.com</a></div>` +
      `</td></tr></table></body></html>`,
    text: `${inviter} invited you to join Ohvara ${roleLine(role)}.

Create your account: ${link}

This link works once and expires in 7 days.

You got this email because ${inviter} invited you. If you weren't expecting it, you can ignore it.

Questions? support@ohvara.com`,
  }
}

async function deliver(deps: Deps, channel: Channel, to: string, inviter: string, link: string, appUrl: string, role: InviteRole, shortLink: string): Promise<boolean> {
  const { env } = deps
  try {
    if (channel === 'email') {
      const c = emailContent(inviter, link, appUrl, role)
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
      body: new URLSearchParams({ To: to, MessagingServiceSid: env.twilioService!, Body: smsBody(inviter, shortLink, role) }),
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
  // Active agents and admins. Prompt 762: admin's Users page "Add someone"
  // sends here too and can invite Fulfillment; an agent only ever invites agents.
  const isAdmin = caller.role === 'admin'
  if ((caller.role !== 'agent' && !isAdmin) || caller.is_active === false) {
    return { status: 403, body: { error: 'Only agents can send invites.' } }
  }
  const role: InviteRole = isAdmin && body.role === 'fulfillment' ? 'fulfillment' : 'agent'

  if (body.action === 'status') return { status: 200, body: await status(deps) }
  if (body.action !== 'send') return { status: 400, body: { error: 'Unknown action' } }

  // Before anything is made or sent: a free account can't use Ohvara's email
  // and text senders (the inviter's name goes in the subject line). 'status'
  // stays open, it sends nothing and the invite form needs it to show this.
  if (await deps.lockedSelfSignup(caller.id)) return { status: 403, body: { error: LOCKED_MESSAGE } }

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
  const dest: { channel: Channel; to: string } = { channel, to }
  if ((await deps.countSent(caller.id, since)) >= DAILY_LIMIT) return { status: 429, body: { error: MSG.tooMany } }
  if ((await deps.countSent(caller.id, since, dest)) >= PER_DEST_LIMIT) return { status: 429, body: { error: MSG.tooMany } }

  // Reveals that an address is registered; accepted (agents invite people they know).
  if (channel === 'email' && (await deps.emailHasAccount(to))) return { status: 409, body: { error: MSG.hasAccount } }

  // Supersede: the destination keeps one live link. The older rows are expired,
  // not deleted, so they still count toward the limits above.
  await deps.expireLive(caller.id, dest, now.toISOString())

  const token = makeToken(deps.randomBytes(12))
  const id = await deps.insertInvite({
    token, role, created_by: caller.id,
    expires_at: new Date(now.getTime() + WEEK_MS).toISOString(),
    channel, invited_email: channel === 'email' ? to : null, invited_phone: channel === 'sms' ? to : null,
  })

  const appUrl = (deps.env.appUrl || 'https://portal.ohvara.com').replace(/\/$/, '')
  // Prompt 781 — /join?t=<token>; texts use the short /j/<token> (same page).
  const link = `${appUrl}/join?t=${token}`
  const shortLink = `${appUrl.replace(/^https?:\/\//, '')}/j/${token}`
  const ok = await deliver(deps, channel, to, firstName(caller.full_name), link, appUrl, role, shortLink)
  if (!ok) {
    // Never leave a live token that nobody received.
    await deps.deleteInvite(id)
    return { status: 502, body: { error: MSG.failed } }
  }
  return { status: 200, body: { ok: true } }
}
