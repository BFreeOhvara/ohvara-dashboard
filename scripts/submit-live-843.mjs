// P843: Submit a policy end to end as the test agent at /agent/submit (signed in). Lists every non-GET backend call.
//   node scripts/submit-live-843.mjs <base-url>
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
const BASE = (process.argv[2] || 'http://localhost:4179').replace(/\/$/, '')
const logins = JSON.parse(readFileSync(join(homedir(), '.atlas', 'test-logins.json'), 'utf8'))
const b = await chromium.launch()
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errs = []
let writes = []
p.on('pageerror', e => errs.push(e.message))
p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)) })
p.on('request', r => { if (!['GET', 'OPTIONS', 'HEAD'].includes(r.method()) && /supabase\.co/.test(r.url())) writes.push(r.method() + ' ' + r.url().replace(/^https:\/\/[^/]+/, '').split('?')[0]) })
await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await p.fill('input[placeholder="you@email.com"]', logins.agent.email)
await p.fill('input[placeholder="Your password"]', logins.agent.password)
await p.click('button[type="submit"]')
await p.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 30000 })
await p.goto(`${BASE}/agent/submit`, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
writes = []
await p.fill('input[placeholder="First and last name"]', 'P843 Test Client')
await p.fill('input[placeholder="(555) 555-0100"]', '(555) 555-0100')
await p.click('.fx-sub-f button:has-text("Next")')
await p.locator('.fx-sub-quick button').first().click()
await p.click('.fx-sub-f button:has-text("Next")')
await p.click('.fx-sub-f button:has-text("Submit policy")')
await p.waitForTimeout(800)
const done = await p.evaluate(() => document.querySelector('.fx-sub-ok h2')?.textContent)
await p.locator('nav.fx-tabs a:has-text("Activity")').click()
await p.waitForTimeout(1500)
const inActivity = await p.evaluate(() => [...document.querySelectorAll('.fx-feed-r')].some(r => /P843 Test Client/.test(r.textContent)))
console.log(JSON.stringify({ url: p.url(), done, inActivity, writesDuringSubmit: writes, errs }, null, 1))
await b.close()
