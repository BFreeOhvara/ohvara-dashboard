// P1028: the website/desktop must not change. Serves two built dist folders and screenshots the same pages at the
// same moments (desktop 1440x900 + phone-width browser 390x844, light + dark), then compares them pixel for pixel.
//   node scripts/p1028/web-same.mjs <beforeDist> <afterDist> <outDir>
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const [beforeDir, afterDir, out] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' }
function serve(dir, port) {
  return new Promise(res => {
    const s = http.createServer((req, rsp) => {
      let p = path.join(dir, decodeURIComponent(req.url.split('?')[0]))
      if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(dir, 'index.html')
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' })
      fs.createReadStream(p).pipe(rsp)
    }).listen(port, () => res(s))
  })
}
const servers = [await serve(beforeDir, 4801), await serve(afterDir, 4802)]
const browser = await chromium.launch()
const views = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'phoneweb', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
]
const rows = []
for (const v of views) for (const scheme of ['light', 'dark']) for (const route of ['/login', '/']) for (const at of [120, 2500]) {
  const shots = []
  let classes = []
  for (const port of [4801, 4802]) {
    const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, colorScheme: scheme, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(`http://localhost:${port}${route}`, { waitUntil: 'commit' })
    await page.waitForTimeout(at)
    // Animations frozen so the two shots can be compared exactly.
    await page.addStyleTag({ content: '*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}' }).catch(() => {})
    classes.push(await page.evaluate(() => document.documentElement.className + ' | intro:' + !!document.querySelector('.oi')))
    shots.push(await page.screenshot())
    await ctx.close()
  }
  const same = Buffer.compare(shots[0], shots[1]) === 0
  const tag = `${v.name}-${scheme}${route.replace(/\//g, '_') || '_'}-${at}ms`
  if (at === 2500 && route === '/login') { fs.writeFileSync(path.join(out, `${tag}-before.png`), shots[0]); fs.writeFileSync(path.join(out, `${tag}-after.png`), shots[1]) }
  rows.push({ tag, same, before: classes[0], after: classes[1] })
}
await browser.close()
servers.forEach(s => s.close())
for (const r of rows) console.log(`${r.same ? 'SAME' : 'DIFF'}  ${r.tag}  html class before "${r.before}" after "${r.after}"`)
