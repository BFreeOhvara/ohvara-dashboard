// GoHighLevel bridge status for the admin Connect page (P850 builds it; P853
// wires the page). Plain words only: agents never see GHL, and admins see
// "texting service" states, not API detail.
//
// settings: the ghl_settings row (admin-only), or null when it can't be read
//           (migration 230 not applied yet, or not an admin).
// deployed: whether ghl-push / ghl-webhook are deployed (P853 decides how to tell).

export const GHL_EVENTS = [
  { key: 'workflow_new_inbound', label: 'New lead' },
  { key: 'workflow_appointment_reminder', label: 'Appointment reminder' },
  { key: 'workflow_no_show', label: 'No-show' },
  { key: 'workflow_opt_out', label: 'Opt-out' },
]

const LOCATION_RE = /^[A-Za-z0-9]{6,64}$/
const WORKFLOW_RE = /^[A-Za-z0-9-]{6,64}$/

// Same rules as migration 230's checks, so the page can say what's wrong before saving.
export function validLocationId(v) {
  return typeof v === 'string' && LOCATION_RE.test(v.trim())
}
export function validWorkflowId(v) {
  return v == null || v === '' || (typeof v === 'string' && WORKFLOW_RE.test(v.trim()))
}

export function ghlStatus(settings, { deployed = false } = {}) {
  if (!settings || !settings.location_id) {
    return { key: 'not_connected', label: 'Not connected', detail: 'Add the location ID and API key to connect.' }
  }
  if (!deployed) {
    return { key: 'waiting_for_deploy', label: 'Waiting for deploy', detail: 'Saved. It starts once the bridge is deployed.' }
  }
  if (!settings.enabled) {
    return { key: 'off', label: 'Switched off', detail: 'Connected, but nothing is sent until it is switched on.' }
  }
  if (settings.last_sync_status === 'not_configured') {
    return { key: 'not_connected', label: 'Not connected', detail: 'The API key is missing.' }
  }
  if (settings.last_sync_status === 'error') {
    return { key: 'error', label: 'Needs attention', detail: settings.last_sync_error || 'The last sync failed.', at: settings.last_sync_at ?? null }
  }
  return { key: 'connected', label: 'Connected', detail: settings.last_sync_at ? 'Last sync' : 'No sync yet.', at: settings.last_sync_at ?? null }
}
