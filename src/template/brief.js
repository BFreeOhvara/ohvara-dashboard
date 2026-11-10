// P923 — "Before our team calls" (Brayden, Nov 9): what the agent tells the team on Submit for servicing, saved on the
// client as `brief` so the VA reads it before the first call. No React, no network (node tests).
//   brief = { replaces: { carrier, premium, draft_day, cancel_by } | null, note: string | null }
// cancel_by = the old policy's next draft date as words ('Dec 3'): the cancel-the-old-policy call is booked before it,
// once the new policy is issued (P899's gate).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ordinal = n => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`

// The next date a monthly draft on `day` comes out, on or after `from` ('YYYY-MM-DD'), as 'Dec 3'. Short months draft
// on their last day.
export function nextDraftWords(day, from) {
  const d = Number(day)
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(String(from || ''))) return null
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)) - 1
  const on = (yy, mm) => Math.min(d, new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate())
  if (on(y, m) < Number(from.slice(8, 10))) { m += 1; if (m > 11) { m = 0; y += 1 } }
  return `${MONTHS[m]} ${on(y, m)}`
}

// What gets saved on the client from a submission (submitModel buildSubmission's replaces + notes).
export function makeBrief({ replaces = null, note = null, cancelBy = null } = {}) {
  const n = String(note || '').trim()
  return {
    replaces: replaces ? { carrier: replaces.carrier || '', premium: replaces.premium || null, draft_day: replaces.draftDay ?? replaces.draft_day ?? null, cancel_by: cancelBy || replaces.cancel_by || null } : null,
    note: n || null,
  }
}

// A replacement: the agent said Yes (or the brief has an old policy). Only then is "Old policy cancelled" a real step.
export const isReplacing = c => c?.replacing === true || !!c?.brief?.replaces

// The words the VA reads at the top of the call: { replace, detail, note, any }. oldCarrier/cancelBy fill in for a
// cancel call whose client has no brief (older rows).
export function briefLines(brief, { oldCarrier = null, cancelBy = null } = {}) {
  const r = brief?.replaces || (oldCarrier ? { carrier: oldCarrier, cancel_by: cancelBy } : null)
  const by = r?.cancel_by || cancelBy
  const replace = r ? `Replacement: cancel the old ${r.carrier ? `${r.carrier} policy` : 'policy'} before ${by || 'its next draft'}` : null
  const detail = r ? [r.premium ? `$${Number(r.premium).toFixed(2)} a month` : null, r.draft_day ? `drafts the ${ordinal(Number(r.draft_day))}` : null].filter(Boolean).join(', ') || null : null
  return { replace, detail, note: brief?.note || null, any: !!(r || brief?.note) }
}
