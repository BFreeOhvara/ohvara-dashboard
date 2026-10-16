// Prompt 767 — notification email sender. Deploy with --no-verify-jwt: the
// only caller is pg_cron, checked by the x-ohvara-cron Vault secret in core.ts.
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, type Store, type Sender } from './core.ts'

const RESEND = Deno.env.get('RESEND_API_KEY')
const FROM = Deno.env.get('INVITE_FROM_EMAIL')
const APP_URL = (Deno.env.get('PUBLIC_APP_URL') || 'https://portal.ohvara.com').replace(/\/$/, '')
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const store: Store = {
  async cronOk(secret) {
    const { data } = await db.rpc('fulfillment_cron_ok', { p_secret: secret })
    return data === true
  },
  async claim(limit) {
    const { data, error } = await db.rpc('notify_claim_emails', { p_limit: limit })
    if (error) throw error
    return data || []
  },
  async finish(id, ok, error) {
    await db.rpc('notify_finish_email', { p_id: id, p_ok: ok, p_error: error ?? null })
  },
}

const send: Sender | null = RESEND && FROM ? async m => {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
  })
  if (!res.ok) throw new Error(`resend ${res.status}`)
} : null

Deno.serve(req => handle(req, store, send, { appUrl: APP_URL }))
