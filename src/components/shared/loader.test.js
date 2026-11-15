import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// P1020 — the loading screen and the reversed app intro.
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const loader = src('../../lib/loader.js')
const html = src('../../../index.html')
const intro = src('../../../public/intro.js')

const pathOf = (s, name) => s.match(new RegExp(`export const ${name} = '([^']+)'`))?.[1]

test('the boot copy in index.html draws the same mark as Loader.jsx', () => {
  const body = pathOf(loader, 'MARK_BODY'), wing = pathOf(loader, 'MARK_WING')
  assert.ok(body && wing)
  const boot = html.match(/<div id="ol-boot"[\s\S]*?<\/svg>/)?.[0] || ''
  assert.ok(boot.includes(`class="olb" d="${body}"`), 'big piece')
  assert.ok(boot.includes(`class="olw" d="${wing}"`), 'wing')
})

test('desktop light is navy + teal on the soft blue-to-beige; phone and dark are teal + white on dark', () => {
  const css = html.match(/<style id="ol-css">([\s\S]*?)<\/style>/)?.[1] || ''
  assert.match(css, /:root\[data-theme="light"\] \.ol:not\(\.ol-phone\)\{--ol-bg:linear-gradient\(135deg,#C9D7E8 0%,#E6E9E6 45%,#EFE3D3 100%\);--ol-body:#0A1F44;--ol-wing:#00BFA6/)
  assert.match(css, /\.ol\{--ol-bg:linear-gradient\(160deg,#2B3238[^;]*;--ol-body:#00BFA6;--ol-wing:#FFFFFF;--ol-line:#00BFA6/)
  assert.match(css, /\.ol\.ol-phone \.ol-word\{display:none\}/)
  assert.match(css, /animation:ol-wing 1\.6s/)
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.ol \.olw,\.ol-word\{animation:none\}/)
})

test('it waits 300 ms before showing', () => {
  assert.match(loader, /export const WAIT_MS = 300/)
  assert.match(html, /\.ol\.ol-boot\{animation:ol-in \.2s ease \.3s forwards\}/)
})

test('every page-level loading state uses it', () => {
  assert.match(src('../../template/DataState.jsx'), /<Loader area \/>/)
  assert.match(src('../layout/ShellSwap.jsx'), /const Spinner = \(\) => <Loader \/>/)
  assert.match(src('../layout/ProtectedRoute.jsx'), /if \(loading\) return <Loader \/>/)
  const app = src('../../App.jsx')
  assert.match(app, /if \(loading\) return <Loader \/>/)
  assert.doesNotMatch(app, /Suspense fallback=\{null\}/)
  assert.match(src('../../adminshell/AdminShell.jsx'), /<Suspense fallback=\{<Loader \/>\}><AdminApp \/>/)
  assert.match(src('../../main.jsx'), /adoptBoot\(\)\r?\n\r?\ncreateRoot/)
})

test('the app intro is reversed: big piece teal, wing white', () => {
  assert.match(intro, /fill="' \+ WHITE \+ '" d="' \+ BACK \+ '"\/>', 'oi-wing'/)
  assert.match(intro, /fill="' \+ TEAL \+ '" d="' \+ FRONT \+ '"\/>', 'oi-front'/)
})
