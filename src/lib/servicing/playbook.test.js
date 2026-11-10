import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLAYBOOK, PLAYBOOK_CARRIERS, ACTIONS, METHOD, pathFor, entryFor, openState, doItNow, nextTimes, hoursLine, at, actionOf, esignStage } from './playbook.js'
import { findCarrier, CARRIER_CATALOG } from '../carriers/catalog.js'
import { estimateWait, holdUpdate, needOf, summaryOf, choicesOf, needsCallback, callbackLine } from '../../../supabase/functions/_shared/frontDesk.js'

test('every playbook carrier is in the catalog and has a method for every action', () => {
  assert.ok(PLAYBOOK.length >= 16)
  for (const p of PLAYBOOK) {
    assert.ok(CARRIER_CATALOG.some(c => c.id === p.key), `${p.key} in catalog`)
    assert.ok(p.source?.startsWith('https://'), `${p.key} source`)
    for (const a of ACTIONS) {
      const s = p.actions[a]
      assert.ok(s, `${p.key} ${a}`)
      assert.ok(METHOD[s.method], `${p.key} ${a} method ${s.method}`)
      assert.ok(Array.isArray(s.have) && s.have.length, `${p.key} ${a} have-ready list`)
      if (s.method === 'check') continue
      if (s.method === 'esign') assert.ok(s.form && ['fax', 'email', 'upload'].includes(s.via) && s.to, `${p.key} ${a} e-sign needs form + where to send`)
    }
  }
  assert.equal(new Set(PLAYBOOK_CARRIERS.map(c => c.name)).size, PLAYBOOK.length)
})

test('the agents’ most used carriers are all in the playbook', () => {
  for (const n of ['Americo', 'Mutual of Omaha', 'Transamerica', 'Foresters', 'Globe Life', 'Corebridge', 'AIG', 'Aetna', 'Royal Neighbors', 'Gerber Life', 'Liberty Bankers', 'SBLI', 'Ethos', 'Lincoln Financial']) {
    const e = entryFor(n, 'cancel')
    assert.ok(e.entry, `${n} has an entry`)
  }
})

test('a beneficiary change at a form carrier takes the e-sign path', () => {
  const p = pathFor('Americo', 'beneficiary_change')
  assert.equal(p.path, 'esign')
  assert.equal(p.wetInk, true)       // Americo wants wet ink on this one: print, sign, photo
  const f = pathFor('Foresters', 'beneficiary_change')
  assert.equal(f.path, 'esign'); assert.equal(f.step.via, 'fax'); assert.equal(f.step.to, '(877) 329-4631')
  assert.match(f.line, /e-sign link/)
})

test('phone-only, online-only and unconfirmed changes go to a merge call', () => {
  assert.equal(pathFor('Globe Life', 'cancel').path, 'merge')
  assert.equal(pathFor('Mutual of Omaha', 'bank').path, 'merge')
  const t = pathFor('Transamerica', 'address_change')
  assert.equal(t.path, 'merge'); assert.equal(t.learn, true)
})

test('an unknown carrier is learned on the call', () => {
  const p = pathFor('Zebra Mutual of Nowhere', 'beneficiary')
  assert.equal(p.known, false); assert.equal(p.learn, true); assert.equal(p.path, 'merge')
  assert.match(p.line, /New carrier: we’ll learn it on this call/)
})

test('a saved edit wins over the seed', () => {
  const edits = { 'cat-transamerica': { address: { method: 'esign', esign: 'unknown', form: 'TA address form', via: 'fax', to: '(800) 000-0000', have: ['Policy number'] } } }
  assert.equal(pathFor('Transamerica', 'address', edits).path, 'esign')
  assert.equal(pathFor('Transamerica', 'cancel', edits).path, 'merge')
})

test('do it now: bank change with the carrier open', () => {
  const americo = findCarrier('Americo')
  const r = doItNow(americo, at('2026-11-10T10:00'), { name: 'Americo' })
  assert.equal(r.mode, 'now'); assert.match(r.say, /hold while I reach Americo/)
})

test('carrier closing soon → tomorrow at its open + 1 hour', () => {
  const americo = findCarrier('Americo')
  const r = doItNow(americo, at('2026-11-10T16:45'), { name: 'They' })
  assert.equal(r.mode, 'closing')
  assert.equal(r.times[0].label, 'tomorrow at 9 AM')
  assert.match(r.say, /^They close soon\. Can we do tomorrow at 9 AM or Thursday at 9 AM\?$/)
})

test('carrier closed on a weekday evening, and on the weekend → Monday', () => {
  const omaha = findCarrier('Mutual of Omaha')
  const fri = doItNow(omaha, at('2026-11-13T18:00'), { name: 'Mutual of Omaha' })
  assert.equal(fri.mode, 'closed'); assert.match(fri.times[0].label, /^Monday at 9:30 AM$/)
  const sat = doItNow(omaha, at('2026-11-14T11:00'), { name: 'Mutual of Omaha' })
  assert.equal(sat.state.reason, 'weekend'); assert.match(sat.say, /closed for the weekend\. Can we do Monday at 9:30 AM/)
})

test('next times respect when the client is free and East Coast carriers', () => {
  const ta = findCarrier('Transamerica')   // 8 AM–7 PM ET = 7 AM–6 PM CT; VAs from 8 AM CT
  const freeAfter2 = ms => new Date(ms).getUTCHours() >= 20   // 2 PM CT and later
  const t = nextTimes(ta, at('2026-11-10T19:00'), { clientFree: freeAfter2 })
  assert.equal(t[0].label, 'tomorrow at 2 PM')
  assert.equal(openState(ta, at('2026-11-10T07:30')).open, true)
  assert.equal(hoursLine(ta), 'Mon–Fri 8 AM–7 PM ET')
})

test('busy VAs: no do it now even when the carrier is open', () => {
  const r = doItNow(findCarrier('Americo'), at('2026-11-10T10:00'), { vaFree: false })
  assert.equal(r.mode, 'busy'); assert.ok(r.times.length)
})

test('actions and e-sign stages', () => {
  assert.equal(actionOf('draft_date_change'), 'bank')
  assert.equal(actionOf('cancel_old'), 'cancel')
  assert.equal(esignStage('signed'), 2)
})

test('front desk: estimated wait from live data', () => {
  assert.equal(estimateWait({ ahead: 0, free: 1, busy: 2, avgMin: 6 }), 1)
  assert.equal(estimateWait({ ahead: 0, free: 0, busy: 3, avgMin: 6 }), 3)
  assert.equal(estimateWait({ ahead: 2, free: 0, busy: 3, avgMin: 6 }), 7)
  assert.equal(estimateWait({ ahead: 1, free: 0, busy: 0 }), 9)   // nobody free counts as one VA
  assert.equal(holdUpdate({ ahead: 0 }), 'You’re next. A specialist will be with you shortly.')
  assert.equal(holdUpdate({ ahead: 1, minutes: 2 }), 'You’re number 2 in line. A specialist will be with you in about 2 minutes.')
})

test('front desk: what the caller needs, and the summary', () => {
  assert.equal(needOf('I want to change my beneficiary to my son'), 'beneficiary')
  assert.equal(needOf('can you move my draft date to the 15th'), 'bank')
  assert.equal(needOf('I moved, new address'), 'address')
  assert.equal(needOf('I got married'), 'name')
  assert.equal(needOf('I want to cancel'), 'cancel')
  assert.equal(needOf('my payment bounced'), 'payment')
  assert.equal(needOf('what does my policy cover'), 'question')
  const s = summaryOf({ name: 'Gloria Hayes', known: true, carrier: 'Americo', need: 'beneficiary', said: 'change my beneficiary', detail: 'my son Marcus' })
  assert.equal(s.split('\n').length, 3)
  assert.match(s, /^Gloria Hayes · Americo\nBeneficiary change: “change my beneficiary”\nThey said: “my son Marcus”$/)
  assert.match(summaryOf({ name: 'Sam', need: 'question', dob: '3/4/1950' }), /not on file.*DOB 3\/4\/1950/)
})

test('front desk: e-sign offered first only when texting is live', () => {
  assert.equal(choicesOf({ need: 'beneficiary', esignPath: true, smsLive: false, minutes: 4 }).esign, false)
  const c = choicesOf({ need: 'beneficiary', esignPath: true, smsLive: true, minutes: 4 })
  assert.equal(c.digits, '12'); assert.match(c.say, /^Good news.*Press 2/)
  assert.equal(choicesOf({ need: 'payment', esignPath: true, smsLive: true }).esign, false)
})

test('front desk: long waits and after hours become a callback', () => {
  assert.equal(needsCallback({ waitedSec: 30, online: 2 }), null)
  assert.equal(needsCallback({ waitedSec: 601, online: 2 }), 'too_long')
  assert.equal(needsCallback({ online: 0 }), 'no_va')
  assert.equal(needsCallback({ deskOpen: false }), 'after_hours')
  assert.match(callbackLine({ deskOpen: false }), /after 8 AM Central/)
})
