// P977 — phone app round 5: VA calendar rows under the month (today picked), VA messages (Ohvara support, a DM with
// every VA, then agents), Edit profile on the top card, Settings as sections, Sign out as its own button, Schedule
// tab, dark mode on the desktop's panels.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { VA_LABEL, VA_SUBS, vaRouteOf, toVaStanding, dmThreadId } from './template/m/va/vaModel.js'

const read = f => readFileSync(new URL(f, import.meta.url), 'utf8')
const ME = '00000000-0000-0000-0000-00000000000b'
const LO = '00000000-0000-0000-0000-00000000000a'
const HI = '00000000-0000-0000-0000-00000000000c'
const AG = '00000000-0000-0000-0000-0000000000a9'

test('Schedule: the rota tab is called Schedule; Edit profile is a VA sub-screen', () => {
  assert.equal(VA_LABEL.rota, 'Schedule')
  assert.ok(VA_SUBS.includes('profile'))
  const r = vaRouteOf('/fulfillment/settings', '?s=settings&t=account')
  assert.equal(r.sub, 'settings'); assert.equal(r.id, 'account')
})

test('Messages: support line and one DM per other VA from the standing threads (either side of the pair)', () => {
  const rows = [
    { agent_id: ME, peer_id: null, peer_key: 'admin', agent_role: 'fulfillment', unread_count: 2, last_body: 'Hi', last_sender_id: AG, last_at: '2026-11-12T15:00:00Z' },
    { agent_id: LO, agent_name: 'Leo Grant', peer_id: ME, peer_key: ME, peer_name: 'Me', agent_role: 'fulfillment', unread_count: 1, last_body: 'Morning', last_sender_id: LO, last_at: '2026-11-12T14:00:00Z' },
    { agent_id: ME, agent_name: 'Me', peer_id: HI, peer_key: HI, peer_name: 'Sasha Ortiz', agent_role: 'fulfillment', unread_count: 0 },
    { agent_id: AG, agent_name: 'Dana Walker', peer_id: ME, peer_key: ME, agent_role: 'agent', unread_count: 0 },
  ]
  const { support, vas } = toVaStanding(rows, ME, Date.parse('2026-11-12T16:00:00Z'), 'America/Chicago')
  assert.equal(support.unread, 2)
  assert.deepEqual(support.dm, { agentId: ME, peerKey: 'admin' })
  assert.deepEqual(vas.map(v => v.name), ['Leo Grant', 'Sasha Ortiz'])
  assert.equal(vas[0].id, dmThreadId(LO))
  assert.deepEqual(vas[0].dm, { agentId: LO, peerKey: ME })
  assert.equal(vas[1].last, null) // empty until someone writes
  assert.equal(vas[0].last.from, 'them')
})

test('Messages list: support pinned first, then the VA DMs, then the agent threads; no group chat', () => {
  const s = read('./template/m/va/vaStore.js')
  assert.match(s, /return \[sup, \.\.\.vas\.sort\(/)
  assert.doesNotMatch(s, /teamStore|va-team-today/)
})

test('VA Calendar: no day pop-up, today picked by default, rows like the agent app', () => {
  const s = read('./template/m/va/VCalendar.jsx')
  assert.doesNotMatch(s, /BottomSheet/)
  assert.match(s, /const day = picked \|\| todayIso/)
  assert.match(s, /className=\{`ma-up is-\$\{STATE_TONE\[st\]\}/)
})

test('Account / Me: Edit profile on the card, Sign out its own button, Delete at the bottom of Settings → Account', () => {
  for (const f of ['./template/m/AAccount.jsx', './template/m/va/VMe.jsx']) {
    const s = read(f)
    assert.match(s, /ma-editbtn/, f)
    assert.match(s, /<SignOutButton \/>/, f)
  }
  const a = read('./template/m/ASettings.jsx')
  assert.match(a, /title="Account"[\s\S]*title="Notifications"[\s\S]*title="Calls and calendar"[\s\S]*title="Plan and billing"[\s\S]*title="Privacy and security"/)
  assert.doesNotMatch(a, /title="Sign out"/)
  assert.match(a, /ma-quiet-danger/)
  assert.doesNotMatch(read('./template/m/va/VMe.jsx'), /title="Sign out"/)
})

test('Dark mode: the phone glass is the desktop frosted panel', () => {
  const css = read('./template/m/app.css')
  assert.match(css, /--ma-glass: var\(--sh-glass-panel\);/)
  assert.match(css, /:root:not\(\[data-theme="light"\]\) \.ma-plan \{ background: var\(--sh-glass-panel-deep\)/)
})

test('Migration 270: VA pairs only between two VAs, lower id first, listed for every VA', () => {
  const sql = read('../supabase/migrations/270_va_direct_messages.sql')
  assert.match(sql, /me\.role::text = 'fulfillment' and p is not null and a < p and me\.id in \(a, p\)/)
  assert.match(sql, /select least\(me\.uid, v\.id\), greatest\(me\.uid, v\.id\)/)
})
