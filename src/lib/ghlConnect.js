// Admin Connect page <-> GoHighLevel bridge (P853). Reads/writes the ghl_settings
// row (migration 230, admin-only RLS) and hands the API key to the existing
// secret-setting flow (fetch-secrets POST). The key is write-only: nothing here
// reads it back, logs it, or puts it in an error message. All functions take the
// supabase client so tests can pass a fake; nothing here calls GoHighLevel.
import { ghlStatus, GHL_EVENTS, validLocationId, validWorkflowId } from './ghlStatus.js'

export const GHL_KEY_NAME = 'GHL_API_KEY'
export const ghlKeys = { settings: ['ghl-connect', 'settings'], key: ['ghl-connect', 'key'] }

const COLS = ['enabled', 'location_id', ...GHL_EVENTS.map(e => e.key), 'last_sync_at', 'last_sync_status', 'last_sync_error'].join(', ')

// The row, or null when it can't be read (230 not applied yet, or not an admin).
export async function readGhlSettings(sb) {
  const { data, error } = await sb.from('ghl_settings').select(COLS).eq('id', true).maybeSingle()
  return error || !data ? null : data
}

// true / false, or null when the secret list can't be read (not an admin, fetch-secrets unreachable).
export async function readGhlKeySaved(sb) {
  try {
    const { data, error } = await sb.functions.invoke('fetch-secrets', { method: 'GET' })
    if (error || !data || !Array.isArray(data.secrets)) return null
    return data.secrets.some(s => s.key_name === GHL_KEY_NAME)
  } catch {
    return null
  }
}

// The bridge has run at least once (ghl-push stamps last_sync_* when it works through the outbox).
// While the switch is off it stamps nothing, so "never ran" and "not deployed" look the same: both read as waiting.
export function bridgeDeployed(settings) {
  return !!settings?.last_sync_at
}

export function formFromSettings(s) {
  return {
    locationId: s?.location_id ?? '',
    workflows: Object.fromEntries(GHL_EVENTS.map(e => [e.key, s?.[e.key] ?? ''])),
  }
}

// Same rules as migration 230's checks. errors is keyed by field ('locationId' or the event key).
export function checkForm(form) {
  const errors = {}
  if (!form.locationId.trim()) errors.locationId = 'Add the location ID.'
  else if (!validLocationId(form.locationId)) errors.locationId = 'Letters and numbers only, 6 to 64.'
  for (const e of GHL_EVENTS) {
    if (!validWorkflowId(form.workflows[e.key])) errors[e.key] = 'Letters, numbers and dashes, 6 to 64.'
  }
  return errors
}

export function patchFromForm(form) {
  const patch = { location_id: form.locationId.trim() }
  for (const e of GHL_EVENTS) patch[e.key] = (form.workflows[e.key] || '').trim() || null
  return patch
}

export function sameForm(a, b) {
  return a.locationId.trim() === b.locationId.trim() && GHL_EVENTS.every(e => (a.workflows[e.key] || '').trim() === (b.workflows[e.key] || '').trim())
}

// { ok } or { ok: false, error } in plain words. Zero rows updated means RLS said no (or 230 isn't applied).
export async function saveGhlSettings(sb, form) {
  const errors = checkForm(form)
  if (Object.keys(errors).length) return { ok: false, error: 'Fix the highlighted IDs first.' }
  const { data, error } = await sb.from('ghl_settings').update(patchFromForm(form)).eq('id', true).select('id')
  if (error) return { ok: false, error: 'Could not save the settings.' }
  if (!data?.length) return { ok: false, error: 'Could not save: the bridge database step is not applied, or this login is not an admin.' }
  return { ok: true }
}

// Write-only. Never echoes the value; the error text carries no part of it.
export async function sendGhlKey(sb, key) {
  const value = (key || '').trim()
  if (!value) return { ok: false, error: 'Paste the key first.' }
  try {
    const { data, error } = await sb.functions.invoke('fetch-secrets', {
      method: 'POST',
      body: { key_name: GHL_KEY_NAME, value, description: 'GoHighLevel private integration token (Connect page)' },
    })
    if (error || !data?.success) return { ok: false, error: 'Could not save the key.' }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not reach the key store.' }
  }
}

// The Test connection button: enabled only once the bridge is deployed (it has run), a key is saved and a location is set.
// keySaved null = unknown, which does not block.
export function testConnection(settings, keySaved) {
  if (!bridgeDeployed(settings)) {
    return { enabled: false, note: 'Not available yet. It switches on once the bridge is deployed and has run once.' }
  }
  if (!settings.location_id) return { enabled: false, note: 'Add the location ID first.' }
  if (keySaved === false) return { enabled: false, note: 'Save the API key first.' }
  return { enabled: true, note: "Checks the bridge's last run. It does not send anything." }
}

// "just now", "5 min ago", "3 h ago", else "Nov 5, 2:14 PM" (Central, like the rest of the portal).
export function ago(at, now = Date.now()) {
  const t = Date.parse(at)
  if (!at || Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(t).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Status for the page: the P850 ladder plus the chip tone and the "last sync" words.
const TONE = { not_connected: 'mute', waiting_for_deploy: 'blue', off: 'mute', error: 'warn', connected: 'green' }
export function connectStatus(settings, now = Date.now()) {
  const st = ghlStatus(settings, { deployed: bridgeDeployed(settings) })
  const when = st.at ? ago(st.at, now) : ''
  return { ...st, tone: TONE[st.key] || 'mute', when, line: st.at && st.key === 'connected' ? `Last sync ${when}` : st.detail }
}

// What the page shows as "plugged in" for the two GoHighLevel checks (key saved; location + a new-lead workflow).
export function ghlPlugged(settings, keySaved) {
  return [keySaved === true, !!settings?.location_id && !!settings?.workflow_new_inbound]
}
