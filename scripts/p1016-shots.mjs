// P1016 — lead types on screen: measured checks + proof shots (sample data; Supabase mocked, nothing real touched).
//   node scripts/p1016-shots.mjs <outDir>
import process from 'node:process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const OUT = process.argv[2] || '.p1016-qa'
const SB = 'https://mock.supabase.co'
const PORT = 5416
mkdirSync(OUT, { recursive: true })
const ID = '22222222-2222-4222-8222-222222222222'
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ID, role: 'authenticated', aal: 'aal1', exp: now + 36000, iat: now })}.mock`
const SESSION = {
  access_token: JWT, refresh_token: 'r', token_type: 'bearer', expires_in: 36000, expires_at: now + 36000,
  user: { id: ID, aud: 'authenticated', role: 'authenticated', email: 'admin@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
}
const ADMIN = { id: ID, role: 'admin', full_name: 'Sam Admin', email: 'admin@example.com', is_test: true, data_view: 'sample', is_active: true, timezone: 'America/Chicago' }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })

process.env.VITE_SUPABASE_URL = SB
process.env.VITE_SUPABASE_ANON_KEY = 'mock-anon-key'
const server = await createServer({ server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error' })
await server.listen()
const base = `http://localhost:${PORT}`
const browser = await chromium.launch({ args: ['--hide-scrollbars'] })
const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` -- ${JSON.stringify(detail)}` : ''}`)
}
const errors = []

async function ctxFor(theme, w, admin = false) {
  const phone = w < 600
  const ctx = await browser.newContext({ viewport: { width: w, height: phone ? 844 : 900 }, colorScheme: theme, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : null) })
  await ctx.addInitScript(([s, th, adm]) => {
    localStorage.setItem('ohvara-theme', th)
    if (adm) localStorage.setItem('sb-mock-auth-token', JSON.stringify(s))
  }, [SESSION, theme, admin])
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${w} ${theme}: ${e}`))
  await page.route(`${SB}/**`, route => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    if (path === '/rest/v1/rpc/get_my_profile') return json(route, ADMIN)
    if (path.startsWith('/auth/v1/')) return json(route, {})
    const single = (req.headers().accept || '').includes('vnd.pgrst.object')
    return json(route, single ? null : [])
  })
  return { ctx, page }
}
const go = async (page, path, sel) => {
  await page.goto(base + path, { waitUntil: 'domcontentloaded' })
  if (sel) await page.waitForSelector(sel, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800)
}
const sideways = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const shot = (page, name, el) => (el ? page.locator(el).first().screenshot({ path: join(OUT, `${name}.png`) }) : page.screenshot({ path: join(OUT, `${name}.png`) }))
const safe = async (name, fn) => { try { await fn() } catch (e) { check(name, false, String(e).slice(0, 200)) } }

try {
  for (const theme of ['dark', 'light']) {
    let { ctx, page } = await ctxFor(theme, 1440)
    await safe(`agent settings (${theme})`, async () => {
      await go(page, '/template/settings?tab=licence', '.lt-card')
      const card = await page.evaluate(() => {
        const c = document.querySelector('.lt-card')
        return { opts: [...c.querySelectorAll('label.sc-opt')].map(r => r.textContent.trim()), pop: c.querySelector('.sc-most')?.closest('label')?.textContent || '' }
      })
      check(`settings card: 6 types (${theme})`, card.opts.length === 6, card.opts)
      check(`settings card: Most popular on Mortgage protection (${theme})`, /^Mortgage protection/.test(card.pop.trim()), card.pop)
      const tag = await page.locator('.lt-card .sc-most').evaluate(e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return { w: r.width, pos: s.position } })
      check(`settings card: Most popular tag is a small inline chip (${theme})`, tag.w > 40 && tag.w < 140 && tag.pos === 'static', tag)
      check(`settings card: no ads words (${theme})`, !/\bads?\b|Meta|GoHighLevel/i.test(await page.locator('.lt-card').innerText()))
      await page.locator('.lt-card label.sc-opt').nth(1).click()
      await page.locator('.lt-card').getByRole('button', { name: 'Save' }).click()
      await page.waitForTimeout(400)
      const next = await page.locator('.lt-card').innerText()
      check(`settings card: switch waits for tomorrow (${theme})`, /Switches to Final expense tomorrow/.test(next), next.slice(0, 200))
      check(`settings: no sideways scroll 1440 (${theme})`, (await sideways(page)) <= 0)
      await shot(page, `agent-settings-leadtype-${theme}`, '.lt-card')
    })
    await safe(`agent leads (${theme})`, async () => {
      await go(page, '/template/leads', '.fx-ltype')
      const chips = await page.locator('.fx-ltype').allInnerTexts()
      check(`leads: type chip on cards (${theme})`, chips.length > 0 && chips.some(c => /Final expense/.test(c)), chips.slice(0, 4))
      const sel = page.locator('[data-testid=lead-type-filter]')
      check(`leads: lead type filter shown (${theme})`, (await sel.count()) > 0)
      const s = (await sel.evaluate(el => el.tagName)) === 'SELECT' ? sel : sel.locator('select')
      await s.selectOption('final_expense')
      await page.waitForTimeout(400)
      const after = await page.locator('.fx-ltype').allInnerTexts()
      check(`leads: filter keeps only Final expense (${theme})`, after.length > 0 && after.every(c => /Final expense/.test(c)), after)
      check(`leads: filter in the address (${theme})`, /type=final_expense/.test(page.url()), page.url())
      await shot(page, `agent-leads-filter-${theme}`)
    })
    await safe(`agent setup (${theme})`, async () => {
      // A servicing-only sample agent adding Leads (the setup step with states + lead type).
      await go(page, '/template/billing?products=servicing&add=leads', '[data-testid=sc-lead-type]')
      const ty = page.locator('[data-testid=sc-lead-type]')
      if (!(await ty.count())) return check(`setup: lead type card present (${theme})`, false, 'drawer did not open')
      const order = await page.evaluate(() => {
        const a = document.getElementById('sc-st-h'), b = document.getElementById('sc-ty-h')
        return !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING))
      })
      check(`setup: lead type right after states (${theme})`, order)
      await ty.scrollIntoViewIfNeeded()
      await shot(page, `agent-setup-leadtype-${theme}`, '[data-testid=sc-lead-type]')
    })
    await ctx.close()

    ;({ ctx, page } = await ctxFor(theme, 390))
    await safe(`phone (${theme})`, async () => {
      await go(page, '/template/settings?set=calendar')
      const row = page.getByText('Lead type', { exact: true }).first()
      if (!(await row.count())) return check(`phone: Lead type row (${theme})`, false, 'row not found')
      await row.click()
      await page.waitForTimeout(700)
      check(`phone: sheet shows the 6 types (${theme})`, (await page.locator('label.sc-opt').count()) >= 6)
      check(`phone: no sideways scroll (${theme})`, (await sideways(page)) <= 0)
      await shot(page, `phone-settings-leadtype-${theme}`)
    })
    await ctx.close()

    ;({ ctx, page } = await ctxFor(theme, 1440, true))
    await safe(`admin by type (${theme})`, async () => {
      await go(page, '/admin/inbounds?view=types', '.lty-table')
      const rep = await page.evaluate(() => [...document.querySelectorAll('.lty-table tbody th')].map(t => t.textContent.trim()))
      check(`admin: report rows by type (${theme})`, rep.includes('Mortgage protection') && rep.includes('Final expense'), rep)
      check(`admin: editor lists the types (${theme})`, (await page.locator('.lty-row').count()) >= 6)
      check(`admin: no sideways scroll (${theme})`, (await sideways(page)) <= 0)
      await shot(page, `admin-by-type-${theme}`, '.lty-report')
      await shot(page, `admin-editor-${theme}`, '.lty-edit')
    })
    await safe(`admin filter (${theme})`, async () => {
      await go(page, '/admin/inbounds?type=final_expense', '.ov-sb-nav')
      await shot(page, `admin-leads-filter-${theme}`)
    })
    await safe(`admin agent drawer (${theme})`, async () => {
      await go(page, '/admin/agents/ag-marcus', '.ov-sb-nav')
      await page.waitForTimeout(800)
      check(`admin: agent drawer shows their lead type (${theme})`, (await page.getByText(/^Leads:/).count()) > 0)
      await shot(page, `admin-agent-drawer-${theme}`)
    })
    await ctx.close()
  }
  check('no page errors', errors.length === 0, errors.slice(0, 5))
} finally {
  writeFileSync(join(OUT, 'checks.json'), JSON.stringify(checks, null, 2))
  await browser.close()
  await server.close()
}
console.log(`${checks.filter(c => c.ok).length}/${checks.length} passed`)
