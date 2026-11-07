// P880 — QA shots of the live transfer, sample data and faked network only (voice_live stays off; nothing reaches
// Supabase). VA states: the sample VA phone (/template/fulfillment/leads → Call → Transfer). Agent: the real alert
// and Setup push test card in harness.html, help-transfer answered here from fixtures; the lock-screen alert is a mock.
//   node qa/transfer-880/shots.mjs --base-url http://localhost:4880
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const BASE = args[args.indexOf('--base-url') + 1]
const OUT = dirname(fileURLToPath(import.meta.url))
const browser = await chromium.launch()

const now = () => Date.now()
const iso = ms => new Date(now() + ms).toISOString()
const rosa = { name: 'Rosa Diaz', age: 64, state: 'TX', need: 'Final expense', your_client: false }
const FIX = {
  ask: () => ({ id: 'ask', status: 'sent', summary: rosa, sent_at: iso(-8000), expires_at: iso(22000) }),
  client: () => ({ id: 'client', status: 'seen', summary: { ...rosa, name: 'Gloria Price', your_client: true }, sent_at: iso(-3000), expires_at: iso(27000) }),
  yes: () => ({ id: 'yes', status: 'ringing', summary: rosa, sent_at: iso(-12000), ring_started_at: iso(-4000), answer: 'yes' }),
  booked: () => ({ id: 'booked', status: 'booked', summary: rosa, booked_for: '2026-11-07T21:30:00Z' }),
}
const SETUP = {
  off: { reach: { ready: false, reason: 'notifications_off' }, readiness: { fail_reason: null } },
  voiceoff: { reach: { ready: false, reason: 'not_tested' }, readiness: { push_ok_at: iso(-60000), fail_reason: 'voice_off' } },
  ready: { reach: { ready: true, reason: null }, readiness: { push_ok_at: iso(-60000), call_ok_at: iso(-50000) } },
}

async function page(theme, w, h, setup) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } })
  await ctx.route(/supabase\.co\/(auth|rest|realtime)/, r => r.abort('failed'))
  await ctx.route(/\/functions\/v1\/help-transfer/, async r => {
    const body = JSON.parse(r.request().postData() || '{}')
    const fx = FIX[body.check_id]
    const out = body.action === 'reach' ? SETUP[setup] : fx ? { ok: true, check: { ...fx(), server_now: new Date().toISOString() } } : { ok: false }
    await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) })
  })
  const p = await ctx.newPage()
  const errs = []; p.on('pageerror', e => errs.push(e.message))
  await p.goto(`${BASE}/`, { waitUntil: 'load' }).catch(() => {})
  await p.evaluate(t => localStorage.setItem('ohvara-theme', t), theme)
  // A fake local session (never sent anywhere: all Supabase traffic is aborted or answered above) so the Setup card loads.
  if (setup) await p.evaluate(() => localStorage.setItem('sb-jjextitmbptoaolacocs-auth-token', JSON.stringify({
    access_token: 'qa', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'qa',
    user: { id: 'a8800000-0000-4000-8000-00000000000a', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
  })))
  return { p, ctx, errs }
}
const measure = p => p.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth, crash: !!document.querySelector('.ov-crash') }))
const shot = async (p, name, w, theme) => { await p.waitForTimeout(400); await p.screenshot({ path: join(OUT, `${name}-${w}-${theme}.png`) }); console.log(name, w, theme, JSON.stringify(await measure(p))) }

// ── VA: the transfer card through every step (sample) ──────────────────────
const AGENT_LIGHT_ONLY = args.includes('--agent-light-only')
for (const [theme, w, h] of AGENT_LIGHT_ONLY ? [] : [['dark', 1440, 900], ['light', 390, 844]]) {
  for (const agent of ['Dana', 'Priya']) {
    const { p, ctx, errs } = await page(theme, w, h)
    await p.goto(`${BASE}/template/fulfillment`, { waitUntil: 'load' })
    await p.waitForSelector('.tp-app', { timeout: 20000 }).catch(() => {})
    await p.waitForTimeout(1500)
    await p.click(w >= 1000 ? '.fs-ri-phone' : '.fs-top-phone'); await p.waitForTimeout(500)
    await p.click('.fs-call .fs-ph-todo button[aria-label="Call Shirley Adams"]')
    await p.waitForTimeout(900)
    await p.click('.fs-call button[aria-label="Transfer"]')
    await p.waitForTimeout(400)
    if (agent === 'Dana') {
      await p.locator('.fs-cs-sheet [role="radio"]:has-text("Marcus")').click()
      await shot(p, 'va-pick-unreachable', w, theme)
    }
    await p.locator(`.fs-cs-sheet [role="radio"]:has-text("${agent}")`).click()
    await p.locator('.fs-cs-sheet button:has-text("Check agent")').click()
    await p.waitForTimeout(300)
    if (agent === 'Dana') await shot(p, 'va-sent', w, theme)
    await p.waitForSelector('.fs-cs-xfer.is-yes', { timeout: 8000 })
    if (agent === 'Dana') await shot(p, 'va-yes', w, theme)
    await p.locator('.fs-cs-xfer button:has-text("Transfer now")').click()
    await p.waitForTimeout(500)
    if (agent === 'Priya') {
      await shot(p, 'va-ringing', w, theme)
      await p.waitForSelector('.fs-cs-xfer.is-bounced', { timeout: 25000 })
      await shot(p, 'va-bounced', w, theme)
    } else {
      await p.waitForTimeout(3500)
      await shot(p, 'va-transferred', w, theme)
    }
    console.log('va', agent, theme, w, 'errors', errs.length ? errs.join(' | ') : 'none')
    await ctx.close()
  }
}

// ── Agent: the in-app alert, the lock-screen mock, the Setup push test ─────
for (const theme of AGENT_LIGHT_ONLY ? ['light'] : ['dark', 'light']) {
  const w = 390, h = 844
  for (const id of ['ask', 'client', 'yes', 'booked']) {
    if (theme === 'light' && id !== 'ask') continue
    const { p, ctx, errs } = await page(theme, w, h)
    await p.goto(`${BASE}/qa/transfer-880/harness.html?view=alert&check=${id}`, { waitUntil: 'load' })
    await p.waitForSelector('.pv-ta', { timeout: 15000 }).catch(() => console.log('no alert for', id))
    await shot(p, `agent-alert-${id}`, w, theme)
    if (errs.length) console.log('agent', id, 'errors', errs.join(' | '))
    await ctx.close()
  }
  {
    const { p, ctx } = await page(theme, w, h)
    await p.goto(`${BASE}/qa/transfer-880/harness.html?view=lock`, { waitUntil: 'load' })
    await p.waitForTimeout(800)
    await shot(p, 'agent-lock-mock', w, theme)
    await ctx.close()
  }
  for (const s of theme === 'dark' ? ['off', 'voiceoff', 'ready'] : ['off']) {
    const { p, ctx } = await page(theme, w, h, s)
    await p.goto(`${BASE}/qa/transfer-880/harness.html?view=setup`, { waitUntil: 'load' })
    await p.waitForSelector('.ov-set-card', { timeout: 15000 }).catch(() => {})
    await p.waitForTimeout(800)
    await shot(p, `setup-push-test-${s}`, w, theme)
    await ctx.close()
  }
}
await browser.close()
