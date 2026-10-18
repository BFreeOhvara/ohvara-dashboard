// Prompt 781 — "Confirm your email" for accounts made from a text invite.
// claim-invite sends the first one; account-email confirms it and resends.
// Mail goes through Resend (RESEND_API_KEY + INVITE_FROM_EMAIL), the same
// sender as invite emails. Only the token's sha-256 is stored.
import type { SupabaseClient } from 'npm:@supabase/supabase-js'

export const CONFIRM_TTL_MS = 7 * 24 * 3600e3

export async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}

function newToken() {
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const appUrl = () => (Deno.env.get('PUBLIC_APP_URL') || 'https://portal.ohvara.com').replace(/\/$/, '')

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function confirmEmailContent(link: string, base: string) {
  const href = escapeHtml(link)
  const logoUrl = `${base}/email/ohvara-logo-email.png`
  const font = "font-family:'Segoe UI',Helvetica,Arial,sans-serif;"
  return {
    subject: 'Confirm your email for Ohvara',
    html:
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">` +
      `<title>Confirm your email</title></head>` +
      `<body style="margin:0;padding:0;background:#EEF1F5;${font}">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EEF1F5" style="background:#EEF1F5"><tr><td align="center" style="padding:32px 16px">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:16px;overflow:hidden">` +
      `<tr><td align="center" bgcolor="#0A1F44" style="background:#0A1F44;padding:40px 36px 44px;text-align:center">` +
      `<img src="${logoUrl}" width="64" height="64" alt="Ohvara" style="display:block;margin:0 auto;border:0;outline:none;width:64px;height:64px">` +
      `<div style="${font}font-size:28px;font-weight:700;line-height:1.2;color:#FFFFFF;margin:26px 0 10px">Confirm your email</div>` +
      `<div style="${font}font-size:16px;line-height:1.5;color:#C4CFE3;margin-bottom:28px">Tap the button so this address can reset your Ohvara password.</div>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr>` +
      `<td align="center" bgcolor="#00BFA6" style="background:#00BFA6;border-radius:999px">` +
      `<a href="${href}" style="${font}display:inline-block;padding:15px 34px;font-size:16px;font-weight:700;color:#0A1F44;text-decoration:none;border-radius:999px">Confirm email</a>` +
      `</td></tr></table></td></tr>` +
      `<tr><td align="center" style="padding:26px 36px 34px;text-align:center">` +
      `<div style="${font}font-size:14px;line-height:1.5;color:#3B4658">This link works for 7 days.</div>` +
      `<div style="height:1px;line-height:1px;font-size:1px;background:#E3E8EF;margin:22px 0">&nbsp;</div>` +
      `<div style="${font}font-size:12px;line-height:1.6;color:#6B778A">Button not working? Paste this link into your browser:<br>` +
      `<a href="${href}" style="color:#0A1F44;word-break:break-all">${href}</a></div>` +
      `<div style="${font}font-size:12px;line-height:1.6;color:#6B778A;margin-top:18px">You got this because an Ohvara account was made with this email. If that wasn't you, write to support@ohvara.com.</div>` +
      `</td></tr></table>` +
      `<div style="${font}font-size:12px;color:#8A94A6;text-align:center;margin-top:18px">Sent by Ohvara · Questions? <a href="mailto:support@ohvara.com" style="color:#8A94A6">support@ohvara.com</a></div>` +
      `</td></tr></table></body></html>`,
    text: `Confirm your email for Ohvara: ${link}

This link works for 7 days. If you didn't make an Ohvara account, write to support@ohvara.com.`,
  }
}

// Mints a new link for the user and mails it. false = not sent (no sender set
// up, or Resend refused); the account still works, the banner stays.
export async function sendConfirmEmail(db: SupabaseClient, userId: string, email: string): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('INVITE_FROM_EMAIL')
  if (!key || !from) { console.error('[confirm-email] no sender configured'); return false }
  const token = newToken()
  const { error } = await db.from('email_confirm_tokens').insert({
    token_hash: await sha256Hex(token), user_id: userId,
    expires_at: new Date(Date.now() + CONFIRM_TTL_MS).toISOString(),
  })
  if (error) { console.error('[confirm-email] token insert failed:', error.message); return false }
  const base = appUrl()
  const c = confirmEmailContent(`${base}/confirm-email?t=${token}`, base)
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [email], subject: c.subject, html: c.html, text: c.text }),
    })
    if (!res.ok) console.error('[confirm-email] resend', res.status)
    return res.ok
  } catch (err) {
    console.error('[confirm-email] send threw:', err instanceof Error ? err.name : 'error')
    return false
  }
}
