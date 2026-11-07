import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { JSDOM } from 'jsdom'
import postcss from 'postcss'

// P867 C: a count badge on a tab is never highlighted when its tab is selected (all three portals use kit.jsx
// PillTabs / Seg). Renders a real selected tab with a count, then works out the CSS cascade for the badge from the
// shell's own stylesheets (in the app's import order) and checks the winning colour and background are the neutral
// count tokens, not the selected-tab ones, and the same as an unselected tab's badge.
register('../../scripts/jsx-test-loader.mjs', import.meta.url)
const { PillTabs, Seg } = await import('../template/kit.jsx')

const SHEETS = ['../template/template.css', '../template/glass.css', '../template/flow.css', '../template/palette.css', './admin.css', '../template/ful/ful.css']
const rules = []
for (const [file, i] of SHEETS.map((f, i) => [f, i])) {
  const root = postcss.parse(readFileSync(new URL(file, import.meta.url), 'utf8'))
  root.walkRules(rule => {
    // Skip @keyframes steps and print-only rules; @media blocks count (the badge must hold at every width).
    if (rule.parent?.type === 'atrule' && /keyframes/.test(rule.parent.name)) return
    const decls = {}
    rule.walkDecls(d => { if (/^(color|background|background-color)$/.test(d.prop)) decls[d.prop === 'background-color' ? 'background' : d.prop] = d.value })
    if (Object.keys(decls).length) rules.push({ selectors: rule.selectors, decls, order: i * 1e6 + rule.source.start.line })
  })
}

// Specificity [ids, classes, types]: :is/:not/:has take their most specific argument, :where is zero.
function spec(sel) {
  let a = 0, b = 0, c = 0
  let s = sel
  for (;;) {
    const m = /:(is|not|has|where)\(/.exec(s)
    if (!m) break
    let depth = 1, j = m.index + m[0].length
    for (; j < s.length && depth; j++) { if (s[j] === '(') depth++; else if (s[j] === ')') depth-- }
    const inner = s.slice(m.index + m[0].length, j - 1)
    if (m[1] !== 'where') {
      const best = inner.split(/,(?![^(]*\))/).map(x => spec(x.trim())).sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2])[0]
      a += best[0]; b += best[1]; c += best[2]
    }
    s = s.slice(0, m.index) + ' ' + s.slice(j)
  }
  a += (s.match(/#[\w-]+/g) || []).length
  b += (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length
  c += (s.replace(/\[[^\]]+\]/g, '').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length
  return [a, b, c]
}
const cmp = (x, y) => x.spec[0] - y.spec[0] || x.spec[1] - y.spec[1] || x.spec[2] - y.spec[2] || x.order - y.order

// The value of prop that wins for el.
function winner(el, prop) {
  const hits = []
  for (const r of rules) {
    if (!(prop in r.decls)) continue
    for (const sel of r.selectors) {
      if (/::|:hover|:focus|:active|:visited/.test(sel)) continue
      let ok
      try { ok = el.matches(sel) } catch { ok = false }
      if (ok) hits.push({ spec: spec(sel), order: r.order, value: r.decls[prop], sel })
    }
  }
  return hits.sort(cmp).pop()
}

const tabs = value => renderToStaticMarkup(h(MemoryRouter, null,
  h(PillTabs, { label: 'Team', className: 'fx-ptabs', itemClass: 'fx-ptab', value, onChange: () => {}, items: [{ key: 'today', label: 'Today' }, { key: 'off', label: 'Day off', count: 3 }] }),
  h(Seg, { label: 'Leads', value, onChange: () => {}, options: [{ key: 'today', label: 'All' }, { key: 'off', label: 'New', count: 5 }] })))

function badges(markup, wrap = '') {
  const dom = new JSDOM(`<html data-theme="light"><body><div class="tp tp-app fx adm"><div class="${wrap}">${markup}</div></div></body></html>`)
  return [...dom.window.document.querySelectorAll('.fx-pt > b')]
}

test('PillTabs renders the count as its own badge element (fx-pt-n)', () => {
  const html = tabs('off')
  assert.match(html, /class="[^"]*is-on[^"]*"[^>]*>Day off<b class="fx-pt-n">3<\/b>/)
  assert.match(html, /class="[^"]*is-on[^"]*"[^>]*>New<b class="fx-pt-n">5<\/b>/)
})

for (const [where, wrap] of [['on the page', ''], ['on a coloured tile', 'fx-tile is-fill'], ['on a stage card', 'fx-card']]) {
  test(`P876: a tab's count has no block behind it, selected or not (${where})`, () => {
    const on = badges(tabs('off'), wrap)
    const off = badges(tabs('today'), wrap)
    assert.equal(on.length, 2)
    for (const [k, b] of on.entries()) {
      assert.ok(b.parentElement.classList.contains('is-on'), 'the badge sits in the selected tab')
      for (const prop of ['color', 'background']) {
        const w = winner(b, prop)
        assert.ok(w, `some rule sets the badge ${prop}`)
        // P876 (Brayden, Nov 7): no block at all, a bare number in the tab's own ink.
        assert.equal(w.value, prop === 'background' ? 'transparent' : 'inherit', `selected badge ${prop} is "${w.value}" (${w.sel})`)
        assert.doesNotMatch(w.value, /--sh-on-accent|--sh-acc\b|--sh-on-sel|--sh-sel\b|--sh-on-color/, 'no selected-tab colour')
        assert.equal(w.value, winner(off[k], prop).value, 'the same as the badge on an unselected tab')
      }
    }
  })
}
