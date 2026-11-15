// P1015 — phone only: filters and tabs are ONE row (the shared PillBar), never a wrapped pile of chips.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = f => readFileSync(new URL(f, import.meta.url), 'utf8')

test('the pill bar never wraps: nowrap, sideways scroll, a fade on the side with more, no All pill', () => {
  const css = src('./template/m/p1015.css')
  const bar = css.match(/\.pb-bar \{[^}]*\}/)[0]
  assert.match(bar, /flex-wrap: nowrap/)
  assert.match(bar, /overflow-x: auto/)
  assert.doesNotMatch(bar, /flex-wrap: wrap/)
  assert.match(css, /has-right[^}]*mask-image/)
  assert.match(css, /has-left[^}]*mask-image/)
  const js = src('./template/m/PillBar.jsx')
  assert.match(js, /onChange\(on && clear \? null : o\.key\)/, 'tapping the chosen pill clears it')
})

test('the wrapped phone rows use the pill bar, with short labels and no "All"', () => {
  for (const f of ['./adminshell/m/AAgents.jsx', './adminshell/m/ATeam.jsx', './adminshell/m/ATeamMore.jsx', './adminshell/m/APages.jsx', './template/m/va/VClients.jsx']) {
    assert.match(src(f), /<PillBar/, f)
    assert.doesNotMatch(src(f), /className="(ma-chips am-tabs|ma-chips am-vachips|va-chips va-statuspills)/, f)
  }
  const agents = src('./adminshell/m/AAgents.jsx')
  for (const w of ["'Transfers'", "'Booking'", "'Past due'", "'Paused'", "'Not paying'"]) assert.ok(agents.includes(w), w)
  assert.ok(!agents.includes("label: 'All'"))
  assert.match(src('./adminshell/m/ATeam.jsx'), /\['pay', 'Pay'\]/)
})

test('the desktop never loads the pill bar', () => {
  for (const f of ['./adminshell/screens/Agents.jsx', './adminshell/screens/Team.jsx', './adminshell/screens/Team879.jsx', './adminshell/screens/Compliance879.jsx']) assert.ok(!src(f).includes('PillBar'), f)
})
