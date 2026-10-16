// Prompt 767 — sends the queued notification emails (notification_emails,
// migration 146) through Resend. pg_cron calls it every minute while anything
// is due, with the x-ohvara-cron secret from Vault; a request from a person is
// refused. The database decides who gets what, the toggles and quiet hours;
// this only claims due rows, sends them and records the result (3 tries, 5
// minutes apart, then 'failed', which shows up in Brayden's 8 AM email).

export type Due = { id: string; to_email: string | null; to_name: string | null; subject: string; body: string; link: string | null; type: string }
export type Mail = { to: string; subject: string; html: string; text: string }

export type Store = {
  cronOk(secret: string): Promise<boolean>
  claim(limit: number): Promise<Due[]>
  finish(id: string, ok: boolean, error?: string): Promise<void>
}
export type Sender = (m: Mail) => Promise<void>

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ohvara-cron',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

// Same card as the pay emails (_shared/fulfillmentPayouts.ts), one button.
export function buildMail(d: Due, appUrl: string): Mail {
  const url = `${appUrl}${d.link && d.link.startsWith('/') ? d.link : '/'}`
  const paras = d.body.split('\n').map(l => l.trim()).filter(Boolean)
  const body = paras.map((l, i) => `<p style="margin:${i ? '8px' : '0'} 0 0">${esc(l)}</p>`).join('')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"></head>` +
    `<body style="margin:0;background:#F6FAF9;font-family:Arial,Helvetica,sans-serif;color:#07332E">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">` +
    `<table role="presentation" width="100%" style="max-width:520px;background:#FFFFFF;border-radius:16px;border:1px solid #D8E6E3">` +
    `<tr><td style="padding:28px 28px 8px;font-size:20px;font-weight:700">${esc(d.subject)}</td></tr>` +
    `<tr><td style="padding:0 28px 24px;font-size:15px;line-height:1.55">${body}` +
    `<p style="margin:20px 0 0"><a href="${esc(url)}" style="color:#00806F;font-weight:700">Open the portal</a></p>` +
    `<p style="margin:16px 0 0;font-size:12px;color:#4F7F78">Turn these emails on or off in Settings → Notifications.</p>` +
    `</td></tr></table></td></tr></table></body></html>`
  const text = `${d.subject}\n\n${paras.join('\n')}\n\n${url}\n\nTurn these emails on or off in Settings → Notifications.`
  return { to: d.to_email || '', subject: d.subject, html, text }
}

export async function sendDue(store: Store, send: Sender, appUrl: string, limit = 25) {
  const due = await store.claim(limit)
  let sent = 0, failed = 0
  for (const d of due) {
    if (!d.to_email) { await store.finish(d.id, false, 'No email address'); failed++; continue }
    try {
      await send(buildMail(d, appUrl))
      await store.finish(d.id, true)
      sent++
    } catch (e) {
      await store.finish(d.id, false, (e as Error).message)
      failed++
    }
  }
  return { claimed: due.length, sent, failed }
}

export async function handle(req: Request, store: Store, send: Sender | null, env: { appUrl: string }) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const secret = req.headers.get('x-ohvara-cron')
  if (!secret || !(await store.cronOk(secret))) return json({ error: 'Not allowed' }, 403)
  // Not configured: leave everything queued rather than burning tries.
  if (!send) return json({ configured: false, sent: 0 })
  try {
    return json({ configured: true, ...(await sendDue(store, send, env.appUrl)) })
  } catch (e) {
    console.error('notify-email failed:', (e as Error).message)
    return json({ error: 'Send failed' }, 500)
  }
}
