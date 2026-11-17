// P1010 — the phone app's ~2 s logo reveal on a cold start. Source of public/intro.js:
// run `node scripts/p1010-build-intro.mjs` to write it (the mark's paths come from
// ohvara-site/_src/mark.json, the one correct logo source; P1020: on navy the big piece is teal, the wing white).
// A plain classic script so it runs before the app's bundle and paints from the first frame.
// It only runs inside the iPhone/Android app (Capacitor), never on the website.
// Three takes were made (A Sweep, B Draw, C Converge); Brayden picked B. The others stay for the preview page.
(function () {
  'use strict'
  var TAKE = 'B' // Brayden picked B (Nov 15)
  var NAVY = '#0A1F44', TEAL = '#00BFA6', WHITE = '#FFFFFF'
  var VB = [291.4, 354]
  var FRONT = '__FRONT__'
  var BACK = '__BACK__'
  var KEY = 'ohvara-intro-at'
  var TOTAL = 2150

  // The big piece's long axis, bottom tip to top tip (viewBox units).
  var BT = [52.2, 353], TT = [255.2, 1]
  var AX = [TT[0] - BT[0], TT[1] - BT[1]], AL = Math.hypot(AX[0], AX[1])
  var D = [AX[0] / AL, AX[1] / AL], N = [-D[1], D[0]]

  var EASE_OUT = 'cubic-bezier(.16,1,.3,1)'
  var EASE_IO = 'cubic-bezier(.65,0,.35,1)'
  var EASE_SOFT = 'cubic-bezier(.33,0,.2,1)'

  function svg(inner, cls) {
    return '<svg class="' + cls + '" viewBox="0 0 ' + VB[0] + ' ' + VB[1] + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + inner + '</svg>'
  }
  function pct(p) { return (p[0] / VB[0] * 100).toFixed(2) + '% ' + (p[1] / VB[1] * 100).toFixed(2) + '%' }
  // The big piece shows up to a line that travels along its axis, s = 0 (bottom tip) .. 1 (top tip).
  function wipe(s) {
    var L = 700, k = s * AL * 1.06
    var P = [BT[0] + D[0] * k, BT[1] + D[1] * k]
    var a = [P[0] + N[0] * L, P[1] + N[1] * L], b = [P[0] - N[0] * L, P[1] - N[1] * L]
    var c = [b[0] - D[0] * L, b[1] - D[1] * L], d = [a[0] - D[0] * L, a[1] - D[1] * L]
    return 'polygon(' + [a, b, c, d].map(pct).join(', ') + ')'
  }
  function wipeFrames(n, ease) {
    var out = []
    for (var i = 0; i <= n; i++) {
      var t = i / n
      out.push({ clipPath: wipe(ease(t)), webkitClipPath: wipe(ease(t)), offset: t })
    }
    return out
  }
  function inOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 }

  var CSS = [
    '.oi{position:fixed;inset:0;z-index:2147483647;background:' + NAVY + ';display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:auto;contain:strict}',
    '.oi.oi-in{position:absolute}',
    '.oi-stage{position:relative;width:34vmin;max-width:170px;aspect-ratio:291.4/354;will-change:transform}',
    '.oi.oi-in .oi-stage{width:34%}',
    '.oi-stage>*{position:absolute;inset:0;width:100%;height:100%;display:block;overflow:visible}',
    '.oi-glow{inset:-70% -80%!important;width:auto!important;height:auto!important;background:radial-gradient(closest-side,rgba(0,191,166,.42),rgba(0,191,166,.12) 55%,rgba(0,191,166,0));opacity:0}',
    '.oi-wing{transform-origin:60.3% 53.8%;opacity:0}',
    '.oi-front{transform-origin:17.9% 99.7%;opacity:0}',
    '.oi-line{opacity:0}',
    '.oi-line path{fill:none;stroke-width:2.6;stroke-linejoin:round;stroke-dasharray:1 1;stroke-dashoffset:1}',
    '.oi-sheen rect{transform-box:view-box;transform-origin:0 0}'
  ].join('')

  function markup() {
    return '<div class="oi-stage">' +
      '<div class="oi-glow"></div>' +
      // P1020 (Brayden): reversed, the big piece teal and the wing white, like the phone loading screen.
      svg('<path fill="' + WHITE + '" d="' + BACK + '"/>', 'oi-wing') +
      svg('<path fill="' + TEAL + '" d="' + FRONT + '"/>', 'oi-front') +
      svg('<path pathLength="1" stroke="' + WHITE + '" d="' + BACK + '"/><path pathLength="1" stroke="' + TEAL + '" d="' + FRONT + '"/>', 'oi-line') +
      svg('<defs><clipPath id="oi-clip"><path d="' + BACK + '"/><path d="' + FRONT + '"/></clipPath>' +
        '<linearGradient id="oi-sg" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/>' +
        '<stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>' +
        '<g clip-path="url(#oi-clip)"><rect x="0" y="-150" width="110" height="650" fill="url(#oi-sg)" style="transform:translate(-260px,0) rotate(22deg)"/></g>', 'oi-sheen') +
      '</div>'
  }

  // Build one take on `root` (the overlay). Returns the list of animations, all paused at 0.
  function build(root, take, reduce) {
    var q = function (s) { return root.querySelector(s) }
    var stage = q('.oi-stage'), wing = q('.oi-wing'), front = q('.oi-front'), line = q('.oi-line'),
      glow = q('.oi-glow'), sheen = q('.oi-sheen rect'), lines = root.querySelectorAll('.oi-line path')
    var A = []
    function an(el, frames, delay, dur, easing) {
      var a = el.animate(frames, { delay: delay, duration: dur, easing: easing || 'linear', fill: 'both' })
      a.pause(); A.push(a); return a
    }
    // The light pass: the mark sits a touch dim while it forms, and comes up to full colour as the light crosses it.
    function sheenPass(at, dur) {
      an(stage, [{ filter: 'brightness(.84)' }, { filter: 'brightness(1)' }], at, dur, EASE_SOFT)
      an(sheen, [{ transform: 'translate(-260px,0) rotate(22deg)' }, { transform: 'translate(330px,0) rotate(22deg)' }], at, dur, EASE_SOFT)
    }
    function exit(at, scaleTo) {
      // fill forwards only: before it starts it must not override the settle above.
      an(stage, [{ transform: 'scale(1)' }, { transform: 'scale(' + scaleTo + ')' }], at, 470, 'cubic-bezier(.4,0,.6,1)').effect.updateTiming({ fill: 'forwards' })
      an(root, [{ opacity: 1 }, { opacity: 0 }], at, 470, 'cubic-bezier(.4,0,.2,1)')
    }

    if (reduce) {
      an(wing, [{ opacity: 0 }, { opacity: 1 }], 0, 350, EASE_SOFT)
      an(front, [{ opacity: 0 }, { opacity: 1 }], 0, 350, EASE_SOFT)
      an(root, [{ opacity: 1 }, { opacity: 0 }], 850, 400, EASE_SOFT)
      return { anims: A, total: 1250 }
    }

    if (take === 'B') {
      // Draw: both outlines trace themselves, the shapes fill in, a light pass, then the app.
      an(line, [{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], 0, 1250)
      an(lines[0], [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], 60, 760, EASE_IO)
      an(lines[1], [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], 0, 820, EASE_IO)
      an(wing, [{ opacity: 0 }, { opacity: 1 }], 640, 520, EASE_SOFT)
      an(front, [{ opacity: 0 }, { opacity: 1 }], 600, 520, EASE_SOFT)
      an(stage, [{ transform: 'scale(.965)' }, { transform: 'scale(1)' }], 0, 1600, EASE_OUT)
      sheenPass(1020, 560)
      exit(1680, 1.04)
    } else if (take === 'C') {
      // Converge: the big piece glides up its own axis, the wing swings in to meet it, a teal bloom, then through.
      an(front, [{ opacity: 0, transform: 'translate(-35%,50%)' }, { opacity: 1, transform: 'translate(0,0)' }], 0, 980, 'cubic-bezier(.3,.75,.2,1)')
      an(wing, [{ opacity: 0, transform: 'translate(-42%,-6%) rotate(-38deg)' }, { opacity: 1, transform: 'translate(0,0) rotate(0deg)' }], 180, 860, 'cubic-bezier(.3,.75,.2,1)')
      an(glow, [{ opacity: 0, transform: 'scale(.55)' }, { opacity: 1, transform: 'scale(1)', offset: 0.35 }, { opacity: 0, transform: 'scale(1.35)' }], 820, 900, EASE_SOFT)
      sheenPass(1060, 560)
      exit(1680, 1.14)
    } else {
      // A, Sweep: the wing sweeps in on an arc, the big piece forms tip to tip, a soft light pass, settle, the app fades in.
      an(wing, [{ opacity: 0, transform: 'translate(-34%,24%) rotate(-30deg) scale(.86)' }, { opacity: 1, transform: 'translate(0,0) rotate(0deg) scale(1)' }], 0, 700, EASE_OUT)
      an(front, wipeFrames(24, inOut), 260, 760)
      an(front, [{ opacity: 0, transform: 'translate(2%,3%)' }, { opacity: 1, transform: 'translate(0,0)', offset: 0.45 }, { opacity: 1, transform: 'translate(0,0)' }], 260, 760, EASE_OUT)
      an(stage, [{ transform: 'scale(.94)' }, { transform: 'scale(1.015)', offset: 0.7 }, { transform: 'scale(1)' }], 0, 1650, EASE_SOFT)
      sheenPass(1000, 560)
      exit(1680, 1.05)
    }
    return { anims: A, total: TOTAL }
  }

  function mount(host, take, reduce, inline) {
    if (!document.getElementById('oi-css')) {
      var st = document.createElement('style'); st.id = 'oi-css'; st.textContent = CSS
      document.head.appendChild(st)
    }
    var root = document.createElement('div')
    root.className = 'oi' + (inline ? ' oi-in' : '')
    root.setAttribute('aria-hidden', 'true')
    root.innerHTML = markup()
    host.appendChild(root)
    var b = build(root, take, reduce)
    return { root: root, anims: b.anims, total: b.total,
      seek: function (ms) { b.anims.forEach(function (a) { a.currentTime = ms }) },
      play: function (from) { b.anims.forEach(function (a) { if (from) a.currentTime = from; a.play() }) } }
  }

  window.OhvaraIntro = { mount: mount, TAKES: ['A', 'B', 'C'], TOTAL: TOTAL }

  // ---- In the app: a cold start only. ----
  var C = window.Capacitor
  if (!C || typeof C.isNativePlatform !== 'function' || !C.isNativePlatform()) return
  function hideSplash() {
    try { if (C.nativePromise) return C.nativePromise('SplashScreen', 'hide', { fadeOutDuration: 0 }).catch(function () {}) } catch (e) { /* bridge not ready */ }
    return Promise.resolve()
  }
  // The intro needs the plain navy splash and launchAutoHide off, which only app builds from P1010 on have.
  // Older store builds (old splash with the mark, auto-hide) skip it, so they never see a jump.
  var MIN_BUILD = { ios: __MIN_IOS__, android: __MIN_ANDROID__ }
  window.__ohvaraIntroPending = true
  var decided = false
  // P1028: index.html keeps the page navy (html.oi-boot) until the intro covers it; without an intro, the theme returns.
  function unboot() { document.documentElement.classList.remove('oi-boot') }
  function skip() {
    if (decided) return
    decided = true
    window.__ohvaraIntroPending = false
    unboot()
    hideSplash()
  }
  setTimeout(skip, 1500)
  try {
    C.nativePromise('App', 'getInfo', {}).then(function (info) {
      if (decided) return
      var min = MIN_BUILD[C.getPlatform ? C.getPlatform() : ''] || Infinity
      if (!(Number(info && info.build) >= min)) return skip()
      decided = true
      run()
    }, skip)
  } catch (e) { skip() }

  function run() {
    var now = Date.now(), at = null
    try { at = Number(sessionStorage.getItem(KEY)) || null } catch (e) { /* storage off */ }
    var reduce = false
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) { /* old webview */ }
    // A reload part-way through the intro (the over-the-air update switching in at launch) carries on
    // from the same moment; any later reload, or a return from the background, never shows it again.
    var from = at ? now - at : 0
    if (at && from >= TOTAL) { window.__ohvaraIntroPending = false; unboot(); hideSplash(); return }
    if (!at) { try { sessionStorage.setItem(KEY, String(now)) } catch (e) { /* storage off */ } }
    var intro = mount(document.body || document.documentElement, TAKE, reduce)
    window.__ohvaraIntroPlaying = true
    window.__ohvaraIntroPending = false
    var started = false
    function start() {
      if (started) return
      started = true
      intro.play(from)
      setTimeout(function () {
        intro.root.remove()
        window.__ohvaraIntroPlaying = false
        window.dispatchEvent(new Event('ohvara-intro-done'))
      }, Math.max(0, intro.total - from) + 60)
    }
    // The native splash is the same plain navy, so the hand-off has nothing to jump.
    // P1028: the splash goes only once the overlay's first frame has been painted (two animation frames). Before,
    // it went in the same moment the overlay was added, so the phone showed the page under it for a frame or more:
    // white in light mode. Android can hold the webview's drawing while its splash is up, so 300 ms is the backstop.
    var shown = false
    function painted() {
      if (shown) return
      shown = true
      unboot()
      hideSplash().then(function () { requestAnimationFrame(start) })
      setTimeout(start, 700)
    }
    requestAnimationFrame(function () { requestAnimationFrame(painted) })
    setTimeout(painted, 300)
  }
})()
