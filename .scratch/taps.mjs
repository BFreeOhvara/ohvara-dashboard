import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(process.cwd() + '/noop.js')
let pw
try { pw = require('playwright') } catch { pw = createRequire('C:/Users/freem/atlas-os/noop.js')('playwright') }
const b = await pw.chromium.launch()
for (const f of ['overview','servicing','leads']) for (const w of [390,1440]) for (const t of ['light','dark']) {
  const p = await b.newPage({ viewport: { width: w, height: 900 }, colorScheme: t })
  await p.goto(pathToFileURL(process.cwd() + `/ohvara/mockups/fulfillment-${f}.html`).href)
  await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), t)
  const bad = await p.evaluate(() => [...document.querySelectorAll('a[href],button,[role=tab]')].filter(e => !e.closest('template') && e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return { t: (e.textContent||'').trim().slice(0,30), w: Math.round(r.width), h: Math.round(r.height) } }).filter(x => x.w < 44 || x.h < 44))
  console.log(f, w, t, 'small targets:', bad.length, JSON.stringify(bad.slice(0,6)))
  await p.close()
}
await b.close()
