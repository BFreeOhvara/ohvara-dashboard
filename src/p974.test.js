// P974 — phone app round 4: nothing pinned at the top (titles and back targets scroll away, no strip under the
// status bar, no back arrows: swipe back), Clients built out (summary tiles, search, grouped list, a fuller client
// screen), Settings with everything about you on top, Account tiles as real buttons with a Theme switch and Lead
// spend as the one way into Billing, the version moved to Help, and Clients in the bar for servicing-only agents.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { tabsFor, tabsFromNav, routeOf, routeForTabs, parentFor, baseTabFor, groupClients, clientNow, clientSince, clientTimeline, leadOfClient, clientMatches, NOTE_KIND } from './template/m/appModel.js'
import { navFor } from './lib/products.js'

const read = f => readFileSync(new URL(f, import.meta.url), 'utf8')
const css = read('./template/m/app.css')

test('nothing pinned at the top: no status-bar strip, no blur, the sub-screen header scrolls with the page', () => {
  assert.doesNotMatch(css, /ma-statusbar/)
  assert.doesNotMatch(css, /is-scrolled/)
  assert.doesNotMatch(read('./template/m/MobileFrame.jsx'), /ma-statusbar|onPageScroll/)
  const k = read('./template/m/AppKit.jsx')
  const scroller = k.indexOf('<div className="ma-scroll ma-sub-scroll"')
  assert.ok(scroller > 0 && k.indexOf('<div className="ma-sub-h">') > scroller, 'the header row is inside the scroller')
  assert.doesNotMatch(k, /<header className="ma-sub-h"|ChevronLeft|onScroll/)
  assert.match(css, /\.ma-sub-h \{ position: relative;/)
  assert.match(css, /\.ma-subpage \.ma-sub-scroll \{ position: absolute; inset: 0;/)
})

test('no back arrows: an invisible 44 px Back target for VoiceOver (top-right "Close notifications")', () => {
  const k = read('./template/m/AppKit.jsx')
  assert.match(k, /className=\{`ma-backhit\$\{close \? ' is-end' : ''\}`\} aria-label=\{close \|\| 'Back'\} onClick=\{app\.back\}/)
  assert.match(css, /\.ma-backhit \{[^}]*width: 44px; height: 44px;[^}]*opacity: 0;/)
  assert.match(read('./template/m/ANotes.jsx'), /close="Close notifications"/)
  assert.match(css, /\.ma-grab \{/) // bottom sheets keep their handle
})

test('servicing-only agents: Clients takes Leads\' place in the bar; any lead product keeps Leads', () => {
  assert.deepEqual(tabsFor(['servicing']), ['home', 'clients', 'calendar', 'messages', 'account'])
  assert.deepEqual(tabsFor(['leads']), ['home', 'leads', 'calendar', 'messages', 'account'])
  assert.deepEqual(tabsFor(['reactivation']), ['home', 'leads', 'calendar', 'messages', 'account'])
  assert.deepEqual(tabsFor(['servicing', 'reactivation']), ['home', 'leads', 'calendar', 'messages', 'account'])
  assert.deepEqual(tabsFor(['leads', 'servicing']), ['home', 'leads', 'calendar', 'messages', 'account'])
  // live: adding a lead product flips it back
  assert.deepEqual(tabsFromNav(navFor(['servicing', 'leads'])), tabsFor(['leads']))
})

test('servicing-only routes: /clients is the tab, a client sits on it, /leads opens from Account', () => {
  const tabs = tabsFor(['servicing'])
  assert.deepEqual(routeForTabs(routeOf('/agent/clients', ''), tabs), { tab: 'clients', sub: null, id: null, over: null, overId: null })
  const c = routeForTabs(routeOf('/agent/clients/c1', ''), tabs)
  assert.equal(c.sub, 'clients'); assert.equal(c.id, 'c1')
  assert.equal(parentFor(c, '', tabs), null)
  assert.equal(baseTabFor(c, undefined, tabs), 'clients')
  const l = routeForTabs(routeOf('/agent/inbounds', ''), tabs)
  assert.equal(l.sub, 'leads')
  assert.equal(baseTabFor(l, 'account', tabs), 'account')
  // with leads in the bar nothing changes: a client still sits on the Clients screen
  const lt = tabsFor(['leads'])
  const c2 = routeForTabs(routeOf('/agent/clients/c1', ''), lt)
  assert.deepEqual(parentFor(c2, '', lt), { sub: 'clients', id: null, nested: '' })
  assert.equal(routeForTabs(routeOf('/agent/inbounds', ''), lt).tab, 'leads')
})

test('the frame, Account, Home and Today follow it', () => {
  const f = read('./template/m/MobileFrame.jsx')
  assert.match(f, /const tabs = tabsFromNav\(navKeys\)/)
  assert.match(f, /clients: AClientsTab/)
  assert.match(f, /case 'leads': return <ALeadsSub \/>/)
  const a = read('./template/m/AAccount.jsx')
  assert.match(a, /title="Leads" sub="Add leads, or import your own"/)
  assert.match(read('./template/m/AHome.jsx'), /navKeys\.has\('leads'\) \? all : all\.filter\(it => it\.key \|\| \(it\.kind !== 'lead' && it\.kind !== 'submit'\)\)/)
  assert.match(read('./template/m/ASubs.jsx'), /navKeys\.has\('leads'\) \|\| a\.kind === 'client'/)
})

const C = (id, first, extra = {}) => ({ id, client_first_name: first, client_last_name: 'Doe', client_phone: '(214) 555-0101', carrier_name: 'Northfield Mutual', product_name: 'Mortgage protection', ...extra })

test('Clients: grouped Needs attention → Working → Protected, filtered by tile and search; Closed only when asked', () => {
  const list = [C('a', 'Ann'), C('b', 'Bo', { carrier_name: 'Pinecrest' }), C('c', 'Cy'), C('d', 'Di')]
  const st = { a: 'protected', b: 'needs_attention', c: 'working', d: 'closed' }
  const statusOf = c => st[c.id]
  assert.deepEqual(groupClients(list, statusOf).map(g => [g.key, g.items.map(c => c.id)]), [['needs_attention', ['b']], ['working', ['c']], ['protected', ['a']]])
  assert.deepEqual(groupClients(list, statusOf, { f: 'working' }).map(g => g.key), ['working'])
  assert.deepEqual(groupClients(list, statusOf, { closed: true }).map(g => g.key), ['needs_attention', 'working', 'protected', 'closed'])
  assert.deepEqual(groupClients(list, statusOf, { q: 'pine' }).map(g => g.items[0].id), ['b'])
  assert.ok(clientMatches(C('x', 'X'), '555-0101'))
  assert.equal(groupClients(list, statusOf)[0].tone, 'apricot')
})

test('client screen: what is happening, since when, a timeline with sold / payments / old policy cancelled, the lead it came from', () => {
  const stages = { steps: [{ key: 'sold', state: 'done', at: 'Oct 27', label: 'Sold and submitted' }, { key: 'old_cancel', state: 'done', at: 'Oct 30', label: 'Old policy cancelled' }, { key: 'first_payment', state: 'current', label: 'First payment cleared' }], current: { key: 'first_payment', label: 'First payment cleared', next: null } }
  const c = C('a', 'Ann', { submitted: 'Tue, Oct 27' })
  assert.equal(clientNow(c, 'working', stages), 'First payment cleared')
  assert.equal(clientNow(c, 'needs_attention', stages), 'Waiting on you: is it still on the books?')
  assert.equal(clientSince(c, 'working', stages), 'since Oct 27')
  assert.equal(clientSince(c, 'needs_attention', stages, { draft: '2026-10-27' }), 'since the Oct 27 draft')
  const tl = clientTimeline({ ...c, checked_through: '2026-10-27' }, [{ id: 'x', who: 'Ann Doe', text: 'Payment cleared', at: 'Today, 9:40 AM' }], stages)
  assert.deepEqual(tl.map(e => e.kind), ['payment', 'drafted', 'cancel', 'sold'])
  assert.ok(NOTE_KIND.cancel && NOTE_KIND.drafted && NOTE_KIND.save)
  const leads = [{ id: 'l1', first_name: 'Ann', last_name: 'Doe', phone: '(214) 555-0101' }, { id: 'l2', first_name: 'Bo', last_name: 'Doe', phone: '' }]
  assert.equal(leadOfClient(c, leads)?.id, 'l1')
  assert.equal(leadOfClient(C('b', 'Bo', { client_phone: '' }), leads)?.id, 'l2')
  assert.equal(leadOfClient(C('z', 'Zed', { client_phone: '' }), leads), null)
  assert.equal(leadOfClient({ ...c, lead_id: 'l2' }, leads)?.id, 'l2')
})

test('Settings: you on top (photo, name, phone, email, states, carriers), short labels, Sign out and Delete', () => {
  const s = read('./template/m/ASettings.jsx')
  assert.match(s, /className="ma-glass ma-list ma-set ma-me ma-rise"/)
  for (const t of ['Licensed states', 'Carriers', 'Call hours', 'Time zone', 'Carrier emails', 'Email alerts', 'Plan', 'Card', 'Receipts', 'Password', 'Sign out', 'Delete account']) assert.match(s, new RegExp(`title="${t}"`))
  for (const g of ['Calls and calendar', 'Notifications', 'Plan and billing', 'Account']) assert.match(s, new RegExp(`<Group title="${g}">`))
  assert.doesNotMatch(s, /AppAbout|title="Appearance"/)
  assert.match(s, /if \(k === 'carriers'\)/)
})

test('Account: tiles are raised buttons with an arrow and a gap; Lead spend is the way into Billing; Theme switch; no About line', () => {
  const a = read('./template/m/AAccount.jsx')
  assert.match(a, /className="ma-tile-go"/)
  assert.match(a, /\{!leads && <Row onClick=\{\(\) => app\.open\(paths\.billing\(\)\)\}/) // no Billing row while Lead spend shows
  assert.match(a, /<Toggle on=\{dark\} label="Dark theme" onChange=\{v => setTheme\(v \? 'dark' : 'light'\)\} \/>/)
  assert.doesNotMatch(a, /AppAbout/)
  assert.match(css, /\.ma-tile:active \{ transform: translateY\(3px\);/)
  assert.match(css, /\.ma-tiles \+ \.ma-acct-list[^{]*\{ margin-top: 22px; \}/)
  assert.match(read('./template/m/AHelp.jsx'), /<AppAbout style=/)
})
