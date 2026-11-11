import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ADMIN_RESULT_TONE } from '../template/cal958.js'

// P964: admin polish. Source checks (this repo reads the files, as the other shell tests do).
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')

test('Overview: To-dos has no header and no Show all; Calendar sits at the bottom; rows and agents get the shared hover wave', () => {
  const ov = src('./screens/Overview.jsx')
  assert.doesNotMatch(ov, />Show all|Show fewer<|useTodoFit\(|<h2>To-dos<\/h2>/)
  assert.doesNotMatch(ov, />All agents</)
  const body = ov.slice(ov.indexOf('aria-label="To-dos"'))
  assert.ok(body.indexOf('adm-todo-list') < body.indexOf('adm-cal-go'), 'Calendar button after the list')
  const wave = src('../template/shell914.css')
  assert.match(wave, /\.fx-card:has\(\.fx-cover\), \.fx-wk-ev, \.adm-todo, \.adm-agent \{/)
  assert.match(wave, /\.fx-wk-ev:hover, \.adm-todo:hover, \.adm-agent:hover \{ translate: 0 -3px;/)
})

test('admin rail: the phone button is gone, a Calendar shortcut goes to the same calendar as the To-dos button', () => {
  const f = src('./AdminFrame.jsx')
  assert.doesNotMatch(f, /PhoneCall/)
  assert.match(f, /const calTo = `\$\{ap\('team'\)\}\?tab=calendar`/)
  assert.match(f, /aria-label="Calendar" data-tip="Calendar"/)
  // the VA rail keeps its phone button
  assert.match(src('../template/ful/FulFrame.jsx'), /Phone/)
})

test('Fulfillment Today: results map to green, amber, red; the outcome word stays on the chip', () => {
  assert.equal(ADMIN_RESULT_TONE.cancelled, 'green')
  assert.equal(ADMIN_RESULT_TONE.no_answer, 'warn')
  assert.equal(ADMIN_RESULT_TONE.failed, 'rose')
  const t = src('./screens/Team.jsx')
  assert.match(t, /ADMIN_RESULT_TONE\[c\.status\] \? ` is-res is-res-/)
  assert.match(t, /<small>\{c\.va\.split\(' '\)\[0\]\} · \{CALL_WORD\[c\.status\]\}<\/small>/)
  const css = src('./p964.css')
  for (const k of ['green', 'warn', 'rose', 'mute']) assert.ok(css.includes(`.adm-tc-call.is-res-${k}`), k)
})

test('Agent billing: Agent, Plan, Status, Next, Lead spend; stepper in $50 steps, no Raise button; Profit split above the stage', () => {
  const b = src('./screens/Billing.jsx')
  assert.match(b, /<span>Agent<\/span><span>Plan<\/span><span>Status<\/span><span>Next<\/span><span>Lead spend<\/span>/)
  assert.doesNotMatch(b, />Raise<|'Raise'/)
  assert.match(b, /const CAP_STEP = 50/)
  assert.match(b, /if \(next < a\.spend\) return/)
  assert.match(b, /Undo/)
  assert.ok(b.indexOf('<Split p={p} />') < b.indexOf('className="fx-tile adm-rev-stage"'), 'Profit split before the By week box')
  assert.ok(b.indexOf('<Split p={p} />') > b.indexOf('<Headline p={p}'))
})
