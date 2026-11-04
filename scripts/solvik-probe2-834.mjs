// P834: Solvik's sliding tab pill, rail icon size, glass tile and backdrop (read-only).
import { chromium } from 'playwright'
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
for (const theme of ['dark', 'light']) {
  await page.goto('https://demo.codeandchill.store/solvik/#/pipeline', { waitUntil: 'networkidle' }); await page.waitForTimeout(1800)
  const btn = page.locator(`[aria-label="Switch to ${theme} theme"]`); if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(1200) }
  console.log(theme, JSON.stringify(await page.evaluate(() => {
    const cs = e => getComputedStyle(e)
    const cur = document.querySelector('[aria-current="page"]'); const nav = cur.closest('nav')
    const pill = [...nav.querySelectorAll('*')].filter(e => e !== cur && !cur.contains(e) && cs(e).backgroundColor !== 'rgba(0, 0, 0, 0)').map(e => `${e.tagName}.${e.className} ${cs(e).backgroundColor} ${Math.round(e.getBoundingClientRect().height)}h`)
    const set = document.querySelector('[aria-label="Settings"]'); const svg = set.querySelector('svg'); const r = set.getBoundingClientRect(); const sr = svg?.getBoundingClientRect()
    const rail = set.parentElement; let rr = rail; while (rr && cs(rr).backgroundColor === 'rgba(0, 0, 0, 0)') rr = rr.parentElement
    const navBg = cs(nav).backgroundColor
    const tile = [...document.querySelectorAll('*')].find(e => e.childElementCount === 0 && e.textContent.trim() === 'Qualification')
    let t = tile; while (t && cs(t).backgroundColor === 'rgba(0, 0, 0, 0)') t = t.parentElement
    const bodyKids = [...document.body.querySelectorAll('div')].slice(0, 8).map(e => `${e.className.toString().slice(0, 30)} bg:${cs(e).backgroundColor} img:${cs(e).backgroundImage.slice(0, 60)} f:${cs(e).filter}`)
    return { pill, navBg, navBorder: cs(nav).borderTopColor, railBtn: `${Math.round(r.width)}x${Math.round(r.height)} icon ${sr && Math.round(sr.width)}`, railBox: rr && `${Math.round(rr.getBoundingClientRect().width)}w ${cs(rr).backgroundColor}`, lane: t && `${cs(t).backgroundColor} border ${cs(t).borderTopWidth} ${cs(t).borderTopColor}`, topH: Math.round(nav.getBoundingClientRect().height), tabH: Math.round(cur.getBoundingClientRect().height), bodyKids }
  }), null, 1))
}
await b.close()
