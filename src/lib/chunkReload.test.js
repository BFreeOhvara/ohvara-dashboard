import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isChunkError, takeReload, bustedHref, BUST_PARAM, FLAG_WINDOW_MS, runningBuild } from './chunkReload.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) } }

test('every way a gone build file shows up counts as a chunk error', () => {
  for (const msg of [
    'Failed to fetch dynamically imported module: https://x/assets/AdminShell-abc.js',
    'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"',
    "Cannot read properties of undefined (reading 'default')",
    'error loading dynamically imported module',
  ]) assert.ok(isChunkError(new Error(msg)), msg)
  assert.ok(!isChunkError(new Error('boom')))
  assert.ok(!isChunkError(undefined))
})

test('one reload per build version; a new build gets its own; the same build tries again after the window', () => {
  const list = [store()]
  assert.equal(takeReload('1.20261106.1', 1000, list), true)
  assert.equal(takeReload('1.20261106.1', 2000, list), false) // same build, just tried: show the panel
  assert.equal(takeReload('1.20261106.2', 2000, list), true) // a different build is a different tab state
  assert.equal(takeReload('1.20261106.1', 1000 + FLAG_WINDOW_MS + 1, list), true)
})

test('the flag survives a closed tab (local storage) and blocked storage means no reload at all', () => {
  const local = store(), session = store()
  assert.equal(takeReload('b', 5, [local, session]), true)
  assert.equal(local.getItem('ov-chunk-reload:b'), '5')
  assert.equal(session.getItem('ov-chunk-reload:b'), null)
  // a fresh tab (new session storage) still sees the local flag
  assert.equal(takeReload('b', 6, [local, store()]), false)
  assert.equal(takeReload('b', 6, []), false)
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.equal(takeReload('b', 6, [broken]), false)
})

test('the reload address carries a cache-busting query and keeps the rest', () => {
  const u = new URL(bustedHref('https://portal.ohvara.com/admin/team?tab=2#top', 123))
  assert.equal(u.pathname, '/admin/team')
  assert.equal(u.searchParams.get('tab'), '2')
  assert.equal(u.searchParams.get(BUST_PARAM), '123')
  assert.equal(u.hash, '#top')
  assert.equal(runningBuild(), 'dev')
})

test('the host: gone build files are a real 404, index.html is revalidated, hashed files are immutable', () => {
  const v = JSON.parse(src('../../vercel.json'))
  const spa = v.rewrites.at(-1)
  assert.equal(spa.destination, '/index.html')
  const re = new RegExp(`^${spa.source}$`)
  const hits = p => re.test(p)
  assert.equal(hits('/assets/AdminShell-abc123.js'), false)
  assert.equal(hits('/assets/index-abc123.css'), false)
  assert.equal(hits('/admin'), true)
  assert.equal(hits('/admin/team'), true)
  assert.equal(hits('/'), true)
  const rule = s => v.headers.find(h => h.source === s)?.headers.find(x => x.key === 'Cache-Control')?.value
  assert.equal(rule('/index.html'), 'no-cache')
  assert.equal(rule('/assets/(.*)'), 'public, max-age=31536000, immutable')
  const route = new RegExp(`^${v.headers.find(h => /\[\^\.\]/.test(h.source)).source}$`)
  assert.ok(route.test('/admin') && route.test('/') && !route.test('/assets/x') && !route.test('/ota/a.zip'))
  assert.equal(rule('/ota/manifest.json'), 'no-store, max-age=0') // the specific rules still come last
  const order = v.headers.map(h => h.source)
  assert.ok(order.indexOf('/ota/manifest.json') > order.findIndex(s => /\[\^\.\]/.test(s)))
})

test('every crash panel reloads fresh and the panel is outside every motion gate', () => {
  assert.match(src('../adminshell/AdminBoundary.js'), /onClick: reloadFresh/)
  assert.match(src('../components/shared/ErrorBoundary.jsx'), /onClick=\{reloadFresh\}/)
  const css = src('../index.css')
  assert.match(css, /\.ov-crash, \.ov-crash \* \{ animation: none !important/)
  assert.match(css, /\.ov-crash \{ opacity: 1 !important; visibility: visible !important/)
})
