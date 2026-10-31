// The dev-only VA sample and the qualify entry in the capture list.
// Run: npm test -- vaSample
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checklistProgress, heldRow, startingChecklist } from './vaQueue.js'
import { sampleClaim, sampleQueue, sampleRecord, sampleRelease, sampleRoster, sampleCarriers } from './vaSample.js'

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const flat = s => s.replace(/\s+/g, ' ')

test('the sample opens with one lead held, so the page goes straight to the checklist', () => {
  const held = heldRow(sampleQueue())
  assert.equal(held?.lead_id, 'sample-qualify')
  const prog = checklistProgress(startingChecklist(held, null))
  assert.equal(prog.done, 2)
  assert.equal(prog.complete, false, 'the outcome stays locked in the shot')
})

test('the sample uses made-up 555 numbers and no city, so nothing is looked up', () => {
  for (const r of sampleQueue()) {
    assert.match(r.phone, /^\+1555/)
    assert.equal(r.city, null)
  }
  assert.ok(sampleRoster().length > 0)
  assert.ok(sampleCarriers().every(c => c.hours && c.hours_tz && c.hours_checked_at), 'fresh hours mean no hours lookup')
})

test('claim, release and record only change the sample in memory', () => {
  const expires = sampleClaim('sample-3')
  assert.ok(new Date(expires).getTime() > Date.now())
  assert.equal(sampleQueue().find(r => r.lead_id === 'sample-3').claimed_by_me, true)
  sampleRelease('sample-3')
  assert.equal(sampleQueue().find(r => r.lead_id === 'sample-3').claimed_by_me, false)
  sampleRecord('sample-3')
  assert.equal(sampleQueue().some(r => r.lead_id === 'sample-3'), false)
})

test('the fixture has no network or database path', () => {
  assert.equal(read('./vaSample.js').match(/supabase|\bfetch\(|^import /m), null)
})

test('every sample branch in the desk hook sits behind import.meta.env.DEV', () => {
  const hook = read('../hooks/useVaDesk.js')
  const lines = hook.split('\n')
  const imports = lines.flatMap((l, i) => (l.includes("import('../lib/vaSample')") ? [i] : []))
  assert.equal(imports.length, 6)
  for (const i of imports) {
    const above = lines.slice(Math.max(0, i - 4), i).join(' ')
    assert.match(above, /import\.meta\.env\.DEV && leadsSample\(\)/, `line ${i + 1}`)
  }
  assert.match(hook, /if \(!id && import\.meta\.env\.DEV && leadsSample\(\)\) id = 'sample-booking'/)
  assert.match(read('./leadsPage.js'), /import\.meta\.env\.DEV && new URLSearchParams/)
})

test('nothing imports the fixture statically', () => {
  for (const rel of ['../hooks/useVaDesk.js', '../components/fulfillment/VaDesk.jsx', '../pages/fulfillment/VaLeads.jsx', '../App.jsx']) {
    assert.equal(read(rel).match(/^import .*vaSample/m), null, rel)
  }
})

test('the qualify route keeps the page guard, and the page still opens a lead by tapping it', () => {
  const app = flat(read('../App.jsx'))
  assert.match(app, /<Route path="\/fulfillment\/leads" element=\{ <ProtectedRoute allowedRoles=\{\['fulfillment', 'admin'\]\}> <DashboardLayout><VaLeads \/><\/DashboardLayout>/)
  const page = flat(read('../pages/fulfillment/VaLeads.jsx'))
  assert.match(page, /desk\.claim\.mutate\(row\.lead_id/)
  assert.match(page, /const restored = heldRow\(desk\.queue\.data\)/)
})

test('the capture list has the qualify entry the runner reads', () => {
  const list = JSON.parse(read('../../qa/capture-views.json'))
  assert.equal(typeof list._recipe, 'string')
  const v = list.views.find(x => x.id === 'va-qualify')
  assert.equal(v.route, '/fulfillment/leads?sample=1')
  assert.equal(v.role, 'fulfill')
  assert.deepEqual(v.widths, [390])
  assert.deepEqual(v.themes, ['light', 'dark'])
  assert.ok(v.triggers.length > 0)
  for (const t of v.triggers) assert.ok(read(`../../${t}`).length > 0, t)
  assert.ok(read('../components/fulfillment/VaDesk.jsx').includes('CHECKLIST_ITEMS[0].label'))
  assert.ok(read('./vaQueue.js').includes(`label: '${v.expect}'`), 'expect is the first checklist item')
  assert.equal(v.pending, undefined)
})
