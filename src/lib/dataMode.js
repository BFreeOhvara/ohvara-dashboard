// P848 — "Show sample data" (Brayden, Nov 6): every portal keeps its sample information until this is switched off.
// The company-wide switch is app_settings.show_sample_data. Until that column exists (it needs a migration) or while
// it is anything but false, every page shows sample data. Admins (and the test accounts) can preview real data for
// themselves with "View: Sample / Real" in the avatar menu; that choice lives in this browser only and changes
// nothing anyone else sees.
import { isTestAccount } from './testAccounts.js'

export const VIEW_KEY = 'ohvara-view'

// show: the company switch's value as loaded (undefined = column not there yet, or still loading).
// view: this viewer's own choice ('sample' | 'real' | null). canPreview: admins and test accounts only.
export function resolveMode({ show, view, canPreview }) {
  if (canPreview && (view === 'sample' || view === 'real')) return view
  return show === false ? 'real' : 'sample'
}

export const canPreviewReal = profile => !!profile && (profile.role === 'admin' || isTestAccount(profile.id))

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
