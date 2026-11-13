import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import './practice.css'
import { LESSONS } from './lessons.js'
import { tourOf, clipKey, FINISH, PHONE_AWAY } from './tours.js'
import { endsInQuiz } from './model.js'
import VOICE from './practiceVoice.json'
import { readPractice, endPractice, onPracticeCopy } from '../../lib/practice.js'
import { markPracticed } from './store.js'

// P979 — Practice, in the practice copy (lib/practice.js). Loaded only while a practice is on (the store imports it
// lazily), so driver.js stays out of everyone else's pages. Plain DOM on purpose: it runs above whichever VA page is
// showing. Nothing clicks itself: for each step the spotlight and pointer glide to the spot, the caption shows, Mark
// reads the line (pre-rendered clips, ./practiceVoice.json), and the step waits for the VA to click that spot. A
// click anywhere else does nothing but pulse the spot. After the last step the lesson's Practice is recorded and they
// go back to Training (or to the lesson's check).

const sleep = ms => new Promise(r => setTimeout(r, ms))
const squash = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
const CLICKABLE = 'button, a, [role="button"], [role="menuitem"], [role="option"], [role="tab"]'
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const bold = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
const plain = s => String(s).replace(/\*\*/g, '')

// The element a step points at: under `sel`, the clickable whose words (or label) start with `text`, or the clickable
// whose words include `has`, or `sel` itself. Visible only.
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
        const c = [...root.querySelectorAll(CLICKABLE)].filter(visible).find(e => squash(e.textContent).includes(squash(step.has)))
        return c || root
      }
    } else return root
  }
  return null
}
async function find(step, ms = 12000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const el = locate(step)
    if (el) return el
    await sleep(120)
  }
  return null
}
// Is the spot under the phone panel (it slides over the page on narrower screens)?
function underPhone(target) {
  const r = target.getBoundingClientRect()
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return !!top && !target.contains(top) && !!top.closest?.('.fs-call') && !target.closest('.fs-call')
}

// --- Mark's voice: one clip per line, played once per step, with replay and mute ------------------------------------
const MUTE_KEY = 'ohvara-practice-mute'
let muted = (() => { try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false } })()
const base = () => import.meta.env?.VITE_TRAINING_VIDEO_BASE || VOICE.base
const clipUrl = key => (VOICE.clips[key] ? `${base()}${VOICE.clips[key].src}` : null)
let audio = null
let current = null
let blocked = false
function stopVoice() { if (audio) { audio.pause(); audio.onended = null } }
function say(key) {
  current = key
  stopVoice()
  const url = clipUrl(key)
  if (!url || muted) return Promise.resolve()
  audio = new Audio(url)
  return new Promise(resolve => {
    audio.onended = resolve
    audio.onerror = resolve
    audio.play().then(() => { blocked = false; paintSound() }).catch(() => { blocked = true; paintSound(); resolve() })
  })
}
function preload(key) { const url = clipUrl(key); if (url && !muted) { const a = new Audio(); a.preload = 'auto'; a.src = url } }
const replay = () => { if (current) { if (muted) setMuted(false); say(current) } }
function setMuted(m) {
  muted = m
  try { localStorage.setItem(MUTE_KEY, m ? '1' : '0') } catch { /* private window: lasts this page */ }
  if (m) stopVoice()
  paintSound()
}
// A soft two-note tick for a right click (no file; silent when muted).
function tick() {
  if (muted) return
  try {
    const ac = tick.ac || (tick.ac = new (window.AudioContext || window.webkitAudioContext)())
    const t = ac.currentTime
    for (const [f, d] of [[880, 0], [1320, 0.09]]) {
      const o = ac.createOscillator(), g = ac.createGain()
      o.type = 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.22)
      o.connect(g).connect(ac.destination); o.start(t + d); o.stop(t + d + 0.25)
    }
  } catch { /* no audio: the tick is only a nicety */ }
}

// --- The pieces on screen: the practice bar, the pointer, the cards --------------------------------------------------
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e }
function btn(label, primary, run) { const b = el('button', primary ? 'tp-primary fx-accent' : 'tp-btn ov-ghost', label); b.type = 'button'; b.addEventListener('click', run); return b }
const ICON = {
  on: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>',
  off: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>',
  again: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
}

let bar = null
let soundBtn = null
function paintBar(step, total) {
  if (!bar) {
    bar = el('div', 'pr-bar')
    bar.setAttribute('role', 'region')
    bar.setAttribute('aria-label', 'Practice')
    document.body.append(bar)
  }
  bar.replaceChildren()
  const txt = el('span', 'pr-bar-t')
  txt.append(el('b', 'pr-tag', 'Practice'), el('span', 'pr-what', total ? `Step ${Math.min(step + 1, total)} of ${total}` : 'Done'), el('small', 'pr-safe', `${lesson.title}. Nothing here is real.`))
  soundBtn = el('button', 'pr-ic')
  soundBtn.type = 'button'
  soundBtn.addEventListener('click', () => setMuted(!muted))
  bar.append(txt, soundBtn, btn('Exit practice', false, () => leave(false)))
  paintSound()
}
function paintSound() {
  if (soundBtn) {
    soundBtn.innerHTML = muted ? ICON.off : ICON.on
    soundBtn.setAttribute('aria-label', muted ? 'Turn Mark\'s voice on' : 'Mute Mark\'s voice')
    soundBtn.setAttribute('aria-pressed', String(muted))
    soundBtn.title = muted ? 'Voice off' : 'Voice on'
  }
  const r = document.querySelector('.pr-replay')
  if (r) r.classList.toggle('is-ask', blocked && !muted)
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
  p.classList.remove('is-hint')
  p.style.transform = `translate(${x}px, ${y}px)`
  await sleep(reduced() ? 50 : 750)
  p.classList.add('is-hint') // "you click this": a soft ring under the pointer until they do
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

// "Nice": a small tick chip pops where they clicked.
function nice(rect) {
  const n = el('div', 'pr-nice')
  n.setAttribute('aria-hidden', 'true')
  n.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Nice'
  n.style.left = `${Math.round(Math.min(rect.left + rect.width / 2, window.innerWidth - 50))}px`
  n.style.top = `${Math.round(Math.max(rect.top - 8, 24))}px`
  document.body.append(n)
  setTimeout(() => n.remove(), 1100)
}

// --- Flow ------------------------------------------------------------------------------------------------------------
let ctx = null
let lesson = null
let tour = null
let drv = null
let pulseTarget = null

function leave(done) {
  drv?.destroy()
  stopVoice()
  endPractice()
  const back = ctx?.back || '/fulfillment/training'
  window.location.assign(`${back}${back.includes('?') ? '&' : '?'}practised=${done ? 'done' : 'left'}`)
}
function restart() { window.location.reload() } // a fresh load resets the sample, so every run starts the same

// The bar never sits over the spot: if they'd overlap, it moves to the top for this step.
function clearBar(target) {
  if (!bar) return
  bar.classList.remove('is-top')
  const a = bar.getBoundingClientRect()
  const b = target.getBoundingClientRect()
  if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) bar.classList.add('is-top')
}

// A click anywhere but the spot: no penalty, the spot pulses and the replay button stands out.
function missed() {
  const t = pulseTarget
  if (!t) return
  t.classList.remove('pr-pulse'); void t.offsetWidth; t.classList.add('pr-pulse')
  const r = document.querySelector('.pr-replay')
  if (r) { r.classList.remove('is-nudge'); void r.offsetWidth; r.classList.add('is-nudge') }
}

let seq = 0
function highlight(target, caption, i, n) {
  drv?.destroy()
  document.documentElement.dataset.practiceStep = `${i + 1}.${++seq}` // for the Playwright check
  clearBar(target)
  pulseTarget = target
  drv = driver({
    animate: !reduced(),
    smoothScroll: true,
    allowClose: false,
    allowKeyboardControl: false,
    overlayClickBehavior: missed,
    overlayOpacity: 0.55,
    stagePadding: 6,
    stageRadius: 12,
    popoverClass: 'pr-pop',
    onPopoverRender: pop => {
      const again = el('button', 'pr-replay')
      again.type = 'button'
      again.innerHTML = `${ICON.again}<span>Hear it again</span>`
      again.setAttribute('aria-label', 'Hear Mark say it again')
      again.addEventListener('click', replay)
      pop.footer.prepend(again)
      pop.footer.style.display = 'flex'
      paintSound()
    },
  })
  drv.highlight({ element: target, popover: { title: `Step ${i + 1} of ${n}`, description: bold(caption), side: 'bottom', align: 'start', showButtons: [] } })
}

// Wait for their click on the spot (capture, so it's seen before the page changes). A typing step counts only when
// its box has text.
function waitClick(target, step) {
  return new Promise(resolve => {
    const onClick = e => {
      if (!target.contains(e.target)) return
      if (step.act === 'type') {
        const box = document.querySelector(step.field)
        if (!box || !String(box.value || box.textContent || '').trim()) { missed(); return }
      }
      document.removeEventListener('click', onClick, true)
      const r = target.getBoundingClientRect()
      setTimeout(() => resolve(r), 0)
    }
    document.addEventListener('click', onClick, true)
  })
}

// One spot: glide there, show the caption, say the line (if any), wait for the click.
async function guide(step, caption, i, n, key) {
  const target = await find(step)
  if (!target) return null
  target.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' })
  await sleep(reduced() ? 50 : 380)
  await pointAt(target)
  highlight(target, caption, i, n)
  if (key) say(key)
  return waitClick(target, step)
}

async function lost(i) {
  drv?.destroy()
  stopVoice()
  console.warn(`[practice] ${lesson.id}: step ${i + 1} not found`, tour.steps[i])
  card({ icon: 'hand', title: 'That spot moved', body: 'This page changed since the practice was made. Start again, or go back to the lesson.', actions: [btn('Start again', true, restart), btn('Back to the lesson', false, () => leave(false))] })
}

async function run() {
  const n = tour.steps.length
  await sleep(700)
  for (let i = 0; i < n; i++) {
    const step = tour.steps[i]
    paintBar(i, n)
    if (tour.steps[i + 1]) preload(clipKey(lesson.id, i + 1))
    // On narrower screens the phone can slide over the spot: they slide it away first (their click, not ours).
    const first = await find(step)
    if (!first) return lost(i)
    if (underPhone(first) && !(await guide(PHONE_AWAY, PHONE_AWAY.say, i, n, PHONE_AWAY.key))) return lost(i)
    let r = await guide(step, step.say, i, n, clipKey(lesson.id, i))
    if (!r) return lost(i)
    if (step.then) {
      await sleep(250)
      r = await guide(step.then, step.then.say || step.say, i, n, null)
      if (!r) return lost(i)
    }
    drv?.destroy()
    pulseTarget = null
    ptr?.classList.remove('is-hint')
    tick()
    nice(r)
    await sleep(reduced() ? 300 : 700)
  }
  finish()
}

async function finish() {
  drv?.destroy()
  ptr?.remove(); ptr = null
  const check = endsInQuiz(lesson)
  markPracticed(ctx.name, lesson.id)
  paintBar(0, 0)
  card({
    icon: 'done',
    title: plain(FINISH.say),
    body: `${tour.done} ${check ? 'Practice done. Taking you back to the lesson for its check…' : 'This lesson is done. Taking you back to Training…'}`,
    actions: [btn(check ? 'Back to the lesson' : 'Back to Training', true, () => leave(true))],
  })
  const t0 = Date.now()
  await say(FINISH.key)
  await sleep(Math.max(600, 2600 - (Date.now() - t0)))
  leave(true)
}

export function boot() {
  ctx = readPractice()
  if (!ctx || !onPracticeCopy()) return
  lesson = LESSONS.find(l => l.id === ctx.lesson)
  tour = tourOf(ctx.lesson)
  if (!lesson || !tour) { endPractice(); return }
  document.documentElement.classList.add('is-practice')
  preload(clipKey(lesson.id, 0))
  run()
}
