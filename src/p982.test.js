// P982 — phone app round 6: back arrows return (tap or swipe), a real screen stack (Back goes one screen at a time,
// the screen underneath already there), Search never pops the keyboard by itself, red Sign out, "Message Ohvara
// support", the VA phone (dialer, minimise to a green pill), and the iPhone-style call screen (3×2 grid, keypad
// swap with Hide, Add (+) carrier or number, Notes).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stackOf, screenKey } from './template/m/appModel.js'

const read = f => readFileSync(new URL(f, import.meta.url), 'utf8')
const kit = read('./template/m/AppKit.jsx')
const css = read('./template/m/app.css')
const vcss = read('./template/m/va/va.css')
const call = read('./template/m/va/VCall.jsx')

test('stackOf: the screen right under the top one, one at a time; falls back to the parent', () => {
  const settings = { key: screenKey('settings', null), route: { sub: 'settings', id: null }, href: '/fulfillment/more?s=settings', tab: 'me' }
  const account = { key: screenKey('settings', 'account'), route: { sub: 'settings', id: 'account' }, href: '/fulfillment/more?s=settings&t=account', tab: 'me' }
  const pwd = screenKey('profile', null)
  // three deep: Me → Settings → Account → (top) profile
  let s = stackOf(JSON.stringify([settings, account]), pwd)
  assert.equal(s.under.key, account.key)
  assert.equal(s.stack.length, 2)
  // back once: Account is on top, Settings sits under it
  s = stackOf(JSON.stringify(s.stack.slice(0, -1)), account.key)
  assert.equal(s.under.key, settings.key)
  // back again: Settings on top, nothing under it (the tab)
  s = stackOf(JSON.stringify([]), settings.key)
  assert.equal(s.under, null)
  // the top screen never sits under itself; junk and no stack fall back to the parent
  assert.equal(stackOf(JSON.stringify([settings]), settings.key).under, null)
  assert.equal(stackOf('not json', 'x:a:', settings).under.key, settings.key)
  assert.equal(stackOf('', 'x:a:', null).under, null)
  assert.deepEqual(stackOf(JSON.stringify([settings]), null), { under: null, stack: [] })
})

test('both frames keep the stack in the address state and go back one screen at a time', () => {
  for (const f of ['./template/m/MobileFrame.jsx', './template/m/va/VaApp.jsx']) {
    const s = read(f)
    assert.ok(s.includes('stackOf(stackJson, topKey'), f)
    assert.ok(s.includes('state: { tab, stack: pushKey }'), f)
    assert.ok(s.includes('if (window.history.state?.idx > 0) { navigate(-1); return }'), f)
    assert.ok(s.includes('ma-layer-r${top ? \'\' : \' is-under\'}'), f)
  }
  // each Settings screen in the stack knows its own section (the address only knows the top one)
  assert.ok(read('./template/m/ASettings.jsx').includes("typeof nested === 'string' ? nested || null"))
})

test('back arrow: a plain chevron (no circle), in the title row so it scrolls away; chats pin it on a soft fade', () => {
  assert.ok(kit.includes('export function BackArrow'))
  assert.ok(kit.includes('<ChevronLeft size={30}'))
  assert.match(css, /\.ma-back \{[^}]*background: none;/)
  assert.ok(kit.includes('className="ma-pinh"'))
  assert.match(css, /\.ma-pinh \{[^}]*linear-gradient\(180deg/)
  assert.doesNotMatch(css, /\.ma-pinh \{[^}]*border:/)
  assert.ok(read('./template/m/AMessages.jsx').includes('<SubPage pin title={t.name}'))
  assert.ok(read('./template/m/va/VMessages.jsx').includes('pin foot={foot} className="is-chat"'))
})

test('Search never focuses itself; the keyboard comes up only on a tap', () => {
  const v = read('./template/m/va/VSubs.jsx')
  assert.doesNotMatch(v, /\.focus\(\)/)
  assert.ok(v.includes('useNoAutoKeyboard(input)'))
  const a = read('./template/m/ASubs.jsx')
  assert.doesNotMatch(a, /autoFocus/)
  assert.ok(a.includes('useNoAutoKeyboard(input)'))
  assert.ok(read('./template/m/useKeyboard.js').includes('export function useNoAutoKeyboard'))
})

test('Sign out is red; Help says "Message Ohvara support" in both apps (no names)', () => {
  assert.match(css, /\.ma-signout \{ color: var\(--sh-f-coral\); \}/)
  assert.ok(read('./template/m/AAccount.jsx').includes('title="Help" sub="Message Ohvara support"'))
  const me = read('./template/m/va/VMe.jsx')
  assert.ok(me.includes('title="Help" sub="Message Ohvara support"'))
  assert.doesNotMatch(me, /Message Brayden or Jordan/)
})

test('VA phone: a phone button on Today and on Calendar rows; minimise to a green pill and back', () => {
  assert.ok(read('./template/m/va/VToday.jsx').includes('onClick={vc.openPhone}'))
  assert.ok(read('./template/m/va/VCalendar.jsx').includes('className="va-rowcall ma-press"'))
  assert.ok(call.includes('{call && !call.end && mini && <CallPill'))
  assert.ok(call.includes('onMin={() => setMini(true)}'))
  assert.ok(call.includes('aria-label="Minimise the call"'))
  assert.match(vcss, /\.va-pill \{[^}]*position: fixed; z-index: 140;[^}]*background: var\(--sh-sage\)/)
})

test('call screen: 3×2 grid in order, keypad swaps into the same spot with Hide, Add (+) and Notes sheets', () => {
  const grid = call.slice(call.indexOf('<div className="va-call-grid">'))
  const order = ["btn('spk'", "btn('mute'", "btn('hold'", "btn('pad'", "btn('add'", "btn('notes'"].map(k => grid.indexOf(k))
  assert.ok(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), String(order))
  assert.ok(call.includes('? <Pad onKey={k => { act({ type: \'tone\', key: k }); srv(\'dtmf\', { digits: k }) }} />'))
  assert.ok(call.includes('className="va-hide" onClick={() => act({ type: \'pad\' })}>Hide</button>'))
  assert.doesNotMatch(call, /Add carrier/)
  assert.ok(call.includes("return sug && !q.trim() ? [sug, ...all.filter(c => c.id !== sug.id)] : all")) // suggested carrier first
  assert.ok(call.includes("srv('ring_carrier', { carrier_id: p.id })"))
  assert.ok(call.includes('function NotesSheet'))
  assert.ok(call.includes('actions.saveCallNotes?.(id, call.notes)'))
  // the result sheet still can't be skipped
  assert.ok(call.includes("onClick={() => setShake(n => n + 1)}"))
})
