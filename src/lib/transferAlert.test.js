// The live-transfer alert: polls only while Active and visible, rings on a row, stops on
// dismiss / row gone / 45s, stays silent when the function is missing; portaled to <body>.
//   node --test src/lib/transferAlert.test.js
// Fake timers, a fake document and a simulated my_incoming_transfer: no network, no React.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transferWatch, myIncomingTransfer, alertText, acceptTransfer, cantTakeTransfer, answerOnce, POLL_MS, RING_MS } from './transferAlert.js'

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

// A database that records every call. No table writes exist on it, so a stray one throws.
function fakeDb(error = null) {
  const calls = []
  return { calls, rpc: async (fn, args) => { calls.push([fn, args]); return { data: true, error } } }
}

test('accept only sends the acknowledgement and never marks the call connected', async () => {
  const db = fakeDb()
  await acceptTransfer(db, ROW)
  assert.deepEqual(db.calls, [['agent_accept_transfer', { p_lead: 'l1' }]])

  // Only the function touches the call: no table write here or in the alert, no connected status.
  const lib = src('./transferAlert.js')
  const alert = src('../components/agent/TransferAlert.jsx')
  for (const s of [lib, alert]) {
    assert.doesNotMatch(s, /\.from\(|\.update\(|\.insert\(/)
    assert.doesNotMatch(s, /status:\s*'transferred'|outcome:\s*'transferred'|transferred_at:/)
  }
})

test('a call with no lead yet still sends, with a null lead', async () => {
  const db = fakeDb()
  await cantTakeTransfer(db, { help_call_id: 'c9', lead_id: null })
  assert.deepEqual(db.calls, [['agent_missed_transfer', { p_lead: null }]])
})

test("Can't take it is idempotent: two taps send once and close once", async () => {
  const db = fakeDb()
  let closes = 0
  const answer = answerOnce({ close: () => { closes++ } })
  const send = row => cantTakeTransfer(db, row)
  await Promise.all([answer(send, ROW), answer(send, ROW)])
  await answer(send, ROW)
  assert.equal(db.calls.length, 1)
  assert.equal(closes, 1)
  // The next call is a new answer.
  await answer(send, { ...ROW, help_call_id: 'c2' })
  assert.equal(db.calls.length, 2)
  assert.equal(closes, 2)
})

test('a missing function closes cleanly; any other failure closes too', async () => {
  for (const send of [acceptTransfer, cantTakeTransfer]) {
    const missing = fakeDb({ code: 'PGRST202', message: 'Could not find the function' })
    await assert.doesNotReject(send(missing, ROW))
    await assert.rejects(send(fakeDb({ code: '500' }), ROW))

    let closes = 0
    const answer = answerOnce({ close: () => { closes++ } })
    await answer(row => send(missing, row), ROW)
    await answer(row => send(fakeDb({ code: '500' }), row), { ...ROW, help_call_id: 'c2' })
    assert.equal(closes, 2)
  }
})

test('the ring cap is not a miss: nothing is sent when it runs out', async () => {
  const db = fakeDb()
  const t = setup()
  t.w.setActive(true)
  await t.timers.advance(RING_MS * 2)
  assert.equal(t.ringing, false)
  assert.deepEqual(db.calls, [])
  t.w.stop()
  const alert = src('../components/agent/TransferAlert.jsx')
  assert.doesNotMatch(alert, /setTimeout|setInterval/, 'the alert has no timer of its own')
  assert.doesNotMatch(src('./transferAlert.js'), /(setTimeout|setInterval)[^\n]*(cantTake|agent_missed)/)
})

test('the alert offers Accept and Can’t take it, wired to their functions', () => {
  const alert = src('../components/agent/TransferAlert.jsx')
  assert.match(alert, />Accept</)
  assert.match(alert, /Can&rsquo;t take it/)
  assert.ok(alert.includes('answer(r => acceptTransfer(supabase, r), row)'))
  assert.ok(alert.includes('answer(r => cantTakeTransfer(supabase, r), row)'))
  assert.doesNotMatch(alert, /Dismiss/)
})

test('alert is portaled to body', () => {
  const alert = src('../components/agent/TransferAlert.jsx')
  assert.match(alert, /import \{ createPortal \} from 'react-dom'/)
  assert.match(alert, /return createPortal\([\s\S]*,\s*document\.body,?\s*\)/)
  assert.match(alert, /if \(!on \|\| !row\) return null/, 'renders nothing while inactive')
  assert.match(alert, /We&rsquo;re calling your phone now\. Pick up\./)
  assert.doesNotMatch(alert, /#[0-9a-fA-F]{3,8}\b/, 'tokens only')
  // Mounted for every agent, once per layout path: DashboardLayout's desktop branch and PhoneShell
  // (DashboardLayout returns PhoneShell on a phone). Gated on the agent role only; the v2 shell no longer mounts it.
  for (const f of ['../components/layout/DashboardLayout.jsx', '../components/layout/PhoneShell.jsx']) {
    const file = src(f)
    assert.equal((file.match(/<TransferAlert \/>/g) || []).length, 1, f)
    assert.match(file, /\{profile\?\.role === 'agent' && <TransferAlert \/>\}/, f)
  }
  const layout = src('../components/layout/DashboardLayout.jsx')
  assert.ok(layout.indexOf('<TransferAlert />') > layout.indexOf('<PhoneShell>'), 'desktop mount sits after the phone early return')
  assert.doesNotMatch(src('../components/agent/PortalV2Nav.jsx'), /<TransferAlert \/>/)
})
