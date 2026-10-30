// The live-transfer alert: polls only while Active and visible, rings on a row, stops on
// dismiss / row gone / 45s, stays silent when the function is missing; portaled to <body>.
//   node --test src/lib/transferAlert.test.js
// Fake timers, a fake document and a simulated my_incoming_transfer: no network, no React.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transferWatch, myIncomingTransfer, alertText, POLL_MS, RING_MS } from './transferAlert.js'

const ROW = { help_call_id: 'c1', transfer_started_at: '2026-10-29T21:19:40Z', lead_id: 'l1', caller_label: 'Dana' }
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const flush = () => new Promise(r => setTimeout(r, 0))

// Manual timers: advance(ms) runs what is due, in order.
function fakeTimers() {
  let now = 0
  let n = 0
  const jobs = new Map()
  const add = (fn, ms, every) => { const id = ++n; jobs.set(id, { fn, at: now + ms, every }); return id }
  return {
    setInterval: (fn, ms) => add(fn, ms, ms),
    setTimeout: (fn, ms) => add(fn, ms, 0),
    clearInterval: id => jobs.delete(id),
    clearTimeout: id => jobs.delete(id),
    async advance(ms) {
      const end = now + ms
      for (;;) {
        const due = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        const [id, j] = due
        now = j.at
        if (j.every) j.at += j.every
        else jobs.delete(id)
        j.fn()
        await flush()
      }
      now = end
      await flush()
    },
  }
}

function fakeDoc() {
  const fns = new Set()
  return {
    visibilityState: 'visible',
    addEventListener: (_e, fn) => fns.add(fn),
    removeEventListener: (_e, fn) => fns.delete(fn),
    hide() { this.visibilityState = 'hidden'; fns.forEach(f => f()) },
    show() { this.visibilityState = 'visible'; fns.forEach(f => f()) },
  }
}

function setup(rowFn = () => ROW) {
  const timers = fakeTimers()
  const doc = fakeDoc()
  const seen = []
  let polls = 0
  let rings = 0
  let stops = 0
  let ringing = false
  const w = transferWatch({
    fetchRow: async () => { polls++; return rowFn() },
    ring: () => { rings++; ringing = true; return () => { stops++; ringing = false } },
    onChange: r => seen.push(r),
    doc, timers,
  })
  return { w, timers, doc, seen, get polls() { return polls }, get rings() { return rings }, get stops() { return stops }, get ringing() { return ringing } }
}

test('transfer alert rings only while active', async () => {
  // Inactive: a row is waiting, but nothing polls, shows or rings.
  const t = setup()
  t.w.setActive(false)
  await t.timers.advance(60_000)
  assert.equal(t.polls, 0, 'no polls while inactive')
  assert.equal(t.rings, 0, 'no ring while inactive')
  assert.deepEqual(t.seen, [], 'no alert while inactive')

  // Active: polls at once and every 4s; the row shows the alert and rings once.
  t.w.setActive(true)
  await t.timers.advance(0)
  assert.equal(t.polls, 1)
  assert.deepEqual(t.seen, [ROW])
  assert.equal(t.rings, 1)
  assert.equal(t.ringing, true)
  await t.timers.advance(POLL_MS * 3)
  assert.equal(t.polls, 4, 'every 4s')
  assert.equal(t.rings, 1, 'the same call does not ring again')

  // Going inactive mid-ring: alert closes, ring stops, polling stops.
  t.w.setActive(false)
  assert.equal(t.ringing, false)
  assert.equal(t.seen.at(-1), null)
  const before = t.polls
  await t.timers.advance(30_000)
  assert.equal(t.polls, before, 'no polls after going inactive')
  t.w.stop()
})

test('the ring stops when the row is gone, on dismiss, and after 45s', async () => {
  let row = ROW
  const t = setup(() => row)
  t.w.setActive(true)
  await t.timers.advance(0)
  assert.equal(t.ringing, true)
  row = null
  await t.timers.advance(POLL_MS)
  assert.equal(t.ringing, false, 'row gone: ring stops')
  assert.equal(t.seen.at(-1), null, 'row gone: alert closes')

  row = { ...ROW, help_call_id: 'c2' }
  await t.timers.advance(POLL_MS)
  assert.equal(t.ringing, true, 'a new call rings')
  t.w.dismiss()
  assert.equal(t.ringing, false, 'dismiss: ring stops')
  assert.equal(t.seen.at(-1), null, 'dismiss: alert closes')
  await t.timers.advance(POLL_MS * 2)
  assert.equal(t.seen.at(-1), null, 'a dismissed call does not come back')

  row = { ...ROW, help_call_id: 'c3' }
  await t.timers.advance(POLL_MS)
  assert.equal(t.ringing, true)
  await t.timers.advance(RING_MS)
  assert.equal(t.ringing, false, 'stops after 45s')
  assert.equal(t.seen.at(-1)?.help_call_id, 'c3', 'the alert stays up after the ring stops')
  assert.equal(RING_MS, 45_000)
  assert.equal(POLL_MS, 4_000)
  t.w.stop()
})

test('polls only while the tab is visible', async () => {
  const t = setup(() => null)
  t.doc.visibilityState = 'hidden'
  t.w.setActive(true)
  await t.timers.advance(20_000)
  assert.equal(t.polls, 0, 'hidden tab: no polls')
  t.doc.show()
  await t.timers.advance(0)
  assert.equal(t.polls, 1)
  t.doc.hide()
  await t.timers.advance(20_000)
  assert.equal(t.polls, 1, 'hidden again: polling stopped')
  t.w.stop()
})

test('a missing my_incoming_transfer is silent and stops polling', async () => {
  const db = { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.my_incoming_transfer' } }) }
  assert.deepEqual(await myIncomingTransfer(db), { missing: true })
  const t = setup(() => ({ missing: true }))
  t.w.setActive(true)
  await t.timers.advance(POLL_MS * 5)
  assert.equal(t.polls, 1, 'asked once, then stopped')
  assert.deepEqual(t.seen, [])
  assert.equal(t.rings, 0)
  t.w.stop()
})

test('reads one row from the rpc and words the alert without a number', async () => {
  assert.deepEqual(await myIncomingTransfer({ rpc: async () => ({ data: [ROW], error: null }) }), ROW)
  assert.equal(await myIncomingTransfer({ rpc: async () => ({ data: [], error: null }) }), null)
  await assert.rejects(myIncomingTransfer({ rpc: async () => ({ data: null, error: { code: '500' } }) }))
  assert.equal(alertText(ROW), "Live call for you: Dana. We're calling your phone now. Pick up.")
  assert.equal(alertText({}), "Live call for you: New caller. We're calling your phone now. Pick up.")
})

test('alert is portaled to body', () => {
  const alert = src('../components/agent/TransferAlert.jsx')
  assert.match(alert, /import \{ createPortal \} from 'react-dom'/)
  assert.match(alert, /return createPortal\([\s\S]*,\s*document\.body,?\s*\)/)
  assert.match(alert, /if \(!on \|\| !row\) return null/, 'renders nothing while inactive')
  assert.match(alert, /We&rsquo;re calling your phone now\. Pick up\./)
  assert.doesNotMatch(alert, /#[0-9a-fA-F]{3,8}\b/, 'tokens only')
  // Mounted exactly once, in the v2 shell.
  const nav = src('../components/agent/PortalV2Nav.jsx')
  assert.equal((nav.match(/<TransferAlert \/>/g) || []).length, 1)
})
