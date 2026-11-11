import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// P966: polish round 2. Source checks (this repo reads the files, as the other shell tests do).
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')

test('Overview header: the clock cannot make the status row taller than the Live line', () => {
  const css = src('./p964.css')
  assert.match(css, /@media \(min-width: 1000px\) \{ \.adm \.adm-ov-statusrow \.fx-clock \{ margin-top: -22px; margin-bottom: -6px; \} \}/)
  assert.match(src('./screens/Overview.jsx'), /<div className="adm-ov-statusrow"><LiveStatus \/><LiveClock tz=\{settings\.tz\} \/><\/div>/)
})

test('Calendars: a passed call enters already dimmed; no grey hover on an admin hour slot, call boxes keep their pop', () => {
  const cal = src('../template/cal958.css')
  assert.match(cal, /@keyframes fx-pop-past \{[^}]*opacity: 0[^}]*\}[^}]*opacity: \.6/)
  assert.match(cal, /\.tp-ev\.ev958\.is-past \{ opacity: \.6; animation-name: fx-pop-past; \}/)
  assert.doesNotMatch(src('./p913.css'), /\.adm-rowbtn:hover \{/)
  assert.match(src('../template/cal947.css'), /\.fx-week\.cal910 \.tp-ev:hover \{\s*translate: 0 -3px; scale: 1\.03/)
})

test('Agent results: every colour is a chart/status palette colour (no lilac), loss text stays readable', () => {
  const css = src('./p934.css')
  assert.match(css, /\.is-ai, \.adm \.adm-res-bar \.is-ai \{ background: var\(--sh-sky\); \}/)
  assert.doesNotMatch(css, /adm-res-bar[^{]*\{[^}]*lilac/)
  assert.match(css, /\.adm-res-n b\.is-loss \{ color: var\(--sh-coral/)
})

test('Agent billing: a blue Raise button ($50, toast with Undo, no lowering), Reset to its left, same spot on every row', () => {
  const b = src('./screens/Billing.jsx')
  assert.match(b, /className="fx-pillbtn adm-raise"[^>]*onClick=\{\(\) => raise\(a\)\}>Raise<\/button>/)
  assert.match(b, /const raise = a => set\(a, max\(a\.id\) \+ CAP_STEP, 'raised'\)/)
  assert.doesNotMatch(b, /adm-capstep|Lower |'lowered'|ChevronUp|ChevronDown/)
  const i = b.indexOf('className="adm-reset"'), j = b.indexOf('className="fx-pillbtn adm-raise"')
  assert.ok(i > 0 && j > i, 'Reset is before (to the left of) Raise')
  assert.match(b, /Max \$\{word\} to \$\{money\(value \?\? base\)\}/)
  assert.match(b, /<span>Agent<\/span><span>Plan<\/span><span>Status<\/span><span>Next<\/span><span>Lead spend<\/span>/)
  assert.match(src('./p964.css'), /\.adm-capact \{[^}]*margin-left: auto/)
})
