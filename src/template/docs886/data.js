import { useSyncExternalStore } from 'react'
import { pickChannel, addressFor, faxDigits, validEmail, MAX_ATTEMPTS } from '../../lib/documents.js'

// P886 — documents on a policy, sample only (the sample day is Thu, Nov 5). One store shared by the VA side, the agent
// side and the /sign page, keyed by the client's name so both sides see the same papers. Nothing leaves the browser:
// a "send" behaves like the sandbox (delivered at once; a fax number ending 0000 or an email starting fail@ fails).
// The real screens read the same shapes from policy_documents_for() (src/lib/documents.js docsApi), wired by 848/852.

const at = t => `Nov ${t}`
let n = 100
const id = p => `${p}-${++n}`
const tok = () => Array.from({ length: 48 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')

// Where each carrier takes documents (carriers.docs_*). Unknown carriers have nothing yet.
const seedCarriers = {
  'Mutual of Omaha': { docs_fax: '4025550160', docs_email: 'service@mutual.example', docs_channels: ['fax', 'email'] },
  'Harborline Life': { docs_channels: ['agent_portal'], docs_notes: 'Producer portal only. The agent uploads.' },
  'Globe Life': { docs_fax: '8005550142', docs_channels: ['fax'], docs_notes: 'Cancellations by signed request only.' },
  'Americo': { docs_email: 'policyservice@americo.example', docs_channels: ['email'] },
  'AARP / New York Life': { docs_fax: '8005550188', docs_channels: ['fax'] },
  'Colonial Penn': { docs_upload_url: 'https://forms.colonialpenn.example/upload', docs_channels: ['upload', 'fax'], docs_fax: '8005550119' },
}

// Carrier forms (doc_templates). carrier null = works for any carrier.
export const TEMPLATES = [
  { id: 'tp-cx', carrier: null, doc_type: 'cancellation_request', name: 'Cancellation request (any carrier)', form: 'Ohvara CX-1', roles: ['owner'] },
  { id: 'tp-ben', carrier: null, doc_type: 'beneficiary_change', name: 'Change of beneficiary (any carrier)', form: 'Ohvara BEN-1', roles: ['owner'] },
  { id: 'tp-mo-ben', carrier: 'Mutual of Omaha', doc_type: 'beneficiary_change', name: 'Mutual of Omaha change of beneficiary', form: 'MO-BEN-7', roles: ['owner', 'irrevocable_beneficiary'] },
  { id: 'tp-mo-addr', carrier: 'Mutual of Omaha', doc_type: 'address_change', name: 'Mutual of Omaha address change', form: 'MO-ADR-2', roles: ['owner'] },
  { id: 'tp-own', carrier: null, doc_type: 'owner_change', name: 'Change of owner (any carrier)', form: 'Ohvara OWN-1', roles: ['owner', 'joint_owner'] },
]

const signer = (role, name, o = {}) => ({ id: id('sg'), role, name, signed_at: null, viewed_at: null, declined_at: null, token: tok(), ...o })
const send = (channel, destination, status, o = {}) => ({ id: id('sd'), channel, destination, status, attempt: 1, sandbox: true, failure_reason: null, at: 'Thu 9:12 AM', ...o })

const seedDocs = {
  'Denise Walker': [
    { id: 'dc-1', doc_type: 'beneficiary_change', title: 'Mutual of Omaha change of beneficiary', source: 'esign', status: 'signed', carrier: 'Mutual of Omaha', date: at(4), task: 'st-3',
      signers: [signer('owner', 'Denise Walker', { signed_at: 'Wed 4:02 PM', viewed_at: 'Wed 3:58 PM' }), signer('irrevocable_beneficiary', 'Marcus Walker', { signed_at: 'Wed 6:40 PM', viewed_at: 'Wed 6:31 PM' })],
      sends: [send('fax', '4025550160', 'failed', { failure_reason: 'Busy signal after 3 tries', at: 'Thu 8:30 AM' })] },
  ],
  'Ann Lee': [
    { id: 'dc-2', doc_type: 'payment_change', title: 'Harborline payment change form', source: 'esign', status: 'signed', carrier: 'Harborline Life', date: at(4),
      signers: [signer('owner', 'Ann Lee', { signed_at: 'Wed 11:15 AM' })], sends: [send('agent_portal', null, 'sending', { at: 'Wed 11:20 AM' })] },
    { id: 'dc-3', doc_type: 'carrier_letter', title: 'Lapse pending notice', source: 'client_upload', status: 'on_file', carrier: 'Harborline Life', date: at(3), signers: [], sends: [] },
  ],
  'Walter Price': [
    { id: 'dc-4', doc_type: 'cancellation_request', title: 'Cancellation request (AARP / New York Life)', source: 'esign', status: 'signed', carrier: 'AARP / New York Life', date: at(2),
      signers: [signer('owner', 'Walter Price', { signed_at: 'Mon 2:10 PM' })], sends: [] },
  ],
  'Harold Nguyen': [
    { id: 'dc-5', doc_type: 'cancellation_request', title: 'Cancellation request (Colonial Penn)', source: 'esign', status: 'signed', carrier: 'Colonial Penn', date: at(4),
      signers: [signer('owner', 'Harold Nguyen', { signed_at: 'Wed 10:05 AM' })],
      sends: [send('upload', 'https://forms.colonialpenn.example/upload', 'delivered', { at: 'Wed 10:30 AM', confirm_due: 'Mon by 5 PM' })] },
  ],
}

// The replacement gate per client who is replacing an old policy (replacement_gate_state).
const seedGates = {
  'Gloria Santos': { applies: true, issued_on: 'Nov 2', first_payment_on: null },
  'Harold Nguyen': { applies: true, issued_on: 'Oct 20', first_payment_on: 'Nov 1' },
  'Walter Price': { applies: true, issued_on: null, first_payment_on: null },
  'Denise Walker': { applies: true, issued_on: 'Oct 14', first_payment_on: 'Oct 28' },
  'Luis Ortega': { applies: true, issued_on: 'Oct 9', first_payment_on: 'Oct 23' },
}

let state = { carriers: seedCarriers, docs: seedDocs, gates: seedGates, sendLive: false }
const listeners = new Set()
const set = fn => { state = { ...state, ...fn(state) }; listeners.forEach(l => l()) }
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
const useStore = () => useSyncExternalStore(subscribe, () => state)

const gateOf = (s, who) => {
  const g = s.gates[who]
  if (!g?.applies) return { applies: false, open: true, waiting_for: [] }
  const waiting_for = [!g.issued_on && 'issued', !g.first_payment_on && 'first_payment'].filter(Boolean)
  return { ...g, open: waiting_for.length === 0 || !!g.override, waiting_for: g.override ? [] : waiting_for }
}
const carrierOf = (s, name) => ({ name, docs_channels: [], ...(s.carriers[name] || {}) })

export function useDocs(who) { const s = useStore(); return { docs: s.docs[who] || [], gate: gateOf(s, who) } }
export function useGate(who) { const s = useStore(); return gateOf(s, who) }
export function useCarrierDocs(name) { const s = useStore(); return carrierOf(s, name) }
// The /sign page: find the signer by their link.
export function useByToken(token) {
  const s = useStore()
  for (const [who, docs] of Object.entries(s.docs)) for (const d of docs) for (const g of d.signers) if (g.token === token) return { who, d, g }
  return null
}

const patchDoc = (s, who, docId, fn) => ({ docs: { ...s.docs, [who]: (s.docs[who] || []).map(d => (d.id === docId ? fn(d) : d)) } })
const testFail = (channel, dest) => (channel === 'fax' ? /0000$/.test(dest || '') : /^fail[@+]/i.test(dest || ''))

export const docActions = {
  startSigning: (who, { template, doc_type, title, carrier, signers, task }) => {
    const d = { id: id('dc'), doc_type, title, source: 'esign', status: 'out_for_signature', carrier, date: 'Nov 5', task, template,
      signers: signers.map(x => signer(x.role, x.name)), sends: [] }
    set(s => ({ docs: { ...s.docs, [who]: [d, ...(s.docs[who] || [])] } }))
    return d
  },
  requestUpload: (who, { doc_type, title, carrier, task }) => {
    const d = { id: id('dc'), doc_type, title, source: 'client_upload', status: 'awaiting_upload', carrier, date: 'Nov 5', task, signers: [signer('uploader', who)], sends: [] }
    set(s => ({ docs: { ...s.docs, [who]: [d, ...(s.docs[who] || [])] } }))
    return d
  },
  // The client signs on their phone (or, on sample data, the VA presses "Sample: they signed").
  sign: (who, docId, signerId, name) => set(s => patchDoc(s, who, docId, d => {
    const signers = d.signers.map(g => (g.id === signerId ? { ...g, signed_at: 'Thu now', signed_name: name || g.name, viewed_at: g.viewed_at || 'Thu now' } : g))
    return { ...d, signers, status: signers.every(g => g.signed_at) ? 'signed' : d.status }
  })),
  signAll: (who, docId) => set(s => patchDoc(s, who, docId, d => ({ ...d, status: 'signed', signers: d.signers.map(g => ({ ...g, signed_at: g.signed_at || 'Thu now' })) }))),
  decline: (who, docId, signerId, reason) => set(s => patchDoc(s, who, docId, d => ({ ...d, status: 'declined', signers: d.signers.map(g => (g.id === signerId ? { ...g, declined_at: 'Thu now', decline_reason: reason } : g)) }))),
  uploaded: (who, docId) => set(s => patchDoc(s, who, docId, d => ({ ...d, status: 'on_file', signers: d.signers.map(g => ({ ...g, signed_at: 'Thu now' })) }))),
  newLink: (who, docId, signerId) => set(s => patchDoc(s, who, docId, d => ({ ...d, status: d.source === 'client_upload' ? 'awaiting_upload' : 'out_for_signature',
    signers: d.signers.map(g => (g.id === signerId ? { ...g, token: tok(), declined_at: null, decline_reason: null } : g)) }))),
  void: (who, docId, reason) => set(s => patchDoc(s, who, docId, d => ({ ...d, status: 'void', void_reason: reason }))),
  // Like doc_send_request + the sandbox run. Returns an error string, or null.
  send: (who, docId, { channel, destination }) => {
    const s = state
    const d = (s.docs[who] || []).find(x => x.id === docId)
    if (!d) return 'Document not found'
    if (!['signed', 'on_file'].includes(d.status)) return 'Only a signed form or a file on the policy can be sent'
    if (d.doc_type === 'cancellation_request' && !gateOf(s, who).open) return 'Not yet: the old policy is cancelled only after the new one is issued and its first payment clears.'
    if (d.sends.length >= MAX_ATTEMPTS) return `Tried ${MAX_ATTEMPTS} times. Call ${d.carrier} to check the address, or ask an admin.`
    const dest = channel === 'fax' ? faxDigits(destination) : channel === 'email' ? (validEmail(destination) ? destination.trim().toLowerCase() : null) : channel === 'upload' ? destination : null
    if (channel !== 'agent_portal' && !dest) return channel === 'fax' ? 'That fax number needs 10 digits' : channel === 'email' ? 'That email address doesn’t look right' : 'Add the upload address'
    const by = ['upload', 'agent_portal'].includes(channel)
    const fail = !by && testFail(channel, dest)
    const sd = send(channel, dest, by ? 'sending' : fail ? 'failed' : 'delivered', {
      attempt: d.sends.length + 1, at: 'Thu now', failure_reason: fail ? (channel === 'fax' ? 'Busy signal after 3 tries (sandbox test number)' : 'Mailbox not found (sandbox test address)') : null,
      confirm_due: by || fail ? null : 'Tue by 5 PM' })
    set(st => patchDoc(st, who, docId, x => ({ ...x, sends: [sd, ...x.sends] })))
    return null
  },
  // upload: the VA did it on the carrier's site. agent_portal: the agent did it in their portal.
  markSent: (who, docId, sendId) => set(s => patchDoc(s, who, docId, d => ({ ...d, sends: d.sends.map(x => (x.id === sendId ? { ...x, status: 'delivered', confirm_due: 'Tue by 5 PM' } : x)) }))),
  confirm: (who, docId, sendId, received) => set(s => patchDoc(s, who, docId, d => ({ ...d, sends: d.sends.map(x => (x.id === sendId ? { ...x, status: received ? 'received' : 'not_received' } : x)) }))),
  saveCarrier: (name, patch) => set(s => ({ carriers: { ...s.carriers, [name]: { ...carrierOf(s, name), ...patch } } })),
  markGate: (who, what, on) => set(s => ({ gates: { ...s.gates, [who]: { ...s.gates[who], [what === 'issued' ? 'issued_on' : 'first_payment_on']: on } } })),
}

export { pickChannel, addressFor }
