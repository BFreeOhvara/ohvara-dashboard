// P886 — documents on a policy: words, the carrier's send channel, the replacement gate, and the real calls (the RPCs in
// supabase/migrations/239_documents.sql). The screens run on sample data (src/template/docs886) until 848/852 wire
// these in; the words and rules here are shared by both, so sample and real read the same.

export const DOC_TYPE = {
  cancellation_request: 'Cancellation request', beneficiary_change: 'Beneficiary change', owner_change: 'Owner change',
  amendment: 'Amendment', payment_change: 'Payment change', address_change: 'Address change', name_change: 'Name change',
  poa: 'Power of attorney', carrier_letter: 'Carrier letter', certificate: 'Certificate', claim_form: 'Claim form',
  death_certificate: 'Death certificate', id_document: 'ID', other: 'Other',
}
export const SIGNER_ROLE = {
  owner: 'Policy owner', joint_owner: 'Joint owner', insured: 'Insured', irrevocable_beneficiary: 'Irrevocable beneficiary',
  payor: 'Payor', poa: 'Power of attorney', uploader: 'Client',
}
// [tone, words] for a document's status.
export const DOC_STATUS = {
  out_for_signature: ['blue', 'Out for signature'], signed: ['green', 'Signed'], declined: ['warn', 'Declined'],
  expired: ['warn', 'Link ran out'], awaiting_upload: ['blue', 'Waiting for the file'], on_file: ['green', 'On file'],
  void: ['mute', 'Void'],
}
export const CHANNEL = { fax: 'Fax', email: 'Email', upload: 'Carrier upload', agent_portal: 'Agent’s portal' }
// [tone, words] for a send.
export const SEND_STATUS = {
  queued: ['blue', 'Queued'], sending: ['blue', 'Sending'], delivered: ['teal', 'Delivered, confirm it'],
  failed: ['warn', 'Failed'], received: ['green', 'Carrier has it'], not_received: ['warn', 'Carrier says not received'],
}
export const SOURCE = { esign: 'E-signed', va_upload: 'Uploaded by the team', agent_upload: 'Uploaded by the agent', client_upload: 'Sent by the client', carrier: 'From the carrier' }

export const MAX_ATTEMPTS = 3

// A fax number as 10 digits, shown (512) 555-0199.
export const faxDigits = v => { const d = String(v || '').replace(/\D/g, ''); return d.length === 10 ? d : d.length === 11 && d[0] === '1' ? d.slice(1) : null }
export const showFax = d => (d && d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d || '')
export const validEmail = v => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(v || '').trim())

// The address a carrier gives for a channel.
export const addressFor = (carrier, channel) => (channel === 'fax' ? carrier?.docs_fax : channel === 'email' ? carrier?.docs_email : channel === 'upload' ? carrier?.docs_upload_url : null) || null

// Like doc_pick_channel: the first channel in the carrier's order that has an address (agent_portal needs none).
export function pickChannel(carrier) {
  for (const c of carrier?.docs_channels || []) if (c === 'agent_portal' || addressFor(carrier, c)) return c
  return null
}

// The address shown for a send, in words.
export const sendTo = s => (s.channel === 'fax' ? showFax(s.destination) : s.channel === 'agent_portal' ? 'the agent uploads it' : s.destination)

// What a document still needs, for its next button: sign | send | confirm | retry | none.
export function nextStep(doc) {
  if (!doc || doc.status === 'void') return 'none'
  if (doc.status === 'out_for_signature' || doc.status === 'awaiting_upload') return 'wait'
  if (doc.status === 'declined' || doc.status === 'expired') return 'relink'
  const last = doc.sends?.[0]
  if (!last) return 'send'
  if (last.status === 'delivered') return 'confirm'
  if (last.status === 'failed' || last.status === 'not_received') return (doc.sends.length >= MAX_ATTEMPTS ? 'call' : 'retry')
  return last.status === 'received' ? 'none' : 'wait'
}

// The replacement gate (replacement_gate_state): what it still waits for, in words. P899: the old policy can go once
// the new one is issued (no wait for its first payment), timed to stop the old policy's next draft (cancel_by).
export function gateWords(g) {
  if (!g?.applies) return null
  if (g.open) return g.override ? `Opened by an admin: ${g.override}` : g.cancel_by ? `New policy issued. Cancel the old one by ${g.cancel_by}, before its ${g.old_draft} draft, so they never pay twice.` : 'New policy issued. Cancel the old one before its next draft.'
  return 'Waiting until the new policy is issued. The old policy stays until then, so they’re never without cover.'
}

export const signLink = (token, origin = typeof window !== 'undefined' ? window.location.origin : '') => `${origin}/sign/${token}`

// ── Real calls (848/852 wire the screens to these) ────────────────────────────
const call = async (db, fn, args) => { const { data, error } = await db.rpc(fn, args); if (error) throw error; return data }
export const docsApi = db => ({
  forPolicy: policy => call(db, 'policy_documents_for', { p_policy: policy }),
  startSigning: ({ policy, docType, title, signers, template = null, storagePath = null, task = null, carrier = null }) =>
    call(db, 'doc_start_signing', { p_policy: policy, p_doc_type: docType, p_title: title, p_signers: signers, p_template: template, p_storage_path: storagePath, p_task: task, p_carrier: carrier }),
  newLink: signer => call(db, 'doc_new_link', { p_signer: signer }),
  void: (doc, reason) => call(db, 'doc_void', { p_doc: doc, p_reason: reason }),
  requestUpload: ({ policy, docType, title, name, task = null }) => call(db, 'doc_request_upload', { p_policy: policy, p_doc_type: docType, p_title: title, p_name: name, p_task: task }),
  registerUpload: ({ policy, docType, title, path, sha256 = null, date = null, task = null, fromCarrier = false }) =>
    call(db, 'doc_register_upload', { p_policy: policy, p_doc_type: docType, p_title: title, p_path: path, p_sha256: sha256, p_document_date: date, p_task: task, p_from_carrier: fromCarrier }),
  send: (doc, channel = null, destination = null, retryOf = null) => call(db, 'doc_send_request', { p_doc: doc, p_channel: channel, p_destination: destination, p_retry_of: retryOf }),
  markSent: (send, ok, failure = null) => call(db, 'doc_send_result', { p_send: send, p_status: ok ? 'delivered' : 'failed', p_failure: failure }),
  confirm: (send, received, note = null) => call(db, 'doc_send_confirm', { p_send: send, p_received: received, p_note: note }),
  carrierDocs: ({ carrier, fax = null, email = null, uploadUrl = null, channels = null, notes = null }) =>
    call(db, 'carrier_docs_update', { p_carrier: carrier, p_fax: fax, p_email: email, p_upload_url: uploadUrl, p_channels: channels, p_notes: notes }),
  gate: policy => call(db, 'replacement_gate_state', { p_policy: policy }),
  markGate: (policy, what, on, how = null) => call(db, 'replacement_mark', { p_policy: policy, p_what: what, p_on: on, p_how: how }),
  overrideGate: (policy, reason) => call(db, 'replacement_override', { p_policy: policy, p_reason: reason }),
})
