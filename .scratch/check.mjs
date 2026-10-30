import { chromium } from 'playwright'

const BASE = 'http://localhost:5388'
const browser = await chromium.launch()
const results = []
const log = (...a) => { console.log(...a) }

// scenario: open | closed | error | slow ; native: bool
async function newPage({ w, theme, status, native, signupResp }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w > 700 ? 900 : 844 } })
  const page = await ctx.newPage()
  await page.addInitScript(([t, nat]) => {
    localStorage.setItem('ohvara-theme', t)
    if (nat) window.androidBridge = {}
  }, [theme, native])
  const calls = []
  await page.route('**/functions/v1/self-signup', async route => {
    const body = JSON.parse(route.request().postData() || '{}')
    calls.push(body)
    if (body.action === 'status') {
      if (status === 'error') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' })
      if (status === 'missing') return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ open: status === 'open' }) })
    }
    const r = signupResp || { status: 200, body: { ok: true } }
    return route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(r.body) })
  })
  await page.route('**/auth/v1/**', route => route.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"invalid_grant","error_description":"Invalid login credentials","code":"invalid_credentials"}' }))
  await page.route(/stub\.supabase\.co\/(?!functions\/v1\/self-signup|auth)/, route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  return { ctx, page, calls }
}

const noSideways = page => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))

// 1. Screenshots + no sideways scroll
for (const w of [1280, 390]) for (const theme of ['light', 'dark']) for (const status of ['open', 'closed']) {
  const { ctx, page } = await newPage({ w, theme, status })
  await page.goto(`${BASE}/signup`)
  await page.waitForSelector(status === 'open' ? 'form.su-card' : '.su-card h2', { timeout: 15000 })
  await page.waitForTimeout(400)
  const s = await noSideways(page)
  const h1 = await page.locator('h1').innerText()
  const minInput = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.su input:not([type=checkbox]), .su button, .su-cbrow')].map(e => e.getBoundingClientRect().height)))
  log(`shot ${w} ${theme} ${status}: scrollW=${s.sw} clientW=${s.cw} sideways=${s.sw > s.cw} h1="${h1.replace(/\n/g, ' ')}" minControlH=${Math.round(minInput)}`)
  await page.screenshot({ path: `.scratch/shots/signup-${w}-${theme}-${status}.png`, fullPage: true })
  await ctx.close()
}

// 2. Closed variants: error, missing, native, early
for (const status of ['error', 'missing']) {
  const { ctx, page } = await newPage({ w: 1280, theme: 'dark', status })
  await page.goto(`${BASE}/signup`)
  await page.waitForSelector('.su-card h2')
  await page.waitForTimeout(300)
  log(`status=${status}: heading="${await page.locator('.su-card h2').first().innerText()}" forms=${await page.locator('form').count()}`)
  await ctx.close()
}
{
  const { ctx, page, calls } = await newPage({ w: 390, theme: 'dark', status: 'open', native: true })
  await page.goto(`${BASE}/signup`)
  await page.waitForSelector('.su-card h2')
  await page.waitForTimeout(500)
  log(`native /signup: heading="${await page.locator('.su-card h2').innerText()}" forms=${await page.locator('form').count()} statusCalls=${calls.length}`)
  await page.screenshot({ path: '.scratch/shots/signup-390-dark-native.png', fullPage: true })
  await page.goto(`${BASE}/signup?early=1`)
  await page.waitForTimeout(500)
  log(`native /signup?early=1 forms=${await page.locator('form').count()}`)
  await page.goto(`${BASE}/login`)
  await page.waitForSelector('.sx-invite-note')
  await page.waitForTimeout(600)
  log(`native login: note="${(await page.locator('.sx-invite-note').innerText()).replace(/\n/g, ' ')}" createLink=${await page.getByText('Create an account').count()}`)
  await ctx.close()
}
{
  const { ctx, page } = await newPage({ w: 1280, theme: 'dark', status: 'closed' })
  await page.goto(`${BASE}/signup?early=1`)
  await page.waitForSelector('form.su-card')
  log(`closed + ?early=1: form shown=${await page.locator('form.su-card').count()}`)
  await ctx.close()
}

// 3. Login note per status (web)
for (const status of ['open', 'closed', 'error']) {
  const { ctx, page } = await newPage({ w: 1280, theme: 'dark', status })
  await page.goto(`${BASE}/login`)
  await page.waitForSelector('.sx-invite-note')
  await page.waitForTimeout(800)
  log(`web login status=${status}: note="${(await page.locator('.sx-invite-note').innerText()).replace(/\n/g, ' ')}" createLink=${await page.getByRole('link', { name: 'Create an account' }).count()}`)
  if (status === 'open') await page.screenshot({ path: '.scratch/shots/login-1280-dark-open.png' })
  await ctx.close()
}

// 4. Form behaviour
{
  const { ctx, page, calls } = await newPage({ w: 1280, theme: 'light', status: 'open' })
  await page.goto(`${BASE}/signup`)
  await page.waitForSelector('form.su-card')
  const sub = page.getByRole('button', { name: /Create account/ })
  await sub.click()
  log('empty submit ->', await page.locator('.su-ferr').allInnerTexts())
  await page.fill('input[name=name]', 'Alex Rivera')
  await sub.click(); log('no email ->', await page.locator('.su-ferr').allInnerTexts())
  await page.fill('input[name=email]', 'alex@@x'); await sub.click(); log('bad email ->', await page.locator('.su-ferr').allInnerTexts())
  await page.fill('input[name=email]', 'alex.rivera@gmail.com')
  await page.fill('input[name=new-password]', 'abcdefgh'); await sub.click(); log('no number ->', await page.locator('.su-ferr').allInnerTexts())
  await page.fill('input[name=new-password]', 'abcdefg1'); await sub.click(); log('terms unticked ->', await page.locator('.su-ferr').allInnerTexts())
  await page.screenshot({ path: '.scratch/shots/signup-1280-light-terms-error.png', fullPage: true })
  log('signup requests so far (expect 0):', calls.filter(c => c.action === 'signup').length)
  await page.locator('.su-cbrow input').check()
  await sub.click()
  await page.waitForSelector('.su-note.info', { timeout: 15000 })
  const sc = calls.filter(c => c.action === 'signup')
  log('ticked -> signup request body keys:', sc.length, Object.keys(sc[0] || {}).join(','), 'agree_terms=', sc[0]?.agree_terms)
  log('neutral banner:', (await page.locator('.su-note.info').innerText()).replace(/\n/g, ' | '))
  await page.screenshot({ path: '.scratch/shots/signup-1280-light-neutral.png', fullPage: true })
  const body = await page.locator('body').innerText()
  log('page text mentions "already exists"/"taken"/"registered":', /already exists|taken|is registered/i.test(body))
  log('email field highlighted as bad:', await page.locator('.su-inp.is-err').count())
  await ctx.close()
}
{
  const { ctx, page } = await newPage({ w: 390, theme: 'dark', status: 'open', signupResp: { status: 429, body: { error: 'Too many tries. Try again in an hour.' } } })
  await page.goto(`${BASE}/signup`)
  await page.waitForSelector('form.su-card')
  await page.fill('input[name=name]', 'Alex Rivera'); await page.fill('input[name=email]', 'alex.rivera@gmail.com')
  await page.fill('input[name=new-password]', 'abcdefg1'); await page.locator('.su-cbrow input').check()
  await page.getByRole('button', { name: /Create account/ }).click()
  await page.waitForSelector('.su-note.quiet', { timeout: 15000 })
  log('429 ->', (await page.locator('.su-note.quiet').innerText()).replace(/\n/g, ' | '), 'buttonDisabled=', await page.getByRole('button', { name: /Create account/ }).isDisabled())
  const s = await noSideways(page); log('429 390 sideways=', s.sw > s.cw)
  await page.screenshot({ path: '.scratch/shots/signup-390-dark-rate.png', fullPage: true })
  await ctx.close()
}
{
  const { ctx, page } = await newPage({ w: 390, theme: 'light', status: 'open', signupResp: { status: 403, body: { error: "Sign-ups aren't open yet." } } })
  await page.goto(`${BASE}/signup`)
  await page.waitForSelector('form.su-card')
  await page.fill('input[name=name]', 'Alex Rivera'); await page.fill('input[name=email]', 'alex.rivera@gmail.com')
  await page.fill('input[name=new-password]', 'abcdefg1'); await page.locator('.su-cbrow input').check()
  await page.getByRole('button', { name: /Create account/ }).click()
  await page.waitForSelector('.su-card h2:has-text("Sign-up isn")', { timeout: 15000 })
  log('403 -> closed state, forms=', await page.locator('form').count())
  await ctx.close()
}
await browser.close()
