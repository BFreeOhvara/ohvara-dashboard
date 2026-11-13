// P948/P979 — the practice copy of the VA portal. Practice on a training lesson opens the VA side at
// /template/fulfillment (sample info only, no backend: nothing real changes, no call dials, no text goes out), runs a
// guided walkthrough the VA clicks through themselves. The practice context lives in this tab's sessionStorage, so it ends with the
// tab, and it only counts on the practice copy's addresses. No React, no imports: it runs under node --test.
//   { lesson: id, name: the trainee's name, back: the Training address to return to }

export const PRACTICE_KEY = 'ohvara-practice'
export const PRACTICE_ROOT = '/template/fulfillment'

const store = () => { try { return globalThis.sessionStorage || null } catch { return null } }
const here = () => globalThis.window?.location?.pathname || ''
export const onPracticeCopy = (path = here()) => path === PRACTICE_ROOT || path.startsWith(`${PRACTICE_ROOT}/`)

export function readPractice() {
  const s = store()
  if (!s) return null
  try {
    const v = JSON.parse(s.getItem(PRACTICE_KEY) || 'null')
    return v && typeof v.lesson === 'string' ? v : null
  } catch { return null }
}

// On, only on the practice copy's pages with a practice under way.
export const practiceOn = () => onPracticeCopy() && !!readPractice()

export function writePractice(ctx) {
  const s = store()
  try { if (ctx) s?.setItem(PRACTICE_KEY, JSON.stringify(ctx)); else s?.removeItem(PRACTICE_KEY) } catch { /* private window: the tour still runs this page */ }
}
export const endPractice = () => writePractice(null)

// The practice copy's address of a VA page (the router paths are the same; the copy sits under /template).
export const practiceUrl = path => `/template${path}`
