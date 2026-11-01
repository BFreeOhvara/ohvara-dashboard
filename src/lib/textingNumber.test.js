// Settings → Texting number: the pure state helper.
//   node --test src/lib/textingNumber.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { textingNumberState, TEXTING_LIVE_LINE, TEXTING_OFF_LINE } from './textingNumber.js'

test('sms_live on: Live chip and the shared-number line', () => {
  const s = textingNumberState({ smsLive: true, configLoaded: true })
  assert.equal(s.chip, 'Live')
  assert.equal(s.line, TEXTING_LIVE_LINE)
  assert.match(s.line, /one shared number/)
})

test('sms_live on: the line contains no digits', () => {
  const s = textingNumberState({ smsLive: true, configLoaded: true })
  assert.doesNotMatch(s.line, /\d/)
})

test('sms_live off: Not live yet chip and the carrier-approval line', () => {
  const s = textingNumberState({ smsLive: false, configLoaded: true })
  assert.equal(s.chip, 'Not live yet')
  assert.equal(s.line, TEXTING_OFF_LINE)
  assert.doesNotMatch(s.line, /\d/)
})

test('config still loading: no chip, whatever sms_live says', () => {
  assert.equal(textingNumberState({ smsLive: true, configLoaded: false }).chip, null)
  assert.equal(textingNumberState({ smsLive: false, configLoaded: false }).chip, null)
  assert.equal(textingNumberState({}).chip, null)
  assert.equal(textingNumberState().chip, null)
})
