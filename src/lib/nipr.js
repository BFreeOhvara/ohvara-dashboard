// P881 — the real licence calls the agent side wires (P848) when Show sample data is off. The template's
// LicenceForm takes the same value shape (src/template/licenceModel.js) from either this or the sample registry.
//
//   checkNpn(db, npn)                 nipr-check: look the NPN up, store it, return the form value
//   loadLicence(db)                   my_licence(): the stored licence as the form value
//   sendForReview(db, userId, {...})  upload the licence into licence-docs/<user>/ and open a manual check
//   saveLeadStates(db, userId, states) agent_lead_settings.states (the database refuses unverified states)

// The server's licence view (licence_view in the P881 migration) → the form value.
export function toLicenceValue(view, prev = {}) {
  if (!view) return null
  const licences = (view.licences || []).filter(l => l.verified || l.source !== 'self').map(l => ({
    state: l.state, active: !!l.active, life: !!l.life, expires_on: l.expires_on || null, number: l.number || null,
    lapsed_at: l.lapsed_at ? String(l.lapsed_at).slice(0, 10) : null,
  }))
  const verified = new Set(view.states || [])
  return {
    npn: view.npn || '', status: view.status || 'unchecked', name: view.name || null, checkedAt: view.checked_at || null,
    licences,
    states: (prev.states || [...verified]).filter(s => verified.has(s)),
    attested: Object.fromEntries(Object.entries(prev.attested || {}).filter(([s]) => verified.has(s))),
    review: view.review && view.review.status === 'open' ? { reason: view.review.reason, sentAt: view.review.created_at } : null,
    ready: !!view.ready, gateOn: !!view.gate_on,
  }
}

export async function checkNpn(db, npn, prev) {
  const { data, error } = await db.functions.invoke('nipr-check', { body: { action: 'check', npn } })
  if (error) {
    // invalid NPN comes back as a 400 with a message
    const body = await error.context?.json?.().catch(() => null)
    throw Object.assign(new Error(body?.message || body?.error || 'Couldn’t check the NPN. Try again.'), { status: body?.status })
  }
  return { status: data.status, message: data.message, registry: data.registry, value: toLicenceValue(data.licence, prev) }
}

export async function loadLicence(db, prev) {
  const { data, error } = await db.rpc('my_licence')
  if (error) throw error
  return toLicenceValue(data, prev)
}

const safe = name => String(name || 'licence').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(-80) || 'licence'

export async function sendForReview(db, userId, { reason, states = [], file = null, note = null, now = Date.now() }) {
  let path = null
  if (file) {
    path = `${userId}/${now}-${safe(file.name)}`
    const { error } = await db.storage.from('licence-docs').upload(path, file, { upsert: false, contentType: file.type || undefined })
    if (error) throw error
  }
  const { data, error } = await db.rpc('licence_review_request', { p_reason: reason, p_states: states, p_document_path: path, p_note: note })
  if (error) throw error
  return { id: data, path }
}

export async function saveLeadStates(db, userId, states) {
  const { error } = await db.from('agent_lead_settings').upsert({ agent_id: userId, states }, { onConflict: 'agent_id' })
  if (error) throw Object.assign(new Error(error.hint === 'not_verified_state' ? error.message : 'Couldn’t save your states. Try again.'), { hint: error.hint })
}
