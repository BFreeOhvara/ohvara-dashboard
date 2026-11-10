import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AdminBoundary, AdminCrash, OVERVIEW_HREF } from './AdminBoundary.js'
import { askAgainUnlessMissing } from '../hooks/useVaShiftsPolicy.js'
import { readShiftWeek, readShiftsToday, readDayOffRequests } from '../lib/vaShifts.js'
import { readGhlSettings } from '../lib/ghlConnect.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')
// A stand-in for the backend that answers every call with one error.
const failing = error => {
  const q = { select: () => q, gte: () => q, order: () => q, eq: () => q, maybeSingle: () => q, then: r => r({ data: null, error }) }
  return { rpc: async () => ({ data: null, error }), from: () => q }
}
const MISSING_RPC = { code: 'PGRST202', message: 'Could not find the function public.va_shift_week' }
const MISSING_TABLE = { code: 'PGRST205', message: "Could not find the table 'public.ghl_settings'" }

test('a thrown render shows the crash panel with Reload and Go to Overview, not a white screen (P919: no classic admin)', () => {
  assert.equal(OVERVIEW_HREF, '/admin')
  const html = renderToStaticMarkup(createElement(AdminCrash))
  assert.match(html, /role="alert"/)
  assert.match(html, />Reload</)
  assert.match(html, /href="\/admin"[^>]*>Go to Overview</)
  assert.doesNotMatch(html, /classic/)
  const b = new AdminBoundary({ children: 'page' })
  assert.equal(b.render(), 'page')
  b.state = AdminBoundary.getDerivedStateFromError(new Error('boom'))
  assert.equal(b.render().type, AdminCrash)
  // even a throw of nothing at all is caught
  assert.ok(AdminBoundary.getDerivedStateFromError(undefined).error)
})

test('a new address clears a stuck error so the tabs keep working', () => {
  const b = new AdminBoundary({ resetKey: '/admin/team', children: 'x' })
  let state = AdminBoundary.getDerivedStateFromError(new Error('boom'))
  b.state = state
  b.setState = s => { state = { ...state, ...s } }
  b.componentDidUpdate({ resetKey: '/admin/team' })
  assert.ok(state.error)
  b.componentDidUpdate({ resetKey: '/admin' })
  assert.equal(state.error, null)
})

test('the shell and its entry both sit inside the boundary', () => {
  const shell = src('./AdminShell.jsx')
  assert.match(shell, /<AdminBoundary>\s*<AccountProvider/)
  assert.match(shell, /<AdminBoundary resetKey=\{pathname\}>/)
  assert.doesNotMatch(shell, /shared\/ErrorBoundary/)
  assert.match(src('../components/layout/ShellSwap.jsx'), /<AdminBoundary><Suspense fallback=\{<Spinner \/>\}><AdminShell account=\{account\} \/>/)
})

test('a missing rota function or table answers null (the page keeps its sample rota); other failures throw', async () => {
  assert.equal(await readShiftWeek(failing(MISSING_RPC), {}), null)
  assert.equal(await readShiftsToday(failing(MISSING_RPC)), null)
  assert.equal(await readDayOffRequests(failing(MISSING_TABLE), '2026-11-05'), null)
  await assert.rejects(readShiftWeek(failing({ code: '42501', message: 'permission denied' }), {}))
})

test('a missing GHL settings table (or a permission failure) answers null: the tile says not connected yet', async () => {
  assert.equal(await readGhlSettings(failing(MISSING_TABLE)), null)
  assert.equal(await readGhlSettings(failing({ code: '42501', message: 'permission denied' })), null)
  const connect = src('./screens/Connect.jsx')
  assert.match(connect, /Not connected yet/)
  assert.match(connect, /Goes live with the GHL switch-on/)
})

test('Connect asks for the GHL settings once when they cannot be read (no 60-second re-read)', () => {
  const connect = src('./screens/Connect.jsx')
  assert.match(connect, /useGhlConnect\(\{ enabled: !!live && !gaveUp \}\)/)
  assert.match(connect, /if \(unread && !gaveUp\) setGaveUp\(true\)/)
})

test('the rota is not asked again once it answered null or failed (no call every 40 seconds)', () => {
  const p = askAgainUnlessMissing(5 * 60e3)
  const q = state => ({ state })
  assert.equal(p.retry, false)
  assert.equal(p.retryOnMount, false)
  assert.equal(p.staleTime(q({ data: null, status: 'success' })), Infinity)
  assert.equal(p.staleTime(q({ data: undefined, status: 'error' })), Infinity)
  assert.equal(p.staleTime(q({ data: [], status: 'success' })), 30e3)
  assert.equal(p.refetchInterval(q({ data: null, status: 'success' })), false)
  assert.equal(p.refetchInterval(q({ data: undefined, status: 'error' })), false)
  assert.equal(p.refetchInterval(q({ data: [{}], status: 'success' })), 5 * 60e3)
  assert.equal('refetchInterval' in askAgainUnlessMissing(), false)
  // every shift read goes through it
  const hooks = src('../hooks/useVaShifts.js')
  assert.equal((hooks.match(/\.\.\.askAgainUnlessMissing\(/g) || []).length, 5)
})
