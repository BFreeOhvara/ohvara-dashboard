// P855: sit on Fulfillment and Connect for 100 s as the admin and count backend calls to the missing function and table.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
const BASE = process.argv[2]
const logins = JSON.parse(readFileSync(join(homedir(), '.atlas', 'test-logins.json'), 'utf8'))
const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const hits = {}
page.on('request', r => { const m = r.url().match(/(va_shift_week|va_day_off_requests|ghl_settings)/); if (m) hits[m[1]] = (hits[m[1]] || 0) + 1 })
const errs = []
page.on('pageerror', e => errs.push(e.message.slice(0, 150)))
await page.goto(`${BASE}/login`)
await page.fill('input[placeholder="you@email.com"]', logins.admin.email)
await page.fill('input[placeholder="Your password"]', logins.admin.password)
await page.click('button[type="submit"]')
await page.waitForTimeout(3500)
await page.goto(`${BASE}/admin/fulfillment`)
await page.waitForTimeout(50000)
// move around and come back: remounting must not ask again
await page.click('a[href="/admin/agents"]'); await page.waitForTimeout(1500)
await page.click('a[href="/admin/fulfillment"]'); await page.waitForTimeout(1500)
await page.click('a[href="/admin/connect"]'); await page.waitForTimeout(50000)
console.log('calls in ~105 s:', JSON.stringify(hits), 'page errors:', errs.length)
console.log('connect tile:', (await page.locator('.ad-con').first().innerText()).replace(/\s+/g, ' ').slice(0, 220))
await b.close()
