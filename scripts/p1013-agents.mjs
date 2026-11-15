// P1013: Agents > "Signed up, not paying" shows the sign-ups with their date (sample preview, desktop + phone).
import { chromium } from 'playwright'
const b = await chromium.launch(); const out = []
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500 })).newPage()
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 120)))
  await p.goto('http://localhost:5013/preview/admin/agents', { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(1500)
  const pill = p.getByText('Signed up, not paying').first()
  const has = await pill.count(); if (has) await pill.click(); await p.waitForTimeout(600)
  const lines = await p.evaluate(() => [...document.querySelectorAll('small')].map(s => s.textContent).filter(t => /^Signed up /.test(t)))
  const old = await p.getByText('Signed up, not active').count()
  out.push({ w, pill: has, rows: lines.join(' | '), oldLabel: old, errors: errs.length, ox: await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) })
}
await b.close(); console.table(out)
