import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// P860: the live clock is one line on every page's title row, in all three portals; the VA frames arm the same
// "content never waits on motion" watchdog as the admin and agent frames (P859).
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')

test('the clock is one line: weekday, month, day, then time with seconds; no zone chip, no dropdown', () => {
  const clock = src('../template/Clock.jsx')
  const live = clock.slice(clock.indexOf('export function LiveClock'), clock.indexOf('// The time zone dropdown'))
  assert.match(live, /\{c\.date\}/)
  assert.match(live, /\{c\.hm\}:\{c\.s\} \{c\.ampm\}/)
  assert.doesNotMatch(live, /c\.zone\}<|<Select|<select|<button/) // the zone is only in the screen-reader label
  const parts = src('../template/clockTime.js')
  assert.match(parts, /weekday: 'long', month: 'short', day: 'numeric'/)
})

test('the clock css: about 21px, medium weight, tabular numbers, never wraps, on its own line under the title below 1440', () => {
  const css = src('../template/clock.css')
  assert.match(css, /font-size: 21px/)
  assert.match(css, /font-weight: 500/)
  assert.match(css, /font-variant-numeric: tabular-nums/)
  assert.match(css, /white-space: nowrap/)
  assert.match(css, /max-width: 1439\.98px\) \{\s*\.fx \.fx-head \.fx-clock \{ order: 2; flex: 0 0 100%/)
  assert.match(css, /max-width: 999\.98px\) \{\s*\.fx \.fx-head \.fx-clock \{ order: 1;[^}]*\}\s*\.fx \.fx-head \.fx-kpis \{ order: 2; \}/)
})

test('all three frames show it in the page head, not the top bar; admin lost its own pill', () => {
  const agent = src('../template/TemplateFrame.jsx')
  const sampleVa = src('../template/ful/FulFrame.jsx')
  const va = src('../fulshell/FulfillFrame.jsx')
  const admin = src('./AdminFrame.jsx')
  for (const [name, s] of [['agent', agent], ['sample VA', sampleVa], ['admin', admin]]) {
    assert.match(s, /layout !== 'messages' && <LiveClock tz=/, name)
  }
  assert.match(va, /<LiveClock tz=\{d\.tz\} \/>/)
  // it sits inside the .fx-head block, after the title (before the main column opens)
  for (const s of [agent, sampleVa, va, admin]) {
    assert.ok(s.indexOf('<LiveClock') > s.indexOf('<RollTitle') && s.indexOf('<LiveClock') < s.indexOf('<main'))
  }
  const bar = admin.slice(admin.indexOf('<header className="tp-top'), admin.indexOf('</header>', admin.indexOf('<header className="tp-top')))
  assert.ok(bar.length > 100 && !bar.includes('LiveClock'))
  assert.doesNotMatch(src('./kit.jsx'), /adm-clock|ZONES/)
  assert.doesNotMatch(src('./admin.css'), /\.adm-clock/)
})

test('both VA frames arm the P859 watchdog with the fx-settled root class', () => {
  for (const p of ['../template/ful/FulFrame.jsx', '../fulshell/FulfillFrame.jsx']) {
    const s = src(p)
    assert.match(s, /import \{ armEntrance \} from '(\.\.\/)+adminshell\/entrance'/, p)
    assert.match(s, /classList\.add\('is-anim'\); stop = armEntrance\(el, \{ still: still\(\), rootClass: 'fx-settled' \}\)/, p)
    assert.match(s, /document\.documentElement\.classList\.remove\('fx-settled'\)/, p)
  }
})
