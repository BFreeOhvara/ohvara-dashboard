import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pickOrder } from './adminshell/p879.js'
import { OWNER_SPLIT, admSnapshot } from './adminshell/data.js'
import { isUnassigned } from './adminshell/words.js'
import { canPreviewReal } from './lib/dataMode.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// P934 (Brayden, Nov 10): "scroll down, click the profile icon, the whole header vanishes", in every role.
test('the open-panel lock is on <html> only, and keeps <body> from becoming its own scroll box', () => {
  const css = src('./template/panels929.css').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(css, /html:has\(body :is\(\.tp-layer, \.fx-layer, \.mx-layer\):not\(\.fs-call-layer\)\) \{ overflow: hidden; \}/)
  assert.doesNotMatch(css, /\) body \{ overflow: hidden/)
  assert.match(css, /\) body \{ overflow: visible; \}/)
})

test('the profit split is a constant, 50 / 50', () => {
  assert.equal(OWNER_SPLIT, 50)
})

test('no sample unmatched lead; a real one is routed from its notification, agents on its campaign first', () => {
  assert.equal(admSnapshot().leads.filter(isUnassigned).length, 0)
  const agents = [
    { id: 'c', name: 'Bo', states: ['FL'], active: true },
    { id: 'b', name: 'Amy', states: ['TX'], active: true },
    { id: 'a', name: 'Zed', states: ['TX'], active: true, campaignId: 'c1' },
  ]
  const order = pickOrder(agents, { state: 'TX', campaignId: 'c1' }).map(a => a.id)
  assert.equal(order[0], 'a', 'on the campaign it came from: first')
  assert.equal(order.at(-1), 'c', 'not licensed in the lead state: last')
  assert.doesNotMatch(src('./adminshell/AdminFrame.jsx'), /aria-label="Route a lead"/)
})

test('agents and VAs have no Sample / Real view; admins get one Sample info pill', () => {
  assert.equal(canPreviewReal({ role: 'agent' }), false)
  assert.equal(canPreviewReal({ role: 'fulfillment' }), false)
  assert.equal(canPreviewReal({ role: 'admin' }), true)
  assert.doesNotMatch(src('./template/TemplateFrame.jsx'), /<ViewToggle/)
  assert.doesNotMatch(src('./template/ful/FulFrame.jsx'), /<ViewToggle/)
  assert.match(src('./template/ViewToggle.jsx'), /Sample info/)
})

test('Settings: one row of tabs, working pages on the rail, old links land where they went', () => {
  const s = src('./adminshell/screens/Settings.jsx')
  const tabs = s.match(/const TABS = \[([\s\S]*?)\]\]/)[1].match(/\['(\w+)'/g)
  assert.ok(tabs.length <= 9, `${tabs.length} tabs`)
  for (const k of ['bugs', 'numbers', 'wording', 'training', 'compliance', 'split', 'switches']) assert.ok(!tabs.includes(`['${k}'`), k)
  assert.match(s, /MOVED\[asked\]/)
  const f = src('./adminshell/AdminFrame.jsx')
  for (const k of ['bugs', 'numbers', 'compliance']) assert.ok(f.includes(`ap('${k}')`), k)
  // P936: Training, Wording to approve and Carrier playbook left the rail.
  for (const k of ['wording', 'training', 'playbook']) assert.ok(!f.includes(`ap('${k}')`), k)
  assert.doesNotMatch(src('./adminshell/screens/Clients.jsx'), /PillTabs label="Clients and servicing"/)
})
