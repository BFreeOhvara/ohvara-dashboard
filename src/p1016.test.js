// P1016 — lead types: the list, the agent's one pick, the switch words, the by-type report, the sign-up step, the
// AI caller's one variable, and GoHighLevel's two fields. RUN: node --test src/p1016.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SAMPLE_TYPES, PICK_MAX, visibleTypes, popularKey, typeLabel, effectiveType, switchWords, byType } from './lib/coverageTypes.js'
import { emptyDetails, detailsMissing, fromSaved } from './lib/signupDetails.js'
import { DEFAULT_PRODUCT, SCRIPT, SCREEN_LINE, retellLlm, retellPrompt } from '../supabase/functions/ai-caller/retellSpec.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')

test('six types to start, Mortgage protection is Most popular, one pick', () => {
  assert.deepEqual(SAMPLE_TYPES.map(t => t.label), ['Mortgage protection', 'Final expense', 'IUL', 'Truckers', 'Veterans', 'Term life'])
  assert.equal(popularKey(SAMPLE_TYPES), 'mortgage_protection')
  assert.equal(PICK_MAX, 1)
  const mig = src('../supabase/migrations/281_lead_coverage_types.sql')
  for (const t of SAMPLE_TYPES) assert.match(mig, new RegExp(`\\('${t.key}',\\s+'${t.label}'`), `${t.key} seeded the same in 281`)
  assert.match(mig, /coverage_pick_max\(\) returns int language sql immutable\s+set search_path = public as \$\$ select 1 \$\$/)
})

test('hidden types drop off the picker; labels and the never-picked fallback', () => {
  const list = SAMPLE_TYPES.map(t => (t.key === 'term_life' ? { ...t, hidden: true } : t))
  assert.equal(visibleTypes(list).length, 5)
  assert.equal(typeLabel(list, 'iul'), 'IUL')
  assert.equal(typeLabel(list, null, 'none'), 'none')
  assert.equal(typeLabel([], 'final_expense'), 'Final expense')
  assert.equal(effectiveType(null, list), 'mortgage_protection')
  assert.equal(effectiveType('truckers', list), 'truckers')
})

test('switch words: tomorrow, else the day', () => {
  assert.equal(switchWords(SAMPLE_TYPES, 'final_expense', '2026-11-16', '2026-11-15'), 'Switches to Final expense tomorrow')
  assert.equal(switchWords(SAMPLE_TYPES, 'iul', '2026-11-18', '2026-11-15'), 'Switches to IUL on Wed, Nov 18')
  assert.equal(switchWords(SAMPLE_TYPES, null, null, '2026-11-15'), '')
})

test('by type: counts, and each agent\'s spend split by their own leads', () => {
  const leads = [
    { coverage: 'final_expense', agentId: 'a', booked: true, sold: true },
    { coverage: 'final_expense', agentId: 'a', booked: true, sold: false },
    { coverage: 'mortgage_protection', agentId: 'a', booked: false, sold: false },
    { coverage: 'iul', agentId: 'b', booked: true, sold: false },
    { coverage: null, agentId: 'b', booked: false, sold: false },
  ]
  const rows = byType(SAMPLE_TYPES, leads, [{ agentId: 'a', spendCents: 9000 }, { agentId: 'b', spendCents: 5001 }, { agentId: 'c', spendCents: 0 }])
  assert.deepEqual(rows.map(r => r.key), ['mortgage_protection', 'final_expense', 'iul', 'none'])
  const fe = rows.find(r => r.key === 'final_expense')
  assert.deepEqual([fe.leads, fe.booked, fe.sold, fe.spendCents, fe.perLeadCents], [2, 2, 1, 6000, 3000])
  assert.equal(rows.find(r => r.key === 'mortgage_protection').spendCents, 3000)
  assert.equal(rows.reduce((t, r) => t + r.spendCents, 0), 14001, 'no cent lost in the split')
  assert.equal(rows.find(r => r.key === 'none').label, 'No type yet')
})

test('sign-up: the lead type is picked on the same step as the states', () => {
  assert.equal(emptyDetails('America/Chicago').coverage, null)
  assert.ok(detailsMissing(emptyDetails('America/Chicago')).some(m => m.key === 'coverage'))
  assert.equal(fromSaved({ states: ['TX'], coverage: 'iul' }).coverage, 'iul')
  const sd = src('./components/agent/SignupDetails.jsx')
  assert.ok(sd.indexOf('sc-st-h') < sd.indexOf('sc-ty-h') && sd.indexOf('sc-ty-h') < sd.indexOf('sc-hr-h'), 'right after the states card')
})

test('AI caller: one script, one variable names the product', () => {
  assert.equal(DEFAULT_PRODUCT, 'life insurance')
  assert.match(SCRIPT.open, /about the \{\{product\}\} coverage you looked at\.$/)
  assert.match(SCREEN_LINE, /about the \{\{product\}\} information/)
  assert.doesNotMatch(retellPrompt(), /mortgage protection (form|information)/)
  assert.equal(retellLlm({ prompt: 'x', url: 'https://x.test/h' }).default_dynamic_variables.product, 'life insurance')
  assert.match(src('../supabase/functions/ai-caller/index.ts'), /coverage_words_for_lead/)
})

test('GoHighLevel: the type comes in on the lead and goes out on the campaign', () => {
  assert.match(src('../supabase/functions/ghl-webhook/core.ts'), /coverage_type: pick\('coverage_type', 'product'/)
  assert.match(src('../supabase/functions/ghl-push/core.ts'), /coverage_type: r\.coverage_type \?\? null, coverage_label/)
})

test('agent words never say ads (lead types)', () => {
  for (const f of ['./template/LeadTypeCard.jsx', './components/agent/SignupDetails.jsx', './components/agent/LeadTypePicker.jsx']) {
    const words = src(f).match(/>[^<>{}]*</g)?.join(' ') || ''
    assert.doesNotMatch(words, /\bads?\b|\bMeta\b|GoHighLevel/i, f)
  }
})
