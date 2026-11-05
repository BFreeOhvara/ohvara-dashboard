// P843 probe: every tab-like row on the fulfillment pages: does a click fly the stretch pill?
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://localhost:5173'
const logins = JSON.parse(readFileSync(join(homedir(), '.atlas', 'test-logins.json'), 'utf8'))
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const writes = []
page.on('request', r => { if (!['GET', 'OPTIONS', 'HEAD'].includes(r.method()) && /supabase\.co/.test(r.url())) writes.push(r.method() + ' ' + r.url().replace(/^https:\/\/[^/]+/, '').slice(0, 90)) })
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('input[placeholder="you@email.com"]', logins.fulfill.email)
await page.fill('input[placeholder="Your password"]', logins.fulfill.password)
await page.click('button[type="submit"]')
await page.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 30000 })
for (const url of ['/fulfillment', '/fulfillment/leads', '/fulfillment/desk', '/fulfillment/pipeline', '/fulfillment/servicing', '/fulfillment/pay', '/fulfillment/more']) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const rows = await page.evaluate(() => {
    const out = []
    document.querySelectorAll('*').forEach((el, i) => {
      const kids = [...el.children].filter(c => c.matches('button, a, span[role]'))
      if (kids.length < 2 || el.closest('.fx-rail, .tp-rail, .fx-bar, .tp-bar')) return
      const on = kids.filter(k => /(^|\s)(on|is-on|active)(\s|$)/.test(k.className))
      if (on.length !== 1 || el.getBoundingClientRect().width === 0) return
      el.setAttribute('data-p843', String(i))
      out.push({ id: String(i), cls: el.className.toString().slice(0, 40), items: kids.map(k => `${k.tagName}${k === on[0] ? '*' : ''}:${k.textContent.trim().slice(0, 12)}`) })
    })
    return out
  })
  for (const r of rows) {
    const off = page.locator(`[data-p843="${r.id}"] > :not(.on):not(.is-on):not(.active)`).last()
    if (!(await off.count())) continue
    const tag = await off.evaluate(e => e.tagName)
    if (tag === 'A') { console.log(url, r.cls, 'links (navigates)', JSON.stringify(r.items)); continue }
    await off.click().catch(() => {})
    let fly = false
    for (let k = 0; k < 8 && !fly; k++) { fly = await page.evaluate(() => !!document.querySelector('.sp-pill')); await page.waitForTimeout(40) }
    console.log(url, r.cls, fly ? 'FLIES' : 'no flight', JSON.stringify(r.items))
  }
}
console.log('writes:', JSON.stringify(writes))
await b.close()
