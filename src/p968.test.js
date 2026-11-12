// P968 — desktop polish: the lean toward the pointer is back on every rail and top-right icon (all roles share `wig`), the
// imported-list card is a real glass tile, and everything above the stage cards hands its height to the page. The look
// was checked with scripts/p968-shots.mjs on sample data; these pin the rules in the source.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

test('wig leans toward a mouse pointer and springs back; touch, pen and reduced motion get none', () => {
  const js = read('./template/motion.js')
  assert.match(js, /export const wig = \{ onClick: wiggle, onPointerMove: lean, onPointerLeave: release,/)
  assert.match(js, /e\.pointerType !== 'mouse' \|\| still\(\)/)
  const css = read('./template/glass.css')
  assert.match(css, /\.tp-wig > svg \{ transform: translate\(var\(--tp-px, 0px\), var\(--tp-py, 0px\)\)/) // the icon moves, not the button's box
  assert.match(css, /\.tp-wig, \.tp-wig:active, \.tp-wig > svg \{ transform: none !important; \}/)
})

test('every rail, top-right and profile button in the agent, VA and admin frames carries wig', () => {
  for (const f of ['./template/TemplateFrame.jsx', './template/ful/FulFrame.jsx', './fulshell/FulfillFrame.jsx', './adminshell/AdminFrame.jsx']) {
    const src = read(f)
    const tags = src.match(/<(?:button|NavLink|Link)\b[^>]*className=(?:"|\{`)[^>]*\b(?:fx-ri|fx-ib|fx-me)\b[^>]*>/g) || []
    assert.ok(tags.length > 0, f)
    for (const t of tags) assert.match(t, /tp-wig/, `${f}: ${t.slice(0, 90)}`)
  }
})

test('imported-list card is a glass tile; the block above the stage cards feeds the page height', () => {
  assert.match(read('./template/Reactivate.jsx'), /<article className="fx-tile rx-card">/)
  assert.doesNotMatch(read('./template/Reactivate.jsx'), /fx-card rx-card/)
  const leads = read('./template/screens/Leads.jsx')
  const above = leads.split('className="lc-above"')[1].split('</div>\n\n')[0]
  assert.match(above, /<ReactivationCards \/>[\s\S]*<AddLeadsCard compact \/>[\s\S]*<AddServicingCard[\s\S]*<LiveCalls/)
  assert.match(leads, /ref=\{liveRef\} className="lc-above"/)
  assert.match(read('./template/leads873.css'), /\.fx-leads > \.lc-above \{ flex: none;/)
})
