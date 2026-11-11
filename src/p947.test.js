import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('P947: one calendar top row (week switch + Today) for agent, VA and admin', () => {
  const bar = src('./template/CalBar.jsx')
  assert.match(bar, />Today</)
  assert.match(bar, /import '\.\/cal947\.css'/)
  for (const f of ['./template/screens/Calendar.jsx', './template/ful/screens/Calendar.jsx', './adminshell/screens/Team.jsx']) assert.match(src(f), /onToday=\{/)
})

test('P947: Today is a filled pill on the date header, not a tinted column; call boxes lift on hover', () => {
  const css = src('./template/cal947.css')
  assert.match(css, /\.fx-week \.tp-tcol\.today \{ background-color: transparent; \}/)
  assert.match(css, /b\.today small \{[^}]*border-radius: 999px[^}]*background: var\(--sh-acc/)
  assert.match(css, /\.tp-ev:hover \{[^}]*translate: 0 -3px; scale: 1\.03/)
})

test('P947: a VA call opens as a centred pop-up from the grid and the day list; no confirmation number', () => {
  const cal = src('./template/ful/screens/Calendar.jsx')
  assert.match(cal, /<CallDrawer key=\{id\} id=\{id\} onClose=\{closeDrawer\} center \/>/)
  assert.doesNotMatch(cal, /onClose=\{closeDrawer\} inline/) // the day panel keeps its list (no call inside it)
  assert.doesNotMatch(cal, /Confirmation \$\{/)
  assert.match(src('./template/Record.jsx'), /is-center/)
})

test('P947: the VA Overview keeps training above Today\'s calls (the page fits, no scroll)', () => {
  const ov = src('./template/ful/screens/Overview.jsx')
  assert.ok(ov.indexOf('<TrainingCard') > ov.indexOf('fs-ov-side'))
})
