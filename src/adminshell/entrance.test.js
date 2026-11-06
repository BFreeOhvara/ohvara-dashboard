import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { armEntrance, entranceStalled, SETTLE_MS, RECHECK_MS } from './entrance.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const anim = (currentTime, playState = 'running') => ({ animationName: 'fx-rise-soft', currentTime, playState })
// A stand-in app element and clock: timers run only when the test advances them.
function rig(anims) {
  const classes = new Set()
  const root = new Set()
  const el = { classList: { add: c => classes.add(c) }, ownerDocument: { documentElement: { classList: { add: c => root.add(c) } } }, getAnimations: () => anims }
  const queue = []
  const timers = { set: (f, ms) => { queue.push({ f, ms }); return queue.length - 1 }, clear: id => { queue[id] = null } }
  const fire = ms => queue.filter(t => t && t.ms === ms).forEach(t => t.f())
  return { el, classes, root, timers, fire }
}

test('frozen animations (stuck at their first moment) settle the page at SETTLE_MS: body and head show at rest', () => {
  const r = rig([anim(0), anim(0, 'pending'), anim(null, 'pending')])
  armEntrance(r.el, { timers: r.timers })
  assert.equal(r.classes.size, 0, 'nothing happens before the wait is over')
  r.fire(SETTLE_MS)
  assert.ok(r.classes.has('is-settled'))
  assert.ok(r.root.has('ad-settled'), 'the drawers and panels (outside the page) are released too')
})

test('animations that are really running keep their motion', () => {
  const r = rig([anim(560), anim(420), anim(5000)])
  armEntrance(r.el, { timers: r.timers })
  r.fire(SETTLE_MS)
  r.fire(RECHECK_MS)
  assert.equal(r.classes.size, 0)
  assert.equal(entranceStalled([anim(700, 'finished')]), false)
})

test('a slow first paint is caught by the second look', () => {
  const list = []
  const r = rig(list)
  armEntrance(r.el, { timers: r.timers })
  r.fire(SETTLE_MS) // nothing animating yet
  assert.equal(r.classes.size, 0)
  list.push(anim(0)) // motion began late and never ticked
  r.fire(RECHECK_MS)
  assert.ok(r.classes.has('is-settled'))
})

test('a hover transition that just began is not a stall (CSS animations only)', () => {
  assert.equal(entranceStalled([{ currentTime: 3, playState: 'running' }]), false)
})

test('reduced motion shows everything at once, no wait; a browser that cannot report animations shows it too', () => {
  const r = rig([])
  armEntrance(r.el, { still: true, timers: r.timers })
  assert.ok(r.classes.has('is-settled'))
  const n = rig([])
  delete n.el.getAnimations
  armEntrance(n.el, { timers: n.timers })
  n.fire(SETTLE_MS)
  assert.ok(n.classes.has('is-settled'))
})

test('stopping the watchdog cancels its looks (a page change, an unmount)', () => {
  const r = rig([anim(0)])
  const stop = armEntrance(r.el, { timers: r.timers })
  stop()
  r.fire(SETTLE_MS)
  assert.equal(r.classes.size, 0)
})

test('the frame arms it on the first painted frame, and the CSS drops every animation once settled', () => {
  const frame = src('./AdminFrame.jsx')
  assert.match(frame, /import \{ armEntrance \} from '\.\/entrance'/)
  assert.match(frame, /classList\.add\('is-anim'\); stop = armEntrance\(el, \{ still: still\(\) \}\)/)
  const css = src('./admin.css')
  assert.match(css, /\.ad\.is-settled, \.ad\.is-settled \*, \.ad-settled \.fx-layer, \.ad-settled \.fx-layer \* \{ animation: none !important; \}/)
  // the kit's own rest-first rule is still there: not painting means no entrance motion
  assert.match(src('../template/flow.css'), /\.fx\.tp-app:not\(\.is-anim\) :is\(\.fx-main, \.fx-head\) \*/)
})

test('nothing on the Overview hides its content behind a read: it only reads the in-memory hooks', () => {
  const overview = src('./screens/Overview.jsx')
  assert.doesNotMatch(overview, /supabase|useQuery|isLoading|return null/)
  // no page-level rule starts the body hidden outside a keyframe
  const css = src('./admin.css').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
  assert.doesNotMatch(css, /\.ad-(ov|main|tabpane)[^{]*\{[^}]*(opacity:\s*0[;\s}]|visibility:\s*hidden)/)
})

test('the agent frame arms the same watchdog, with its own <html> class, and flow.css drops every animation once settled', () => {
  const frame = src('../template/TemplateFrame.jsx')
  assert.match(frame, /import \{ armEntrance \} from '\.\.\/adminshell\/entrance'/)
  assert.match(frame, /classList\.add\('is-anim'\); stop = armEntrance\(el, \{ still: still\(\), rootClass: 'fx-settled' \}\)/)
  assert.match(src('../template/flow.css'), /\.fx\.tp-app\.is-settled, \.fx\.tp-app\.is-settled \*, \.fx-settled \.fx-layer, \.fx-settled \.fx-layer \* \{ animation: none !important; \}/)
  const r = rig([anim(0)])
  const html = []
  r.el.ownerDocument.documentElement.classList.add = c => html.push(c)
  armEntrance(r.el, { rootClass: 'fx-settled', timers: r.timers })
  r.fire(SETTLE_MS)
  assert.deepEqual(html, ['fx-settled'])
})
