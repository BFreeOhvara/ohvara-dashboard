import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import './practice.css'
import { LESSONS } from './lessons.js'
import { tourOf } from './tours.js'
import { FUL } from '../../template/ful/paths.js'
import { readPractice, writePractice, endPractice, onPracticeCopy, practiceUrl } from '../../lib/practice.js'
import { markPracticed } from './store.js'

// P948 — the "Show me how" player, in the practice copy (lib/practice.js). Loaded only while a practice is on (the
// store imports it lazily), so driver.js stays out of everyone else's pages. Plain DOM on purpose: it runs above
// whichever VA page is showing. Phase 'show': the tour plays itself (pointer, scroll, highlight, caption, click).
// Phase 'turn': the same steps, highlighted, done by the VA; the last one ticks the lesson and returns to Training.

const sleep = ms => new Promise(r => setTimeout(r, ms))
const squash = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
const enabled = el => !el.disabled && el.getAttribute('aria-disabled') !== 'true'
const CLICKABLE = 'button, a, [role="button"], [role="menuitem"], [role="option"], [role="tab"]'
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// The element a step points at: under `sel`, the clickable whose words (or label) start with `text`, or the element
// whose words include `has`, or `sel` itself. Visible only; a click step also waits for it to be enabled.
function locate(step) {
  const roots = [...document.querySelectorAll(step.sel || 'body')].filter(visible)
  for (const root of roots) {
    if (step.text) {
      const want = squash(step.text)
      const hit = [root, ...root.querySelectorAll(CLICKABLE)].filter(e => e.matches?.(CLICKABLE) && visible(e))
        .find(e => squash(e.textContent).startsWith(want) || squash(e.getAttribute('aria-label')).startsWith(want))
      if (hit) return hit
    } else if (step.has) {
      if (squash(root.textContent).includes(squash(step.has))) {
        // The smallest clickable inside that carries the words, if the step is a click; else the area itself.
        if (step.act === 'click') {
          const c = [...root.querySelectorAll(CLICKABLE)].filter(visible).find(e => squash(e.textContent).includes(squash(step.has)))
          if (c) return c
        }
        return root
      }
    } else return root
  }
  return null
}
async function find(step, ms = 7000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const el = locate(step)
    if (el && (step.act !== 'click' || enabled(el))) return el
    await sleep(120)
  }
  return null
}

// --- The pieces on screen: the practice bar, the pointer, the end cards ---------------------------------------------
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e }
function btn(label, primary, run) { const b = el('button', primary ? 'tp-primary fx-accent' : 'tp-btn ov-ghost', label); b.type = 'button'; b.addEventListener('click', run); return b }

let bar = null
function paintBar(lesson, phase, step, total) {
  if (!bar) {
    bar = el('div', 'pr-bar')
    bar.setAttribute('role', 'status')
    bar.setAttribute('aria-live', 'polite')
    document.body.append(bar)
  }
  bar.replaceChildren()
  const txt = el('span', 'pr-bar-t')
  const tag = el('b', 'pr-tag', 'Practice copy')
  const what = phase === 'show' ? 'Watch how it\'s done' : phase === 'turn' ? 'Your turn' : 'Done'
  txt.append(tag, el('span', 'pr-what', `${what}${total ? ` · step ${Math.min(step + 1, total)} of ${total}` : ''}`), el('small', 'pr-safe', `${lesson.title}. Nothing here is real.`))
  bar.append(txt)
  if (phase === 'turn') bar.append(btn('Watch again', false, () => restart('show')))
  bar.append(btn('Exit practice', false, () => leave(false)))
}

let ptr = null
function pointer() {
  if (ptr) return ptr
  ptr = el('div', 'pr-ptr')
  ptr.setAttribute('aria-hidden', 'true')
  ptr.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2.5 19.5 12l-6.8 1.4 3.9 7.3-2.9 1.5-3.9-7.3L4.9 20Z"/></svg><i></i>'
  ptr.style.transform = `translate(${window.innerWidth / 2}px, ${window.innerHeight - 80}px)`
  document.body.append(ptr)
  return ptr
}
async function pointAt(target) {
  const r = target.getBoundingClientRect()
  const x = Math.round(r.left + Math.min(r.width / 2, 120))
  const y = Math.round(r.top + Math.min(r.height / 2, 60))
  const p = pointer()
  p.style.transform = `translate(${x}px, ${y}px)`
  await sleep(reduced() ? 50 : 750)
}
async function press() {
  const p = pointer()
  p.classList.remove('is-press'); void p.offsetWidth; p.classList.add('is-press')
  await sleep(320)
}

function card({ icon, title, body, actions }) {
  const wrap = el('div', 'pr-card-wrap')
  const c = el('section', 'pr-card fx-tile')
  c.setAttribute('role', 'dialog')
  c.setAttribute('aria-modal', 'true')
  c.setAttribute('aria-label', title)
  const ic = el('span', `pr-card-ic${icon === 'done' ? ' is-done' : ''}`)
  ic.innerHTML = icon === 'done'
    ? '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
    : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4L3.4 16a2 2 0 0 1 3-2.7L8 15"/></svg>'
  const acts = el('div', 'pr-card-acts')
  for (const a of actions || []) acts.append(a)
  c.append(ic, el('h2', '', title), el('p', '', body), acts)
  wrap.append(c)
  document.body.append(wrap)
  acts.querySelector('button')?.focus()
  return wrap
}

// --- Flow ------------------------------------------------------------------------------------------------------------
let ctx = null
let lesson = null
let tour = null
let drv = null
const startUrl = () => practiceUrl(FUL[tour.start] || FUL.overview)

function restart(phase) {
  writePractice({ ...ctx, phase })
  window.location.assign(startUrl()) // a fresh load resets the sample, so every run starts the same
}
function leave(done) {
  drv?.destroy()
  endPractice()
  const back = ctx?.back || '/fulfillment/training'
  window.location.assign(`${back}${back.includes('?') ? '&' : '?'}practised=${done ? 'done' : 'left'}`)
}

// The bar never sits over the spot: if they'd overlap, it moves to the top for this step.
function clearBar(target) {
  if (!bar) return
  bar.classList.remove('is-top')
  const a = bar.getBoundingClientRect()
  const b = target.getBoundingClientRect()
  if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) bar.classList.add('is-top')
}

function highlight(target, step, i, n, opts = {}) {
  drv?.destroy()
  clearBar(target)
  drv = driver({
    animate: !reduced(),
    smoothScroll: true,
    allowClose: false,
    allowKeyboardControl: false,
    overlayClickBehavior: () => {},
    overlayOpacity: 0.55,
    stagePadding: 6,
    stageRadius: 12,
    popoverClass: 'pr-pop',
    disableActiveInteraction: !!opts.watch,
  })
  drv.highlight({
    element: target,
    popover: {
      title: `${i + 1} of ${n}`,
      description: step.say,
      side: 'bottom',
      align: 'start',
      showButtons: opts.next ? ['next'] : [],
      nextBtnText: 'Got it',
      onNextClick: opts.next || undefined,
    },
  })
}

async function lost(i) {
  drv?.destroy()
  console.warn(`[practice] ${lesson.id}: step ${i + 1} not found`, tour.steps[i])
  card({ icon: 'hand', title: 'That spot moved', body: 'This page changed since the walkthrough was made. Start again, or go back to the lesson.', actions: [btn('Start again', true, () => restart(ctx.phase)), btn('Back to the lesson', false, () => leave(false))] })
}

async function show() {
  const n = tour.steps.length
  await sleep(900)
  for (let i = 0; i < n; i++) {
    const step = tour.steps[i]
    paintBar(lesson, 'show', i, n)
    const target = await find(step)
    if (!target) return lost(i)
    target.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' })
    await sleep(reduced() ? 50 : 420)
    await pointAt(target)
    highlight(target, step, i, n, { watch: true })
    await sleep(step.wait || (step.act === 'look' ? 2600 : 1700))
    if (step.act === 'click') {
      await press()
      drv?.destroy()
      target.click()
      await sleep(700)
    }
  }
  drv?.destroy()
  ptr?.remove(); ptr = null
  paintBar(lesson, 'over', 0, 0)
  card({
    icon: 'hand',
    title: 'Your turn',
    body: 'Now you do it, in the same practice copy. The highlights show you where. Nothing here is real.',
    actions: [btn('Do it myself', true, () => restart('turn')), btn('Watch again', false, () => restart('show'))],
  })
}

async function turn() {
  const n = tour.steps.length
  await sleep(600)
  for (let i = 0; i < n; i++) {
    const step = tour.steps[i]
    paintBar(lesson, 'turn', i, n)
    const target = await find(step, 12000)
    if (!target) return lost(i)
    target.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' })
    await sleep(reduced() ? 50 : 380)
    await new Promise(resolve => {
      if (step.act === 'look') { highlight(target, step, i, n, { next: () => { drv?.destroy(); resolve() } }); return }
      highlight(target, step, i, n)
      // Their click on the highlighted spot (capture, so it's seen before the page changes) moves them on.
      const onClick = e => {
        if (!target.contains(e.target)) return
        document.removeEventListener('click', onClick, true)
        setTimeout(() => { drv?.destroy(); resolve() }, 0)
      }
      document.addEventListener('click', onClick, true)
    })
    await sleep(step.act === 'click' ? 650 : 200)
  }
  drv?.destroy()
  const ticks = !!lesson.tryIt && !lesson.quiz
  if (ticks) markPracticed(ctx.name, lesson.id)
  paintBar(lesson, 'over', 0, 0)
  card({
    icon: 'done',
    title: 'Nice, you\'ve got it',
    body: `${tour.done} ${ticks ? 'This lesson is done. Taking you back to Training…' : 'Taking you back to the lesson for its check…'}`,
    actions: [btn(ticks ? 'Back to Training' : 'Back to the lesson', true, () => leave(true))],
  })
  setTimeout(() => leave(true), 2400)
}

export function boot() {
  ctx = readPractice()
  if (!ctx || !onPracticeCopy()) return
  lesson = LESSONS.find(l => l.id === ctx.lesson)
  tour = tourOf(ctx.lesson)
  if (!lesson || !tour) { endPractice(); return }
  document.documentElement.classList.add('is-practice')
  if (ctx.phase === 'turn') turn(); else show()
}
