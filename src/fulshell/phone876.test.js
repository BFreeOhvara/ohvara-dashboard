import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { browserOf, bugContext, bugText, addSampleBug, sampleBugs, setSampleBugStatus, resetSampleBugs } from '../template/bugReport.js'

// P876 checks that read the source: the phone is an overlay that never changes the page's layout, there is no
// floating phone button, and VAs can't type a number to start a call.
const src = f => readFileSync(new URL(f, import.meta.url), 'utf8')
const css = postcss.parse(src('../template/ful/ful.css'))
const frame = src('../template/ful/FulFrame.jsx')
const phone = src('../template/ful/Phone.jsx')

test('the phone overlay never changes the page width: no ful.css rule moves or pads the page column for it', () => {
  const bad = []
  css.walkRules(rule => {
    if (!/\.(fx|tp)-col\b/.test(rule.selector)) return
    rule.walkDecls(d => { if (/^(margin|padding|width|max-width)/.test(d.prop)) bad.push(`${rule.selector} { ${d.prop}: ${d.value} }`) })
  })
  assert.deepEqual(bad, [])
  assert.doesNotMatch(frame, /has-dock-/, 'the frame no longer sets layout classes for the phone')
  let fixed = false
  css.walkRules('.fs-call', r => r.walkDecls('position', d => { fixed = d.value === 'fixed' }))
  assert.ok(fixed, 'the call screen is fixed over the page')
})

test('there is no floating phone button anywhere', () => {
  assert.doesNotMatch(phone, /fs-dock/)
  assert.doesNotMatch(frame, /fs-dock/)
  let rules = 0
  css.walkRules(/fs-dock/, () => { rules++ })
  assert.equal(rules, 0)
  assert.match(frame, /phoneIcon\('fx-ri fs-ri-phone'\)/, 'the rail icon opens it')
})

test('there is no dial-to-start: no number entry, and the keypad only sends tones during a call', () => {
  assert.doesNotMatch(phone, /placeholder="Name or number"|fs-ph-entry[^"]*"[^>]*>\s*<input data-first className="tp-num"/)
  assert.doesNotMatch(phone, /canDial|dialTarget/)
  const pads = [...phone.matchAll(/PAD\.map\(d => <button[^>]*onClick=\{([^}]*)\}/g)].map(m => m[1])
  assert.ok(pads.length >= 1)
  for (const on of pads) assert.match(on, /type: 'tone'/, 'every keypad key sends a tone on the live call')
})

test('Report a bug: captures the page, time, browser, screen and sender, and the text holds all of it', () => {
  const env = { location: { pathname: '/fulfillment/pay', search: '?tab=payouts' }, screen: { width: 1440, height: 900 }, innerWidth: 1440, innerHeight: 789,
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36' } }
  const ctx = bugContext(env, { name: 'Maya Brooks', role: 'Fulfillment' }, new Date('2026-11-07T19:05:00Z'))
  assert.equal(ctx.page, '/fulfillment/pay?tab=payouts')
  assert.equal(ctx.browser, 'Chrome 142 on Windows')
  assert.equal(ctx.screen, '1440×900 screen, 1440×789 window')
  const t = bugText({ happened: 'Payouts tab is blank ', expected: 'My last 4 payouts' }, ctx)
  assert.match(t, /What happened: Payouts tab is blank\n/)
  assert.match(t, /What they expected: My last 4 payouts/)
  assert.match(t, /Sent by: Maya Brooks \(Fulfillment\)/)
  assert.equal(browserOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari 18 on iOS')
})

test('a sample bug report saves as New, and moves to Seen then Fixed', () => {
  resetSampleBugs()
  const r = addSampleBug({ happened: 'Phone tab stuck', expected: '', file: { name: 'shot.png', size: 1200 } }, { who: 'Maya Brooks', role: 'Fulfillment', page: '/fulfillment', at: '2026-11-07T19:05:00Z' })
  assert.equal(sampleBugs()[0].id, r.id)
  assert.equal(r.status, 'new')
  assert.deepEqual(r.file, { name: 'shot.png', size: 1200 })
  setSampleBugStatus(r.id, 'seen'); assert.equal(sampleBugs()[0].status, 'seen')
  setSampleBugStatus(r.id, 'fixed'); assert.equal(sampleBugs()[0].status, 'fixed')
  resetSampleBugs()
})
