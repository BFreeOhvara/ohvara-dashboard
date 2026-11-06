import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// P862: a content blocker's cosmetic filter hid the whole admin shell because its classes started with "ad-".
// Rule: no class, id or data attribute in the three portal shells may be a name that filter lists target.
const BAD = /(^|[\s_-])(ad|ads|advert|banner|sponsor)([\s_-]|$)/i
const ROOTS = ['../adminshell', '../template', '../fulshell']

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(jsx?|css)$/.test(n) && !/\.test\.js$/.test(n)) out.push(p)
  }
  return out
}

// Every class / id / data-attribute name written in the file (CSS selectors and JSX attributes).
function names(file) {
  const text = readFileSync(file, 'utf8')
  const found = new Set()
  if (file.endsWith('.css')) {
    const css = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^{}]*\}/g, m => m.replace(/[^;{}]*:[^;{}]*/g, ''))
    for (const m of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/[.#]([A-Za-z_][\w-]*)/g)) found.add(m[1])
    for (const m of css.matchAll(/\[(data-[\w-]+)/g)) found.add(m[1])
    for (const m of text.matchAll(/\[(?:class|id)[~|^$*]?=["']?([\w-]+)/g)) found.add(m[1])
  } else {
    for (const m of text.matchAll(/\b(?:className|itemClass|class|id|htmlFor)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{'([^']*)'\}|\{"([^"]*)"\})/g)) {
      const v = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]
      for (const t of v.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (t) found.add(t)
    }
    for (const m of text.matchAll(/\b(data-[\w-]+)\s*=/g)) found.add(m[1])
    for (const m of text.matchAll(/\b(?:className|itemClass)\s*[:=]\s*\{?[^\n]*?(['"`])([^'"`\n]*)\1/g)) for (const t of m[2].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (t) found.add(t)
  }
  return [...found]
}

test('no class, id or data attribute in the admin, agent or VA shell is an ad / ads / advert / banner / sponsor name', () => {
  const hits = []
  for (const root of ROOTS) {
    for (const f of walk(new URL(root, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
      for (const n of names(f)) if (BAD.test(n)) hits.push(`${f.split(/[\\/]src[\\/]/).pop()}: ${n}`)
    }
  }
  assert.deepEqual(hits, [], 'rename these (a blocker hides them): ' + hits.join(', '))
})

test('the guard really catches the old names', () => {
  for (const n of ['ad', 'ad-main', 'ad-tabs', 'ads', 'ad_x', 'x-ad', 'x-ad-y', 'banner', 'ps-banner', 'sponsor-box', 'data-ad']) assert.ok(BAD.test(n), n)
  for (const n of ['adm-main', 'adm', 'tp-grow', 'fx-ccard', 'add-note', 'ready', 'broad']) assert.ok(!BAD.test(n), n)
})

test('the admin frame and styles use the adm- prefix', () => {
  const css = readFileSync(new URL('./admin.css', import.meta.url), 'utf8')
  const frame = readFileSync(new URL('./AdminFrame.jsx', import.meta.url), 'utf8')
  assert.match(frame, /tp tp-app fx adm is-/)
  assert.match(css, /\.adm \.adm-pagetabs/)
  assert.doesNotMatch(css, /\.ad[\s.{,-]/)
})
