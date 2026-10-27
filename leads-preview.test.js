// Scratch harness (not committed): lints the two files, then opens /agent/leads
// in Chromium with every Supabase request intercepted (none reach the network).
import { test } from 'node:test'
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/freem/ohvara-dashboard/node_modules/')
const { chromium } = require('playwright')
const { ESLint } = require('eslint')

const REF = 'jjextitmbptoaolacocs'
const UID = '00000000-0000-4000-8000-000000000001'
const OUT = 'C:/Users/freem/.atlas/work/shots/8c120da8/'
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const exp = Math.floor(Date.now() / 1000) + 36000
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, aal: 'aal1', amr: [{ method: 'password', timestamp: 1 }], exp, role: 'authenticated' })}.sig`
const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'agent@example.test', factors: [] }
const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 36000, expires_at: exp, user }
const profile = { id: UID, role: 'agent', full_name: 'Test Agent', first_name: 'Test', timezone: 'America/Chicago', billing_exempt: true, status: 'active', approved: true, onboarding_complete: true }

const ago = h => new Date(Date.now() - h * 3600e3).toISOString()
const LEADS = [
  { id: 'l1', first_name: 'Jordan', last_name: 'Placeholder', phone: '+15550100123', state: 'TX', homeowner: true, mortgage_balance_band: '$100k–$250k', age_band: '45–54', smoker: false, best_time: 'Morning', status: 'assigned', assigned_at: ago(1), created_at: ago(1) },
  { id: 'l2', first_name: 'Maximiliana-Alexandrina', last_name: 'Featherstonehaugh-Worthington', phone: '+15550100124', state: 'FL', homeowner: true, mortgage_balance_band: '$250k–$500k', age_band: '55–64', smoker: true, best_time: 'Evening', status: 'contacted', assigned_at: ago(3), created_at: ago(3) },
  { id: 'l3', first_name: 'Sam', last_name: 'Example', phone: '+15550100125', state: 'OH', homeowner: true, mortgage_balance_band: 'Under $100k', age_band: '35–44', smoker: false, best_time: 'Anytime', status: 'closed', assigned_at: ago(26), created_at: ago(26) },
  { id: 'l4', first_name: null, last_name: null, phone: null, state: 'TX', homeowner: false, age_band: '25–34', status: 'bad', assigned_at: ago(100), created_at: ago(100) },
  { id: 'l5', first_name: 'Bartholomew-Christophersonwilliamsonjohnston', last_name: 'Vandenberghe-Oyelaran', phone: null, state: 'PA', status: 'new', assigned_at: ago(160), created_at: ago(160) },
]
const SETTINGS = { active: true, states: ['FL', 'OH', 'TX'], daily_cap: 5 }

async function open(browser, { w, h = 1000, theme = 'dark', leads = LEADS, settings = SETTINGS, leadsFail = false, patchFail = false }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } })
  const page = await ctx.newPage()
  const hits = []
  await page.route(/supabase\.co/, async route => {
    const r = route.request(), u = r.url(), m = r.method()
    hits.push(`${m} ${u.split('?')[0].replace(/^.*supabase\.co/, '')}`)
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } })
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    const one = /pgrst\.object/.test(r.headers()['accept'] || '')
    if (u.includes('/auth/v1/user')) return json(user)
    if (u.includes('/auth/v1/')) return json({})
    if (u.includes('/rpc/get_my_profile')) return json(one ? profile : [profile])
    if (u.includes('/mp_leads')) {
      if (m === 'PATCH') { await new Promise(r => setTimeout(r, 600)); return patchFail ? json({ message: 'nope' }, 500) : json([], 200) }
      return leadsFail ? json({ message: 'down' }, 503) : json(leads)
    }
    if (u.includes('/agent_lead_settings')) {
      if (m !== 'GET') { await new Promise(r => setTimeout(r, 400)); return json([], 201) }
      return json(one ? settings : (settings ? [settings] : []))
    }
    return json(one ? null : [])
  })
  await page.addInitScript(([k, s, t]) => { localStorage.setItem(k, s); localStorage.setItem('ohvara-theme', t) }, [`sb-${REF}-auth-token`, JSON.stringify(session), theme])
  await page.goto('http://localhost:5199/agent/leads')
  await page.waitForSelector('text=Delivered leads', { timeout: 20000 })
  await page.waitForTimeout(700)
  return { page, ctx, hits }
}

test('lint', async () => {
  const eslint = new ESLint()
  const res = await eslint.lintFiles(['src/pages/agent/Leads.jsx', 'src/hooks/useMpLeads.js'])
  const out = res.map(r => `${r.filePath.split(/[\\/]/).pop()}: ${r.errorCount} errors, ${r.warningCount} warnings ${r.messages.map(x => `[${x.line}:${x.ruleId} ${x.message}]`).join(' ')}`)
  console.log(out.join('\n'))
  assert.equal(res.reduce((a, r) => a + r.errorCount, 0), 0)
})

test('browser', { timeout: 240000 }, async () => {
  const vite = spawn('node', ['C:/Users/freem/ohvara-dashboard/node_modules/vite/bin/vite.js', '--port', '5199', '--strictPort'], {
    env: { ...process.env, VITE_SUPABASE_URL: `https://${REF}.supabase.co`, VITE_SUPABASE_ANON_KEY: 'harness-anon' }, stdio: 'ignore',
  })
  await new Promise(r => setTimeout(r, 4000))
  const browser = await chromium.launch()
  try {
    for (const theme of  ['dark', 'light']) {
      for (const w of [1920, 1440, 390]) {
        const { page, ctx } = await open(browser, { w, theme, h: w === 390 ? 844 : 1000 })
        const sw = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
        console.log(`${theme} ${w}: scrollWidth=${sw[0]} innerWidth=${sw[1]}`)
        assert.ok(sw[0] <= sw[1])
        if (w === 390) {
          const small = await page.$$eval('main button, main a', els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 44 && !e.closest('[role=group][aria-label="Lead status"]')).map(e => `${e.textContent.trim() || e.getAttribute('aria-label')}:${Math.round(e.getBoundingClientRect().height)}`))
          console.log(`  <44px controls at 390 (excl. status seg): ${JSON.stringify(small)}`)
        }
        await page.screenshot({ path: `${OUT}build-${theme}-${w}.png`, fullPage: true })
        await ctx.close()
      }
    }
    // States: delivery off + empty, and load error.
    let s = await open(browser, { w: 390, leads: [], settings: null })
    console.log('off/empty:', await s.page.locator('text=Delivery is off').count(), await s.page.locator('text=Delivery off').count())
    await s.page.screenshot({ path: `${OUT}build-off-390.png`, fullPage: true }); await s.ctx.close()
    s = await open(browser, { w: 1440, leadsFail: true, theme: 'light' })
    await s.page.waitForSelector('text=We couldn’t load your leads', { timeout: 20000 })
    console.log('error card + retry:', await s.page.locator('button:has-text("Try again")').count())
    await s.ctx.close()
    // Optimistic status + rollback.
    s = await open(browser, { w: 1440, patchFail: true })
    const card = s.page.locator('article').first()
    await card.locator('button:has-text("Contacted")').click()
    const t0 = Date.now()
    await card.locator('button[aria-pressed=true]:has-text("Contacted")').waitFor({ timeout: 550 }).catch(() => {})
    const mid = await card.locator('button[aria-pressed=true]').textContent()
    const chipNow = await card.locator('span:has-text("Contacted")').count()
    console.log(`flip seen after ${Date.now() - t0}ms, status chip shows Contacted: ${chipNow}, saving line: ${await card.locator('text=Saving…').count()}`)
    await s.page.screenshot({ path: `${OUT}build-saving-1440.png`, clip: { x: 0, y: 0, width: 1440, height: 700 } })
    const otherEnabled = await s.page.locator('article').nth(1).locator('button:has-text("Closed")').isEnabled()
    await s.page.waitForSelector('text=It’s back to New', { timeout: 5000 })
    const after = await card.locator('button[aria-pressed=true]').textContent()
    console.log(`optimistic: pressed during save=${mid}, other card usable=${otherEnabled}, after error=${after}`)
    assert.equal(mid, 'Contacted'); assert.equal(after, 'New'); assert.ok(otherEnabled)
    // Settings save success.
    await s.page.locator('button[aria-label="More"]').click()
    await s.page.locator('button:has-text("Save settings")').click()
    await s.page.waitForSelector('text=Saved at', { timeout: 5000 })
    console.log('settings saved message:', await s.page.locator('[role=status]').textContent())
    console.log('requests:', [...new Set(s.hits)].join(' | '))
    await s.ctx.close()
  } finally {
    await browser.close(); vite.kill()
  }
})
