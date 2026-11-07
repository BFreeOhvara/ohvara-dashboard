// doc-send — P886, faxes and emails signed forms to carriers. Logic: core.ts. pg_cron calls it each minute a send is
// queued (job doc-send, x-ohvara-cron). SANDBOX until doc_settings.send_live is switched on (Brayden's call).
//   npx.cmd supabase functions deploy doc-send --no-verify-jwt --project-ref jjextitmbptoaolacocs
// Live fax (Telnyx, recommended): TELNYX_API_KEY, TELNYX_FAX_CONNECTION_ID, doc_settings.fax_from + fax_provider
//   'telnyx', and the fax webhook pointed at .../doc-send?hook=fax&key=<DOC_FAX_WEBHOOK_SECRET>.
// Live email: RESEND_API_KEY (already set for notify-email) + doc_settings.email_from.
import { createClient } from 'npm:@supabase/supabase-js'
import { isCron } from '../_shared/cronAuth.ts'
import { handle, e164, type Claimed, type Store, type Senders } from './core.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const BUCKET = 'policy-docs'

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

const store: Store = {
  claim: limit => rpc<Claimed[]>('doc_sends_claim', { p_limit: limit }),
  result: (id, status, failure, receipt, ref, pages) =>
    rpc('doc_send_result', { p_send: id, p_status: status, p_failure: failure, p_receipt: receipt, p_provider_ref: ref, p_pages: pages }),
  async byProviderRef(ref) {
    const { data } = await admin.from('doc_sends').select('id').eq('provider_ref', ref).maybeSingle()
    return data?.id ?? null
  },
  async setProviderRef(id, ref) {
    await admin.from('doc_sends').update({ provider_ref: ref }).eq('id', id)
  },
}

async function settings() {
  const { data } = await admin.from('doc_settings').select('fax_from, email_from').single()
  return data ?? { fax_from: null, email_from: null }
}

const senders: Senders = {
  async fax(c) {
    const key = Deno.env.get('TELNYX_API_KEY'), conn = Deno.env.get('TELNYX_FAX_CONNECTION_ID')
    const { fax_from } = await settings()
    if (!key || !conn || !fax_from) return { status: 'failed', failure: 'Fax isn’t set up yet (no account or sending number)' }
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(c.path!, 3600)
    if (!signed?.signedUrl) return { status: 'failed', failure: 'The file is missing from the policy' }
    const res = await fetch('https://api.telnyx.com/v2/faxes', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: conn, media_url: signed.signedUrl, to: e164(c.destination), from: e164(fax_from) }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { status: 'failed', failure: `Fax service refused it (${res.status})` }
    return { status: 'sending', providerRef: body?.data?.id }
  },
  async email(c) {
    const key = Deno.env.get('RESEND_API_KEY')
    const { email_from } = await settings()
    if (!key || !email_from) return { status: 'failed', failure: 'Email sending isn’t set up yet' }
    const { data: blob } = await admin.storage.from(BUCKET).download(c.path!)
    if (!blob) return { status: 'failed', failure: 'The file is missing from the policy' }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let b64 = ''
    for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: email_from, to: [c.destination],
        subject: `${c.title}: ${c.client}${c.policy_number ? `, policy ${c.policy_number}` : ''}`,
        text: `Please find attached the ${c.title} for ${c.client}${c.policy_number ? ` (policy ${c.policy_number})` : ''}. Reply to this email to confirm you received it.`,
        attachments: [{ filename: `${c.title.replace(/[^\w ]+/g, '').trim() || 'form'}.pdf`, content: btoa(b64) }],
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { status: 'failed', failure: `Email service refused it (${res.status})` }
    return { status: 'delivered', providerRef: body?.id, receipt: { provider: 'resend', id: body?.id ?? null, to: c.destination } }
  },
}

Deno.serve(req => handle(req, store, senders, { isCron: () => isCron(req, admin), hookSecret: Deno.env.get('DOC_FAX_WEBHOOK_SECRET') }))
