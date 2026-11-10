// P848 — "Show sample data" (Brayden, Nov 6): every portal keeps its sample information until this is switched off.
// The company-wide switch is app_settings.show_sample_data. Until that column exists (it needs a migration) or while
// it is anything but false, every page shows sample data. Admins (and the test accounts) can preview real data for
// themselves with "View: Sample / Real" in the avatar menu; that choice lives in this browser only and changes
// nothing anyone else sees.
import { isTestProfile } from './testAccounts.js'

export const VIEW_KEY = 'ohvara-view'

// show: the company switch's value as loaded (undefined = column not there yet, or still loading).
// view: this viewer's own choice ('sample' | 'real' | null). canPreview: admins and test accounts only.
// P929: test accounts always open on the sample information (Brayden wants every screen filled in), even after the
// company switch goes to real; they can still pick "View: Real" to check the sandbox end to end.
export function resolveMode({ show, view, canPreview, isTest = false }) {
  if (canPreview && (view === 'sample' || view === 'real')) return view
  if (isTest) return 'sample'
  return show === false ? 'real' : 'sample'
}

// P852: the test VA (tesfulfill11, "Test Fulfill") can preview real data too, for the VA side's checks.
export const PREVIEW_IDS = new Set(['402a7a07-c9b0-428f-9b9d-ff2b6480bed0'])
export const canPreviewReal = profile => !!profile && (profile.role === 'admin' || isTestProfile(profile) || PREVIEW_IDS.has(profile.id))

// The switch can only be flipped once the column is there; a missing column reads as "on" and can't be saved.
export const switchReady = settings => !!settings && Object.prototype.hasOwnProperty.call(settings, 'show_sample_data')

const listeners = new Set()
export function readView() {
  try { const v = window.localStorage.getItem(VIEW_KEY); return v === 'real' || v === 'sample' ? v : null } catch { return null }
}
export function writeView(v) {
  try { if (v) window.localStorage.setItem(VIEW_KEY, v); else window.localStorage.removeItem(VIEW_KEY) } catch { /* private window: this page only */ }
  listeners.forEach(l => l())
}
export function subscribeView(fn) {
  listeners.add(fn)
  const onStorage = e => { if (e.key === VIEW_KEY) fn() }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => { listeners.delete(fn); if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage) }
}
