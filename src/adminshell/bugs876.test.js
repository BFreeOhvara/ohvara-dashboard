import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addSampleBug, sampleBugs, resetSampleBugs } from '../template/bugReport.js'
import { bugsWithSent, feedWithSent, openBugCount } from './data.js'

// P876: a bug report sent from Help & Support (sample) lands in admin's Bug reports as New, counts as open, and shows
// in the admin bell as an app notification (the same merge useAdmBugs / useAdmFeed / useAdmDay do).
const seed = [{ id: 'bg-1', who: 'Dana Walker', status: 'new' }, { id: 'bg-3', who: 'Priya Shah', status: 'fixed' }]
const feed = [{ id: 'f1', who: 'Ana', text: 'Booked a call', at: 'Thu, 9:00 AM' }]

test('a sent bug report shows in admin Bug reports (New, with what was captured) and in the bell', () => {
  resetSampleBugs()
  assert.equal(openBugCount(seed, sampleBugs()), 1)
  addSampleBug({ happened: 'The Pay tabs show a grey block', expected: 'Just the number' }, { who: 'Maya Brooks', role: 'Fulfillment', page: '/fulfillment/pay', at: '2026-11-07T19:05:00Z', browser: 'Chrome 142 on Windows', screen: '1440×900 screen' })
  const bugs = bugsWithSent(seed, sampleBugs())
  assert.equal(bugs[0].who, 'Maya Brooks')
  assert.equal(bugs[0].status, 'new')
  assert.equal(bugs[0].expected, 'Just the number')
  assert.equal(bugs[0].page, '/fulfillment/pay')
  assert.equal(bugs[0].browser, 'Chrome 142 on Windows')
  const bell = feedWithSent(feed, sampleBugs())
  assert.match(bell[0].text, /^Reported a bug: The Pay tabs/)
  assert.equal(bell[0].kind, 'bug')
  assert.equal(openBugCount(seed, sampleBugs()), 2)
  resetSampleBugs()
})
