// P859 — content never waits on motion. The shell's entrance animations start from opacity 0 (fill-mode both), so a
// browser that does not actually tick them (a throttled or GPU-starved tab, a paused timeline) left the page body
// invisible while the frame (no entrance animation) showed. The watchdog below drops every entrance animation back to the
// visible resting look (.is-settled, admin.css) when they have not really started. Plain JS, no JSX, so a node test runs it.
export const SETTLE_MS = 600 // how long motion gets to get going before the page shows at rest
export const RECHECK_MS = 2000 // a second look, for a slow first paint
const STALLED_BELOW = 100 // ms: an animation older than SETTLE_MS that is still inside its first 100 ms has not run

// CSS animations only (they have an animationName): a hover transition that began a moment ago is not a stall.
const live = a => !!a.animationName && (a.playState === 'running' || a.playState === 'pending' || a.playState === 'paused')

// True when some entrance animation under `el` has not moved: it is still at its very first moment.
export function entranceStalled(anims) {
  return anims.some(a => live(a) && !(Number(a.currentTime) >= STALLED_BELOW))
}

// Starts the watchdog on the app element. rootClass: the class put on <html> (admin 'adm-settled', agent 'fx-settled').
// Returns a stop function.
// P917 (motion stopped after a few clicks): a look used to count ANY animation inside its first 100 ms as stalled, so a
// click that began one just before a look (an icon's wiggle, a drawer, the next page building in) settled the page, and
// .is-settled + the <html> class then switched every animation off for the rest of the session. Now only an animation
// already there at an earlier look (or when armed) can be stalled, a third look ages the late ones, and stopping the
// watchdog (a page change, an unmount) lifts a settle it made, so the next page gets its motion back.
export function armEntrance(el, { still = false, rootClass = 'adm-settled', timers = { set: (f, ms) => setTimeout(f, ms), clear: id => clearTimeout(id) } } = {}) {
  // On the app (the page) and on <html> (the drawers and panels, which render outside it).
  const root = el.ownerDocument?.documentElement
  let settled = false
  const settle = () => { settled = true; el.classList.add('is-settled'); root?.classList.add(rootClass) }
  if (still) { settle(); return () => {} } // reduced motion: everything shows at once
  const can = typeof el.getAnimations === 'function'
  const seen = new WeakSet()
  const note = list => list.forEach(x => seen.add(x))
  if (can) note(el.getAnimations({ subtree: true }))
  const check = () => {
    if (!can) { settle(); return } // cannot tell, so show it
    const list = el.getAnimations({ subtree: true })
    if (entranceStalled(list.filter(x => seen.has(x)))) settle()
    note(list)
  }
  const ids = [timers.set(check, SETTLE_MS), timers.set(check, RECHECK_MS), timers.set(check, RECHECK_MS + SETTLE_MS)]
  return () => {
    ids.forEach(id => timers.clear(id))
    if (settled) { el.classList.remove?.('is-settled'); root?.classList.remove?.(rootClass) }
  }
}

// P917: the frames' visibility rule. Hiding the tab before the entrance has had its time drops .is-anim (a background tab
// sits at its final look); coming back puts it back on the next frame, so the entrance plays. Once the entrance has run,
// hiding the tab no longer touches it: before, switching away and back left .is-anim off and every page animation off
// until the next page.
export function visibilityGate(el, { doc = el.ownerDocument, now = () => performance.now(), frame = f => requestAnimationFrame(f) } = {}) {
  const armed = now()
  return () => {
    if (doc.hidden) { if (now() - armed < RECHECK_MS) el.classList.remove('is-anim') } else if (!el.classList.contains('is-anim')) frame(() => el.classList.add('is-anim'))
  }
}
