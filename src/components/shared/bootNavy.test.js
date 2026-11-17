import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

// P1028 — the phone app opened with a white frame between the navy splash and the intro: the splash was hidden in
// the same moment the intro was added, before it was painted, and since P1021 the page under it is light in light
// mode. These guard the fix: the page is splash navy during boot, and the splash goes only after the intro painted.
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const html = src('../../../index.html')
const intro = src('../../../public/intro.js')
const cap = JSON.parse(src('../../../capacitor.config.json'))
const androidSplash = src('../../../android/app/src/main/res/values/splash_colors.xml')
const NAVY = '#0A1F44'

const bootScript = html.match(/<script>\s*\(function \(\) \{\s*var C = window\.Capacitor[\s\S]*?<\/script>/)?.[0]
  .replace(/^<script>|<\/script>$/g, '')

function phone({ build = '99', introAt = null } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { runScripts: 'outside-only', url: 'https://localhost/' }) // the Android app's origin (jsdom has no storage on capacitor://)
  const w = dom.window
  const frames = []
  const log = { hides: [] }
  w.requestAnimationFrame = cb => { frames.push(cb); return frames.length }
  w.Element.prototype.animate = () => ({ pause() {}, play() {}, currentTime: 0, effect: { updateTiming() {} } })
  w.matchMedia = () => ({ matches: false })
  if (introAt) w.sessionStorage.setItem('ohvara-intro-at', String(introAt))
  w.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    nativePromise(plugin, method) {
      if (plugin === 'App' && method === 'getInfo') return Promise.resolve({ build })
      if (plugin === 'SplashScreen' && method === 'hide') {
        log.hides.push({ boot: w.document.documentElement.classList.contains('oi-boot'), intro: !!w.document.querySelector('.oi'), framesRun: log.framesRun || 0 })
      }
      return Promise.resolve()
    },
  }
  const flush = () => { const run = frames.splice(0); log.framesRun = (log.framesRun || 0) + 1; run.forEach(cb => cb(0)) }
  return { w, log, flush, done: () => w.close() }
}
const tick = () => new Promise(r => setTimeout(r, 0))

test('the boot navy is the splash navy, and the native splash is that same navy', () => {
  assert.match(html, /html\.oi-boot,html\.oi-boot body\{background:#0A1F44!important\}/)
  assert.equal(cap.plugins.SplashScreen.backgroundColor, NAVY)
  // The webview's own background (seen for a moment between the launch screen and the splash on iOS) is navy too.
  assert.equal(cap.backgroundColor, NAVY)
  assert.match(androidSplash, new RegExp(`ohvaraSplashNavy">${NAVY}<`))
  assert.ok(bootScript, 'index.html has the boot script')
})

test('cold start: the page is navy, and the splash is hidden only after the intro has painted (two frames)', async () => {
  const { w, log, flush, done } = phone()
  w.eval(bootScript)
  assert.ok(w.document.documentElement.classList.contains('oi-boot'), 'page navy before anything paints')
  w.eval(intro)
  await tick()
  assert.ok(w.document.querySelector('.oi'), 'intro mounted')
  assert.equal(log.hides.length, 0, 'splash still up the moment the intro is added')
  flush()
  assert.equal(log.hides.length, 0, 'still up after one frame')
  flush()
  assert.equal(log.hides.length, 1, 'hidden once the intro has painted')
  assert.deepEqual(log.hides[0], { boot: false, intro: true, framesRun: 2 }, 'navy class off under the intro, before the splash goes')
  done()
})

test('a reload after the intro (over-the-air update) keeps the theme background: no navy', () => {
  const { w, done } = phone({ introAt: Date.now() - 10000 })
  w.eval(bootScript)
  assert.equal(w.document.documentElement.classList.contains('oi-boot'), false)
  done()
})

test('an older app build (no intro) gives the page its theme back before the splash goes', async () => {
  const { w, log, done } = phone({ build: '1' })
  w.eval(bootScript)
  w.eval(intro)
  await tick()
  assert.equal(log.hides.length, 1)
  assert.equal(log.hides[0].boot, false)
  assert.equal(w.document.querySelector('.oi'), null)
  done()
})

test('the website never gets the boot navy', () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'outside-only', url: 'https://portal.ohvara.com/' })
  dom.window.eval(bootScript)
  assert.equal(dom.window.document.documentElement.classList.contains('oi-boot'), false)
  dom.window.close()
})
