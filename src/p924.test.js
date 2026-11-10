// P924 — clients reach our team, not the agent; the check the day after the draft; a simpler agent side; one button.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, globSync } from 'node:fs'
import { ringOrder, ringReason, fillPod, textIntent, textToWork, autoReply, contactCard, SAVE_OUTCOMES, CLIENT_LINE_WORDS, fill } from './lib/clientLine.js'
import { CHECK_DEFAULTS } from './lib/clientCheck.js'
import { outcomesOf } from './lib/vaServicing.js'

const src = f => readFileSync(f, 'utf8')
const files = globSync('src/**/*.{js,jsx}').map(f => f.replaceAll('\\', '/')).filter(f => !/\.test\.jsx?$/.test(f))

const VAS = [{ id: 'v1', onShift: true }, { id: 'v2', onShift: true }, { id: 'v3', onShift: true }, { id: 'v4', onShift: false }]

test('a call in rings the VA who last talked with the caller, then the pod, then any free VA, then a callback', () => {
  assert.deepEqual(ringOrder({ vas: VAS, pod: ['v2', 'v3'], lastVa: 'v3' }), { ring: ['v3', 'v2', 'v1'], then: 'callback' })
  // The last VA is busy: the pod first.
  assert.deepEqual(ringOrder({ vas: VAS.map(v => (v.id === 'v3' ? { ...v, busy: true } : v)), pod: ['v2', 'v3'], lastVa: 'v3' }).ring, ['v2', 'v1'])
  // Off shift never rings; nobody free → straight to the booked callback.
  assert.deepEqual(ringOrder({ vas: VAS, pod: ['v4'], lastVa: 'v4' }).ring, ['v1', 'v2', 'v3'])
  assert.deepEqual(ringOrder({ vas: VAS.map(v => ({ ...v, busy: true })), pod: ['v1'] }), { ring: [], then: 'callback' })
  assert.equal(ringReason('v3', { pod: ['v2', 'v3'], lastVa: 'v3' }), 'Talked with this caller last')
  assert.equal(ringReason('v2', { pod: ['v2', 'v3'], lastVa: 'v3' }), 'On this number')
  assert.equal(ringReason('v1', { pod: ['v2', 'v3'], lastVa: 'v3' }), 'Any free VA')
})

test('each number gets 2–3 VAs, spread across the team', () => {
  assert.equal(fillPod([], ['a', 'b', 'c', 'd']).length, 3)
  assert.deepEqual(fillPod(['b'], ['a', 'b', 'c'], [['a', 'c']]).slice(0, 1), ['b'])
  assert.deepEqual(fillPod([], ['a', 'b', 'c', 'd'], [['a', 'b', 'c']]), ['d', 'a', 'b'])
  assert.deepEqual(fillPod([], ['a']), ['a'])
})

test('a client text becomes a booked call or a pod task with one automatic reply', () => {
  assert.equal(textIntent('I want to cancel my policy'), 'cancel')
  assert.equal(textIntent('my card was declined this month'), 'payment')
  assert.equal(textIntent('I moved, can you update my address'), 'change')
  assert.equal(textIntent('does it cover my wife?'), 'question')
  assert.equal(textIntent(''), 'question')
  const w = textToWork({ body: 'my bank draft bounced', va: 'Sarah', when: 'today at 3 PM' })
  assert.deepEqual([w.intent, w.kind, w.booked], ['payment', 'payment_change', true])
  assert.equal(w.reply, 'Got it. Sarah from our care team will call you today at 3 PM.')
  assert.match(textToWork({ body: 'new address 4 Elm St', va: 'Sarah', when: 'today' }).reply, /is on it/)
  assert.match(autoReply({ intent: 'question', va: 'Sarah', when: 'tomorrow at 9 AM', afterHours: true }), /closed for the night\. Sarah will call you tomorrow at 9 AM\./)
})

test('the welcome text carries a Deedstone Insurance contact card', () => {
  const v = contactCard('(214) 555-0101')
  assert.match(v, /^BEGIN:VCARD\r\nVERSION:3\.0\r\nFN:Deedstone Insurance\r\n/)
  assert.match(v, /TEL;TYPE=VOICE,TEXT:2145550101/)
  assert.match(fill(CLIENT_LINE_WORDS.welcome_card, { first: 'Ann' }), /^Welcome to Deedstone Insurance, Ann!.*Contact card attached\. Reply STOP to stop\.$/)
  assert.match(src('src/template/screens/Submit.jsx'), /CLIENT_LINE_WORDS\.welcome_card/)
})

test('"Still on the books?" the day after the draft; No → a save call that ends with the agent or in Closed', () => {
  assert.equal(CHECK_DEFAULTS.delayDays, 1)
  assert.deepEqual(SAVE_OUTCOMES.map(o => o[0]), ['saved', 'to_agent', 'agent_booked', 'fixing', 'not_saved', 'no_answer'])
  assert.deepEqual(outcomesOf('lapse_save'), SAVE_OUTCOMES)
  const sql = src('supabase/migrations/258_client_line.sql')
  assert.match(sql, /alter column check_delay_days set default 1/)
  assert.match(sql, /closed_reason = left\(btrim\(p_reason\), 80\)/)
  assert.match(src('src/template/ful/screens/Servicing.jsx'), /NOT_SAVED_REASONS/)
  assert.match(src('src/lib/clientStages.js'), /hand them to you: live, or a call on your calendar/)
})

test('help-voice rings our team, not the agent first; the number called picks the pod', () => {
  const core = src('supabase/functions/help-voice/core.ts')
  assert.doesNotMatch(core, /await inboundToAgent\(/)
  assert.match(core, /route\.routeInbound\(callSid, caller, toE164\(form\.To/)
  assert.match(src('supabase/functions/ghl-webhook/core.ts'), /client_text_intake/)
})

test('agent side: no Request a service, no Log a call, no Closed on Leads, one set of hours', () => {
  assert.ok(!existsSync('src/template/screens/RequestService.jsx'))
  for (const f of ['src/template/TemplateFrame.jsx', 'src/template/m/MobileFrame.jsx', 'src/template/m/MMore.jsx', 'src/template/screens/Submit.jsx']) {
    assert.doesNotMatch(src(f), /Request a service|Log a call/, f)
  }
  assert.match(src('src/template/TemplateFrame.jsx'), /Book a call/)
  const leads = src('src/template/screens/Leads.jsx')
  assert.doesNotMatch(leads, /Show closed|CLOSED_LANE/)
  assert.match(leads, /Not interested|notInterested|not_interested/i)
  assert.match(src('src/template/screens/Clients.jsx'), /closed/i, 'Clients keep Closed')
  for (const f of files) assert.doesNotMatch(src(f), /<TakeLeads[ />]/, f)
  for (const f of ['src/template/screens/Settings.jsx', 'src/template/screens/Billing.jsx', 'src/template/screens/Welcome.jsx', 'src/template/m/MMore.jsx']) assert.doesNotMatch(src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''), /Appointments only|live-call hours/i, f)
  const st = src('src/template/screens/Settings.jsx')
  assert.equal((st.match(/<HoursEditor\b/g) || []).length, 1)
})

// P929 replaced P924's left list: Settings is back to the profile card + tabs (src/p929.test.js). Wording stays.
test('P934: Wording to approve is its own admin rail page', () => {
  assert.match(src('src/adminshell/screens/Work934.jsx'), /<WordingToApprove \/>/)
  assert.match(src('src/adminshell/AdminFrame.jsx'), /ap\('wording'\)/)
})

test('no "draft" notes on screen in any role', () => {
  const shown = /(>|'|")\s*(Draft wording|Draft v1|· draft wording|The exact wording is a draft|What it says \(drafts\))/
  for (const f of files) assert.doesNotMatch(src(f), shown, f)
  for (const f of files.filter(f => /\.jsx$/.test(f))) assert.doesNotMatch(src(f), /<SampleTag>Draft<\/SampleTag>|<Pending>/, f)
})

test('one secondary button for every role, filled, with hover and pressed states', () => {
  const css = src('src/template/buttons924.css')
  assert.match(src('src/template/glass.css'), /^@import '\.\/buttons924\.css';/)
  for (const s of [':hover:not(:disabled)', ':active:not(:disabled)', ':focus-visible', ':disabled']) assert.ok(css.includes(s), s)
  assert.match(css, /background: color-mix\(in srgb, var\(--sh-ink\) 14%, var\(--sh-surface\)\)/)
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'tokens only')
})
