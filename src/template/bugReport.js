import { useSyncExternalStore } from 'react'

// P876 — Report a bug (Help & Support, in the agent, VA and admin portals). What the person types (what happened, what
// they expected, an optional screenshot or file) plus what is captured for them: the page, the time, the browser,
// the screen size, and who sent it. Signed in for real, it saves through the P711 path (bug_reports + the
// bug-screenshots bucket; migration 090's trigger gives every admin an app notification). On sample info it lands in
// this small store, which admin's Bug reports list and bell read (new → seen → fixed) until P858 wires the real list.

// The browser and system from a user-agent string, in plain words ("Chrome 142 on Windows").
export function browserOf(ua = '') {
  const pick = [[/Edg\/(\d+)/, 'Edge'], [/OPR\/(\d+)/, 'Opera'], [/Firefox\/(\d+)/, 'Firefox'], [/CriOS\/(\d+)/, 'Chrome'], [/Chrome\/(\d+)/, 'Chrome'], [/Version\/(\d+)[.\d]* .*Safari/, 'Safari']]
  const hit = pick.map(([re, name]) => [ua.match(re), name]).find(([m]) => m)
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'an unknown system'
  return hit ? `${hit[1]} ${hit[0][1]} on ${os}` : `A browser on ${os}`
}

// What is captured automatically. `env` is window-like so it can be tested.
export function bugContext(env, who, now = new Date()) {
  const loc = env?.location || {}
  const scr = env?.screen || {}
  return {
    page: `${loc.pathname || ''}${loc.search || ''}` || 'unknown page',
    at: now.toISOString(),
    time: now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    browser: browserOf(env?.navigator?.userAgent || ''),
    screen: `${scr.width || '?'}×${scr.height || '?'} screen, ${env?.innerWidth || '?'}×${env?.innerHeight || '?'} window`,
    who: who?.name || 'Someone',
    role: who?.role || '',
  }
}

// The one text the P711 table holds (it has no columns for "expected" or the context yet; see the ship note).
export function bugText({ happened, expected }, ctx) {
  return [
    `What happened: ${happened.trim()}`,
    expected?.trim() ? `What they expected: ${expected.trim()}` : null,
    '—',
    `Page: ${ctx.page}`, `Time: ${ctx.time}`, `Browser: ${ctx.browser}`, `Screen: ${ctx.screen}`,
    `Sent by: ${ctx.who}${ctx.role ? ` (${ctx.role})` : ''}`,
  ].filter(Boolean).join('\n')
}

export const BUG_STATUS = { new: 'New', seen: 'Seen', fixed: 'Fixed' }
export const nextStatus = s => (s === 'new' ? 'seen' : s === 'seen' ? 'fixed' : 'fixed')

// The sample store, kept in this browser so a report sent on the VA side shows on the admin side after a reload.
const KEY = 'ohvara-bug-reports:v1'
let reports = (() => { try { return JSON.parse(globalThis.localStorage?.getItem(KEY) || '[]') } catch { return [] } })()
const subs = new Set()
const put = next => {
  reports = next
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(next)) } catch { /* private window: this page only */ }
  subs.forEach(f => f())
}
export function addSampleBug({ happened, expected, file }, ctx) {
  const r = { id: `br-${Date.now()}`, text: happened.trim(), expected: expected?.trim() || '', file: file ? { name: file.name, size: file.size } : null, ctx, status: 'new', seenByAdmin: false }
  put([r, ...reports])
  return r
}
export const setSampleBugStatus = (id, status) => put(reports.map(r => (r.id === id ? { ...r, status } : r)))
export const sampleBugs = () => reports
export const resetSampleBugs = () => put([])
const subscribe = f => { subs.add(f); return () => subs.delete(f) }
export const useSampleBugs = () => useSyncExternalStore(subscribe, () => reports, () => reports)
