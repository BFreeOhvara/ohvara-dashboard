import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// P860: the live clock is one line on the title row (P864: Overview only), in all three portals; the VA frames arm the same
// "content never waits on motion" watchdog as the admin and agent frames (P859).
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')

test('the clock is one line: weekday, month, day, then time with seconds; no zone chip, no dropdown', () => {
  const clock = src('../template/Clock.jsx')
  const live = clock.slice(clock.indexOf('export function LiveClock'), clock.indexOf('// The time zone dropdown'))
  assert.match(live, /\{c\.date\}/)
  assert.match(live, /<b className="fx-clock-t tp-num">\{c\.hm\}:\{c\.s\}<\/b><span className="fx-clock-ap">\{c\.ampm\}<\/span>/)
  assert.doesNotMatch(live, /c\.zone\}<|<Select|<select|<button/) // the zone is only in the screen-reader label
  const parts = src('../template/clockTime.js')
  assert.match(parts, /weekday: 'long', month: 'short', day: 'numeric'/)
})

test('the clock css: 22px date and AM/PM, time digits 1.7x, medium weight, tabular numbers, never wraps, own line below 1440', () => {
  const css = src('../template/clock.css')
  assert.match(css, /--clk: 22px;[^}]*font-size: var\(--clk\)/)
  assert.match(css, /\.fx-clock-t \{ font-size: 1\.7em;/)
  assert.match(css, /\.fx-clock-tm \{ display: inline-flex; align-items: baseline;/)
  assert.match(css, /font-weight: 500/)
  assert.match(css, /font-variant-numeric: tabular-nums/)
  assert.match(css, /white-space: nowrap/)
  assert.match(css, /max-width: 1439\.98px\) \{\s*\.fx \.fx-head \.fx-clock \{ order: 2; flex: 0 0 100%/)
  assert.match(css, /max-width: 999\.98px\) \{\s*\.fx \.fx-head \.fx-clock \{ --clk: 18px; order: 1;[^}]*\}\s*\.fx \.fx-head \.fx-kpis \{ order: 2; \}/)
})

test('agent and VA frames show it in the page head on Overview only, not the top bar; P964: admin shows it on the Live status line', () => {
  const agent = src('../template/TemplateFrame.jsx')
  const sampleVa = src('../template/ful/FulFrame.jsx')
  const va = src('../fulshell/FulfillFrame.jsx')
  const admin = src('./AdminFrame.jsx')
  for (const [name, s] of [['agent', agent], ['sample VA', sampleVa]]) {
    assert.match(s, /layout === 'overview' && <LiveClock tz=/, name)
  }
  assert.match(va, /layout === 'today' && <LiveClock tz=\{d\.tz\} \/>/)
  // it sits inside the .fx-head block, after the title (before the main column opens)
  for (const s of [agent, sampleVa, va]) {
    assert.ok(s.indexOf('<LiveClock') > s.indexOf('<RollTitle') && s.indexOf('<LiveClock') < s.indexOf('<main'))
  }
  // P964: admin's clock moved out of the head onto the Overview's Live status line, right-aligned
  assert.doesNotMatch(admin, /<LiveClock/)
  assert.match(src('./screens/Overview.jsx'), /<div className="adm-ov-statusrow"><LiveStatus \/><LiveClock tz=\{settings\.tz\} \/><\/div>/)
  const top = admin.search(/<header className=\{?[`"]tp-top/) // P914: the class is a template (is-menu while the avatar menu is open)
  const bar = admin.slice(top, admin.indexOf('</header>', top))
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
