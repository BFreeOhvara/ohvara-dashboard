// P1010 — the phone app's ~2 s logo reveal on a cold start. Source of public/intro.js:
// run `node scripts/p1010-build-intro.mjs` to write it (the mark's paths come from
// ohvara-site/_src/mark.json, the one correct logo source; on navy the big piece is white, the wing teal).
// A plain classic script so it runs before the app's bundle and paints from the first frame.
// It only runs inside the iPhone/Android app (Capacitor), never on the website.
// Three takes for Brayden to pick from (A Sweep, B Draw, C Converge); TAKE is the default.
(function () {
  'use strict'
  var TAKE = 'A'
  var NAVY = '#0A1F44', TEAL = '#00BFA6', WHITE = '#FFFFFF'
  var VB = [291.4, 354]
  var FRONT = 'M54.2 352.3 L52.2 353.0 L51.9 352.3 L58.2 346.5 L65.6 339.3 L71.4 333.3 L81.5 322.3 L88.4 314.3 L97.5 303.3 L105.5 293.3 L114.6 281.3 L127.5 263.3 L141.6 242.3 L153.6 223.3 L165.4 203.3 L175.5 185.3 L187.7 162.3 L200.5 136.3 L212.5 110.3 L219.5 94.3 L223.9 83.3 L224.5 82.3 L230.6 67.3 L234.0 58.3 L234.5 57.3 L237.0 50.3 L239.4 44.3 L240.0 42.3 L240.5 41.3 L243.0 34.3 L243.5 33.3 L244.1 31.3 L244.6 30.3 L246.9 23.3 L247.4 22.3 L248.0 20.3 L248.5 19.3 L249.0 17.3 L250.5 13.3 L253.6 4.3 L254.1 2.3 L255.2 1.0 L255.4 2.3 L254.6 52.3 L253.5 87.3 L250.5 163.3 L250.0 171.3 L249.5 184.3 L249.0 192.3 L248.5 205.3 L248.0 212.3 L247.5 225.3 L247.1 230.3 L247.3 231.3 L249.2 232.4 L289.2 251.1 L290.4 252.3 L283.2 255.5 L279.2 257.0 L271.2 260.5 L265.2 262.9 L264.2 263.5 L253.2 268.0 L252.2 268.6 L239.2 273.9 L238.2 274.5 L227.2 279.0 L224.2 280.4 L220.2 282.0 L219.2 282.6 L201.2 290.0 L200.2 290.6 L194.2 293.0 L193.2 293.6 L175.2 301.0 L167.2 304.6 L161.2 306.9 L160.2 307.5 L142.2 315.0 L141.2 315.6 L123.2 323.0 L120.2 324.4 L116.2 326.0 L115.2 326.6 L109.2 328.9 L108.2 329.5 L104.2 331.1 L101.2 332.5 L97.2 334.0 L96.2 334.6 L90.2 337.0 L89.2 337.6 L83.2 340.0 L82.2 340.5 L71.2 345.0 L70.2 345.6 L54.2 352.3 Z'
  var BACK = 'M73.2 295.7 L72.2 296.1 L71.9 295.3 L72.5 286.3 L72.5 274.3 L71.5 260.3 L69.5 246.3 L67.6 236.3 L64.5 224.3 L61.5 214.3 L57.5 203.3 L52.5 191.3 L47.7 181.3 L42.6 171.3 L35.6 159.3 L28.4 148.3 L20.6 137.3 L13.5 128.3 L8.5 122.3 L1.0 114.3 L1.2 113.6 L2.2 113.8 L7.2 116.0 L8.2 116.6 L38.2 130.0 L41.2 131.5 L80.2 149.0 L83.2 150.5 L111.2 163.0 L114.2 164.5 L122.2 168.0 L125.2 169.5 L153.2 182.0 L156.2 183.5 L164.2 187.0 L167.2 188.5 L171.2 190.2 L172.2 189.8 L172.7 189.3 L172.7 188.3 L173.2 187.8 L174.2 187.8 L174.7 188.3 L174.7 189.3 L175.7 190.3 L175.7 192.3 L174.7 193.3 L174.7 194.3 L173.7 195.3 L173.7 196.3 L172.7 197.3 L172.7 198.3 L170.7 200.3 L170.7 201.3 L169.7 202.3 L169.7 203.3 L168.7 204.3 L168.7 205.3 L166.7 207.3 L166.7 208.3 L165.7 209.3 L165.7 210.3 L164.7 211.3 L164.7 212.3 L162.7 214.3 L162.7 215.3 L161.7 216.3 L161.7 217.3 L159.7 219.3 L159.7 220.3 L158.7 221.3 L158.7 222.3 L156.7 224.3 L156.7 225.3 L155.7 226.3 L155.7 227.3 L153.7 229.3 L153.7 230.3 L151.7 232.3 L151.7 233.3 L150.7 234.3 L150.7 235.3 L148.2 237.8 L147.2 237.8 L142.2 242.8 L141.2 242.8 L140.7 242.3 L141.7 241.3 L141.7 240.3 L143.7 238.3 L143.7 237.3 L145.4 235.3 L145.2 235.1 L73.2 295.7 Z'
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
      svg('<path fill="' + TEAL + '" d="' + BACK + '"/>', 'oi-wing') +
      svg('<path fill="' + WHITE + '" d="' + FRONT + '"/>', 'oi-front') +
      svg('<path pathLength="1" stroke="' + TEAL + '" d="' + BACK + '"/><path pathLength="1" stroke="' + WHITE + '" d="' + FRONT + '"/>', 'oi-line') +
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
  var now = Date.now(), at = null
  try { at = Number(sessionStorage.getItem(KEY)) || null } catch (e) { /* storage off */ }
  var reduce = false
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) { /* old webview */ }
  // A reload part-way through the intro (the over-the-air update switching in at launch) carries on
  // from the same moment; any later reload, or a return from the background, never shows it again.
  var from = at ? now - at : 0
  if (at && from >= TOTAL) { hideSplash(); return }
  if (!at) { try { sessionStorage.setItem(KEY, String(now)) } catch (e) { /* storage off */ } }
  var intro = mount(document.body || document.documentElement, TAKE, reduce)
  if (from >= intro.total) { intro.root.remove(); hideSplash(); return }
  var started = false
  window.__ohvaraIntroPlaying = true
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
  hideSplash().then(function () { requestAnimationFrame(start) })
  setTimeout(start, 700)
})()
