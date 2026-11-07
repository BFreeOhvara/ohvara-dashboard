// doc-sign core — P886. The page a client's private link opens: see the form, sign it (typed name + consent), decline,
// or send a photo / file (POA, a carrier letter). No network or database here: everything goes through Store, so
// node tests cover it (core.test.ts). index.ts wires Store to Supabase and pdf.ts (pdf-lib) for the PDF work.
//
// GET  ?t=<token>                         → what the link is for (+ the prefilled PDF to read, base64)
// POST {action:'sign', t, name, consent}  → one signer signs; the last signer's sign stamps and stores the PDF
// POST {action:'decline', t, reason}
// POST {action:'upload', t, file, type, name} → file is base64 (≤ 10 MB): pdf, jpg, png, heic, webp

export const CONSENT_VERSION = 'esign-v1'
// DRAFT wording, needs Brayden's OK before going live (legal wording people read).
export const CONSENT_TEXT =
  'I agree to sign this form electronically. My typed name is my signature and has the same effect as signing ' +
  'on paper. I can ask Deedstone for a paper copy at no cost, and I can choose not to sign.'

export const MAX_UPLOAD = 10 * 1024 * 1024
export const UPLOAD_TYPES: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp',
}

export type Signer = { role: string; name: string; signed_name: string | null; signed_at: string | null; ip: string | null; ua: string | null; consent_version: string | null }
export type View = {
  state: 'not_found' | 'void' | 'signed' | 'declined' | 'done' | 'expired' | 'sign' | 'upload'
  mode?: 'sign' | 'upload'; signer_id?: string; document_id?: string; policy_id?: string; name?: string; role?: string
  title?: string; doc_type?: string; carrier?: string | null; storage_path?: string | null; template_id?: string | null
  prefill?: Record<string, string>; fields?: Field[]; consent_version?: string; others?: { role: string; name: string; signed: boolean }[]
}
export type Field = { key: string; page?: number; x: number; y: number; size?: number }
export type SignResult = { all_signed: boolean; document_id: string; policy_id: string; signers: Signer[] }

export type Store = {
  view(token: string): Promise<View>
  sign(token: string, name: string, consent: boolean, ip: string | null, ua: string | null): Promise<SignResult>
  decline(token: string, reason: string): Promise<void>
  // Renders the form with its prefill (and, when given, the signatures + audit page). Null = no PDF to show.
  render(view: View, signers?: Signer[]): Promise<Uint8Array | null>
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>
  signedFile(documentId: string, path: string, sha256: string): Promise<void>
  uploaded(token: string, path: string, sha256: string, ip: string | null, ua: string | null): Promise<string>
}

export const ROLE_WORD: Record<string, string> = {
  owner: 'Policy owner', joint_owner: 'Joint owner', insured: 'Insured', irrevocable_beneficiary: 'Irrevocable beneficiary',
  payor: 'Payor', poa: 'Power of attorney', uploader: 'Client',
}

export const validToken = (t: unknown): t is string => typeof t === 'string' && /^[0-9a-f]{48}$/.test(t)

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '')
  const bin = atob(clean)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
export function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

// What the page needs, without internals (no paths, ids of other rows or field coordinates).
export function publicView(v: View) {
  if (!['sign', 'upload'].includes(v.state)) return { state: v.state, title: v.title ?? null }
  return {
    state: v.state, mode: v.mode, title: v.title, carrier: v.carrier ?? null, name: v.name,
    role: ROLE_WORD[v.role ?? ''] ?? v.role, others: (v.others ?? []).map(o => ({ role: ROLE_WORD[o.role] ?? o.role, name: o.name, signed: o.signed })),
    consent: v.mode === 'sign' ? { version: CONSENT_VERSION, text: CONSENT_TEXT } : null,
  }
}

export function clientIp(req: Request): string | null {
  const f = req.headers.get('x-forwarded-for')
  return (f ? f.split(',')[0].trim() : req.headers.get('x-real-ip')) || null
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization, apikey', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
// Postgres raises plain-words messages (22023 / P0002); pass those on, hide anything else.
const said = (e: unknown) => {
  const m = (e as { message?: string; code?: string })?.message ?? ''
  const code = (e as { code?: string })?.code ?? ''
  return code === '22023' || code === 'P0002' ? m : 'Something went wrong. Try again, or call us.'
}

export async function handle(req: Request, store: Store): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  const ip = clientIp(req)
  const ua = req.headers.get('user-agent')
  if (req.method === 'GET') {
    const t = new URL(req.url).searchParams.get('t')
    if (!validToken(t)) return json({ state: 'not_found' }, 404)
    const v = await store.view(t)
    const out: Record<string, unknown> = publicView(v)
    if (v.state === 'sign') {
      const pdf = await store.render(v)
      out.pdf = pdf ? bytesToB64(pdf) : null
    }
    return json(out, v.state === 'not_found' ? 404 : 200)
  }
  if (req.method !== 'POST') return json({ error: 'GET or POST' }, 405)
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
  const t = body.t
  if (!validToken(t)) return json({ error: 'This link isn’t valid' }, 404)
  try {
    if (body.action === 'sign') {
      const name = String(body.name ?? '').trim()
      if (name.length < 2) return json({ error: 'Type your full name' }, 400)
      if (body.consent !== true) return json({ error: 'Tick the box to agree to sign electronically' }, 400)
      const view = await store.view(t)
      const r = await store.sign(t, name, true, ip, ua)
      if (r.all_signed) await finalize(store, view, r)
      return json({ state: 'signed', all_signed: r.all_signed })
    }
    if (body.action === 'decline') {
      await store.decline(t, String(body.reason ?? '').slice(0, 300))
      return json({ state: 'declined' })
    }
    if (body.action === 'upload') {
      const type = String(body.type ?? '')
      const ext = UPLOAD_TYPES[type]
      if (!ext) return json({ error: 'Send a photo or a PDF' }, 400)
      const bytes = b64ToBytes(String(body.file ?? ''))
      if (bytes.length === 0) return json({ error: 'The file is empty' }, 400)
      if (bytes.length > MAX_UPLOAD) return json({ error: 'That file is over 10 MB. Try a smaller photo.' }, 400)
      const v = await store.view(t)
      if (v.state !== 'upload' || !v.policy_id || !v.document_id) return json({ error: 'This link ran out. Ask us for a new one.' }, 400)
      const sha = await sha256Hex(bytes)
      const path = `${v.policy_id}/${v.document_id}/upload-${sha.slice(0, 12)}.${ext}`
      await store.put(path, bytes, type)
      await store.uploaded(t, path, sha, ip, ua)
      return json({ state: 'done' })
    }
    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: said(e) }, 400)
  }
}

// The last signature: stamp the form (signatures + audit page), store it, mark it signed.
export async function finalize(store: Store, view: View, r: SignResult) {
  const pdf = await store.render(view, r.signers)
  if (!pdf) throw Object.assign(new Error('The form couldn’t be finished. We’ll call you.'), { code: '22023' })
  const sha = await sha256Hex(pdf)
  const path = `${r.policy_id}/${r.document_id}/signed-${sha.slice(0, 12)}.pdf`
  await store.put(path, pdf, 'application/pdf')
  await store.signedFile(r.document_id, path, sha)
  return { path, sha }
}
