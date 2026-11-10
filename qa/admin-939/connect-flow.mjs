// P939 QA: the real signed-in admin Connect page, with Supabase and GoHighLevel stubbed in the browser (nothing leaves
// the machine). Real clicks: Test connection with no key, save a fake key, Test connection OK, then a stubbed 401.
//   node qa/admin-939/connect-flow.mjs http://localhost:5939 qa/admin-939
import process from 'node:process'
import { chromium } from 'playwright'

const [BASE, OUT] = process.argv.slice(2)
const REF = 'jjextitmbptoaolacocs'
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const exp = Math.floor(Date.now() / 1000) + 86400
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u-admin', role: 'authenticated', aal: 'aal1', exp })}.sig`
const user = { id: 'u-admin', aud: 'authenticated', role: 'authenticated', email: 'qa@example.com', app_metadata: {}, user_metadata: {}, factors: [], created_at: '2026-01-01T00:00:00Z' }
const session = { access_token: jwt, refresh_token: 'r', expires_at: exp, expires_in: 86400, token_type: 'bearer', user }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const state = { keySaved: false, ghlAnswer: 'ok', posts: [], tests: 0 }
const ROW = { enabled: false, location_id: 'l1C08ntBrFjLS0elLIYU', workflow_new_inbound: null, workflow_appointment_reminder: null, workflow_no_show: null, workflow_opt_out: null, workflow_no_answer: null, last_sync_at: null, last_sync_status: null, last_sync_error: null }

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); localStorage.setItem('ohvara-theme', 'dark') } catch { /* */ } }, [`sb-${REF}-auth-token`, JSON.stringify(session)])
const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
await ctx.route(/supabase\.co/, async route => {
  const req = route.request()
  const url = new URL(req.url())
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
  const wantObj = (req.headers().accept || '').includes('vnd.pgrst.object')
  if (url.pathname.startsWith('/auth/v1/user')) return json(route, user)
  if (url.pathname.includes('/auth/v1/')) return json(route, {})
  if (url.pathname.endsWith('/functions/v1/fetch-secrets')) {
    if (req.method() === 'GET') {
      return json(route, { capabilities: {}, secrets: state.keySaved ? [{ id: '1', key_name: 'GHL_API_KEY', description: 'x', created_at: '', updated_at: '', last_used_at: null }] : [] })
    }
    const body = JSON.parse(req.postData() || '{}')
    state.posts.push({ action: body.action ?? null, key_name: body.key_name ?? null, hasValue: 'value' in body })
    if (body.action === 'test_ghl') {
      state.tests++
      // What the real function answers: no saved key -> not connected; else the stubbed GoHighLevel answer in plain words.
      if (!state.keySaved) return json(route, { ok: false, message: 'GoHighLevel is not connected: paste the API key and save it first.' })
      return json(route, state.ghlAnswer === 'ok'
        ? { ok: true, message: 'OK. GoHighLevel accepted the key and found the location.' }
        : { ok: false, message: 'GoHighLevel rejected the key. Check it was copied whole, and that it was not revoked.' })
    }
    if (body.key_name === 'GHL_API_KEY') state.keySaved = true
    return json(route, { success: true, key_name: body.key_name })
  }
  if (url.pathname.endsWith('/rpc/get_my_profile')) return json(route, wantObj ? { id: 'u-admin', role: 'admin', is_active: true, full_name: 'QA Admin', email: 'qa@example.com' } : [{ id: 'u-admin', role: 'admin', is_active: true, full_name: 'QA Admin' }])
  if (url.pathname.endsWith('/rest/v1/profiles')) return json(route, wantObj ? { id: 'u-admin', role: 'admin', is_active: true, full_name: 'QA Admin', email: 'qa@example.com' } : [{ id: 'u-admin', role: 'admin', is_active: true, full_name: 'QA Admin' }])
  if (url.pathname.endsWith('/rest/v1/ghl_settings')) {
    if (req.method() === 'PATCH') return json(route, [{ id: true }])
    return json(route, wantObj ? ROW : [ROW])
  }
  return json(route, wantObj ? null : [], wantObj ? 406 : 200)
})
const p = await ctx.newPage()
const errs = []
p.on('pageerror', e => errs.push(e.message))
await p.goto(`${BASE}/admin/connect`, { waitUntil: 'load' })
const tile = p.locator('section[aria-label="GoHighLevel"]')
await tile.waitFor({ timeout: 15000 }).catch(async e => {
  console.log('URL', p.url(), '|', (await p.evaluate(() => document.body.innerText)).slice(0, 400), '| ERRS', errs.join(' ; '))
  throw e
})
await p.waitForTimeout(1500)
const read = async label => {
  const m = await tile.evaluate(t => ({
    chip: t.querySelector('.tp-chip')?.textContent, note: t.querySelector('#ghl-test-note')?.textContent,
    testDisabled: [...t.querySelectorAll('button')].find(x => x.textContent.includes('Test connection')).disabled,
    savedLine: /A key is saved/.test(t.textContent), keyValue: t.querySelector('input[aria-label="API key"]').value,
  }))
  console.log(label, JSON.stringify(m))
  return m
}
const toast = async () => p.evaluate(() => [...document.querySelectorAll('[role="status"], [aria-live]')].map(e => e.textContent.trim()).filter(Boolean).join(' | '))
await read('1 start (no key)')
const noKey = await read('1b')
console.log('   test button disabled with no key saved:', noKey.testDisabled)
await tile.getByLabel('API key').fill('pit-FAKE-0000-never-shown')
await tile.getByRole('button', { name: 'Save' }).click()
await p.waitForTimeout(900)
console.log('2 after Save toast:', await toast())
const afterSave = await read('2b after save')
await tile.getByRole('button', { name: 'Test connection' }).click()
await p.waitForTimeout(900)
console.log('3 OK flow toast:', await toast())
await p.screenshot({ path: `${OUT}/connect-ok-1440-dark.png`, clip: { x: 0, y: 0, width: 1440, height: 900 }, scale: 'css' }).catch(() => {})
state.ghlAnswer = 'bad'
await tile.getByRole('button', { name: 'Test connection' }).click()
await p.waitForTimeout(900)
console.log('4 error flow toast:', await toast())
const bodyText = await p.evaluate(() => document.body.innerText)
console.log('posts seen by the server stub:', JSON.stringify(state.posts))
console.log('key text anywhere on the page:', bodyText.includes('FAKE-0000'), '| key field value after save:', JSON.stringify(afterSave.keyValue), '| tests run:', state.tests)
if (errs.length) console.log('page errors:', errs.join(' | ').slice(0, 300))
await b.close()
