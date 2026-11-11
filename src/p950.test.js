import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { liveStatusText } from './adminshell/liveStatusText.js'
import { switchesOf } from './lib/admReal.js'

// P950 (Brayden, Nov 10): no live switches in the portal. CC turns each piece on with Brayden's yes
// (brain/ohvara/Go Live Runbook.md). The database half is migration 266 + supabase/tests/p950_no_live_switches.sql.
const root = fileURLToPath(new URL('.', import.meta.url))
const read = p => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n')
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(jsx?|tsx?)$/.test(f) && !/\.test\./.test(f)) out.push(p)
  }
  return out
}
const FLAGS = ['sms_live', 'voice_live', 'ai_caller_live', 'owner_payouts_live', 'payouts_live', 'recording_live', 'invite_sms_live', 'show_sample_data', 'live_charging']

test('P950: no code in the app writes a live flag', () => {
  for (const f of walk(root)) {
    const s = readFileSync(f, 'utf8')
    for (const flag of FLAGS) {
      // a write names the flag as an object key being set to a value: `{ sms_live: v }`, `update({ ...: on })`, `p_on` RPCs
      assert.doesNotMatch(s, new RegExp('mutate[(][{][^}]*[ {,]' + flag + ' *:'), `${f} saves ${flag}`)
      assert.doesNotMatch(s, new RegExp('update[(][{][^}]*[ {,]' + flag + ' *:'), `${f} updates ${flag}`)
    }
    assert.doesNotMatch(s, /admin_billing_live_set/, `${f} calls the live-charging RPC`)
    assert.doesNotMatch(s, /[^A-Za-z]setSwitch[^A-Za-z]/, `${f} still has setSwitch`)
  }
})

test('P950: the Go live card, the Live charging row and the company sample switch are gone', () => {
  assert.throws(() => read('adminshell/SampleSwitch.jsx'))
  assert.doesNotMatch(read('adminshell/screens/Settings.jsx'), /GoLive|Go live['"]/)
  assert.doesNotMatch(read('adminshell/screens/Billing933.jsx'), /LiveChargingRow|<Switch|setLiveCharging/)
  assert.doesNotMatch(read('lib/leadSpend.js'), /setLiveCharging/)
  const legacy = read('components/settings/TextFollowUpPanel.jsx') + read('components/fulfillment/GettingPaid.jsx')
  for (const flag of ['sms_live', 'voice_live', 'recording_live', 'payouts_live']) assert.doesNotMatch(legacy, new RegExp('save[.]mutate[(][{] ' + flag), flag)
  // the admin's own Sample info pill is a view, not a live switch: it stays
  assert.match(read('template/ViewToggle.jsx'), /label="Sample info"/)
})

test('P950: the Overview shows a read-only status line and no button', () => {
  assert.match(read('adminshell/screens/Overview.jsx'), /<LiveStatus \/>/)
  const ls = read('adminshell/LiveStatus.jsx')
  assert.doesNotMatch(ls, /<button|<Switch|onClick|onChange/)
  assert.equal(liveStatusText({}, false), 'Live: calls off · AI caller off · texts off · charging off · owner payouts off')
  const sw = switchesOf({}, { voice_live: true, sms_live: false, owner_payouts_live: true })
  assert.equal(liveStatusText(sw, true), 'Live: calls on · AI caller off · texts off · charging on · owner payouts on')
})

test('P950: migration 266 guards every live flag and takes the grants and the RPC back', () => {
  const m = readFileSync(join(root, '../supabase/migrations/266_no_live_switches.sql'), 'utf8')
  for (const flag of ['sms_live', 'voice_live', 'ai_caller_live', 'owner_payouts_live', 'payouts_live', 'recording_live', 'invite_sms_live', 'show_sample_data', 'live_charging']) {
    assert.match(m, new RegExp(`'${flag}'`), flag)
  }
  assert.ok(m.includes('auth.uid() is null then return new'))
  assert.match(m, /revoke update \(sms_live, voice_live, payouts_live, recording_live\) on public\.recovery_config from authenticated/)
  assert.ok(m.includes('revoke execute on function public.admin_billing_live_set(boolean) from public, anon, authenticated'))
  assert.match(m, /NOT APPLIED until Brayden's yes/)
})
