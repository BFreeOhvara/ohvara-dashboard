// P1017 (Brayden, Nov 15) — sample information is for internal test accounts only. Every real account, any role, sees
// real data from the first second. The server decides per account (migration 279: profile_sees_sample / my_data_view):
//   - a test account (profiles.is_test: Test Agent, Test Fulfill, the App Review logins) → sample, always (P929);
//   - an admin → their own View: Sample / Real (profiles.data_view, set only through set_my_data_view), default Real;
//   - everyone else → real. The old company switch (app_settings.show_sample_data) no longer decides anything.
// Nothing here waits on a settings load, so no real account ever sees a sample frame while the page loads.

// profile: the signed-in row from get_my_profile (null while signed out or loading → real, never sample).
// view: an admin's choice made in this tab a moment ago ('sample' | 'real' | null), shown at once while the server saves it.
export function resolveMode({ profile, view = null }) {
  if (!profile || profile.deleted_at) return 'real'
  if (profile.is_test === true) return 'sample'
  if (profile.role === 'admin') {
    const v = view === 'sample' || view === 'real' ? view : profile.data_view
    return v === 'sample' ? 'sample' : 'real'
  }
  return 'real'
}

// P934: only admins pick their own view (the "Sample info" pill in the avatar menu). Agents and VAs have no view control.
export const canPreviewReal = profile => !!profile && profile.role === 'admin' && profile.is_test !== true

// This tab's pending admin choice: shown at once while set_my_data_view saves it; cleared when the profile reloads.
let pending = null
const listeners = new Set()
export const readView = () => pending
export function writeView(v) {
  pending = v === 'sample' || v === 'real' ? v : null
  listeners.forEach(l => l())
}
export function subscribeView(fn) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
