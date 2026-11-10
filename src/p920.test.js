// P920 — small fixes: a live call is Booked's blue, every count badge is centred by one shared style, and Change plan's
// slider stays inside the current plan's band (Other plans switch with a confirm). The centring itself was measured in a
// browser on every badge (agent, VA, admin; desktop and phone); these pin the rules in the source.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TIERS, bandOf, bandText, switchDaily, tierOf, monthlyBill } from './template/spendPlan.js'
import { LIVE_STATUS, agentStatus } from './template/agentView.js'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

test('a live call is Booked’s blue: the card, the chip, the to-do and the phone card', () => {
  assert.equal(LIVE_STATUS.tone, agentStatus('booked').tone)
  const css = read('./template/live910.css')
  assert.match(css, /--lf: var\(--sh-f-sky\); --li: var\(--sh-fi-sky\)/)
  assert.doesNotMatch(css, /--lf: var\(--sh-f-lilac\)/)
  assert.match(read('./template/m/m.css'), /\.mx-livecard \{ --cs: var\(--sh-cs-sky\)/)
  for (const f of ['./template/NeedsNow.jsx', './template/m/bits.jsx']) assert.match(read(f), /live: \{ tone: 'blue'/, f)
})

test('one badge style centres every count badge, each kind of badge is in it', () => {
  const css = read('./index.css')
  const rule = css.slice(css.indexOf('P920 — ONE count-badge style'))
  for (const c of ['.fx-tb', '.fx-badge', '.tp-tb', '.tp-ovcount', '.mx-badge', '.mx-count', '.ov-sb-badge', '.ph-tab-badge', '.pv-tb-badge', '.pv-badge']) assert.ok(rule.includes(c), c)
  assert.match(rule, /text-box: trim-both cap alphabetic/)
  assert.match(rule, /align-content: center/)
})

test('Change plan: the slider band is the current plan’s band, so dragging never changes the monthly price', () => {
  assert.deepEqual(TIERS.map(t => [t.key, t.from, t.to]), [['starter', 50, 75], ['growth', 76, 200], ['pro', 201, 500]])
  assert.deepEqual(TIERS.map(t => bandOf(t)), [{ lo: 50, hi: 75 }, { lo: 80, hi: 200 }, { lo: 205, hi: 500 }])
  for (const t of TIERS) {
    const { lo, hi } = bandOf(t)
    for (let d = lo; d <= hi; d += 5) assert.equal(tierOf(d).key, t.key, `${t.key} at ${d}`)
    assert.equal(monthlyBill({ plan: 'paid', spend: { daily: lo } }).membership, monthlyBill({ plan: 'paid', spend: { daily: hi } }).membership)
  }
  assert.equal(bandText(TIERS[2]), '$201–500')
  const b = read('./template/screens/Billing.jsx')
  assert.match(b, /const \{ lo, hi \} = bandOf\(tier\)/)
  assert.match(b, /<PlanSpend tier=\{tierNow\}/)
})

test('Change plan: Other plans lists each other plan with range and price; switching asks first, then saves', () => {
  const b = read('./template/screens/Billing.jsx')
  assert.match(b, /<h3>Other plans<\/h3>/)
  assert.match(b, /TIERS\.filter\(t => t\.key !== tierNow\.key\)/)
  assert.match(b, /Switch to \{t\.label\}/)
  // P921 replaced "Your plan becomes X from your next bill" with what it costs and when (src/p921.test.js).
  assert.match(b, /<b>\{changeWords\(c\)\}<\/b>/)
  // the save only runs from the confirm's button, never from the plan row
  assert.match(b, /onClick=\{\(\) => setAsk\(t\.key\)\}/)
  assert.match(b, /onClick=\{\(\) => \{ onSwitch\(to, start\); setAsk\(null\) \}\}/)
  // the daily spend lands inside the new band
  assert.equal(switchDaily(100, TIERS[2]), 205)
  assert.equal(switchDaily(300, TIERS[0]), 75)
  assert.equal(switchDaily(100, TIERS[1]), 100)
  assert.equal(switchDaily(52, TIERS[1]), 80)
})
