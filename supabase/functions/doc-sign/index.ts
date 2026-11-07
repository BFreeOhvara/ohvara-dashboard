// doc-sign — P886, the private signing / upload link (/sign/<token> in the app calls this). Logic: core.ts; PDF: pdf.ts.
// Public: the 192-bit token in the link is the key (only its SHA-256 is in the database). Deploy with --no-verify-jwt:
//   npx.cmd supabase functions deploy doc-sign --no-verify-jwt --project-ref jjextitmbptoaolacocs
// Needs the P886 migration (doc_token_*, doc_signed_file) and the policy-docs bucket it makes.
import { createClient } from 'npm:@supabase/supabase-js'
import { handle, type Store, type View } from './core.ts'
import { renderPdf } from './pdf.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const BUCKET = 'policy-docs'

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args)
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return data as T
}

async function file(path: string): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage.from(BUCKET).download(path)
  if (error || !data) return null
  return new Uint8Array(await data.arrayBuffer())
}

const store: Store = {
  view: t => rpc<View>('doc_token_view', { p_token: t }),
  sign: (t, name, consent, ip, ua) => rpc('doc_token_sign', { p_token: t, p_name: name, p_consent: consent, p_ip: ip, p_ua: ua }),
  decline: (t, reason) => rpc('doc_token_decline', { p_token: t, p_reason: reason }),
  async render(v, signers) {
    if (!v.storage_path || !/\.pdf$/i.test(v.storage_path)) return null
    const base = await file(v.storage_path)
    if (!base) return null
    return await renderPdf(base, v.fields ?? [], v.prefill ?? {}, { title: v.title ?? 'Form', documentId: v.document_id ?? '', carrier: v.carrier }, signers)
  },
  async put(path, bytes, contentType) {
    const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false })
    if (error) throw error
  },
  signedFile: (id, path, sha) => rpc('doc_signed_file', { p_doc: id, p_path: path, p_sha256: sha }),
  uploaded: (t, path, sha, ip, ua) => rpc('doc_token_upload', { p_token: t, p_path: path, p_sha256: sha, p_ip: ip, p_ua: ua }),
}

Deno.serve(req => handle(req, store))
