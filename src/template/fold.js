// P867 — making it obvious a page scrolls. Shared by the three frames' MoreBelow (agent TemplateFrame, VA FulFrame,
// admin AdminFrame) and mirrored by scripts/scroll-cue-check.mjs (same "block" and "fold" rules).
//   A block = an outermost card inside the page (a tile, card or panel with its own fill or edge, at least 60x140).
//   The fold = the bottom of the window, or the top of the phone tab bar when one is pinned there.
// No React here: plain DOM, so the rule reads the same in the app and in the check.

const SKIP = 'script, style, .tp-foot, .fx-morecue'

// Layout position, ignoring transforms (pages ease in with a translate, which would skew getBoundingClientRect).
export function docTop(el) {
  let y = 0
  for (let n = el; n; n = n.offsetParent) y += n.offsetTop
  return y
}

export function isCard(el) {
  const cs = getComputedStyle(el)
  if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') return false
  if (el.offsetHeight < 60 || el.offsetWidth < 140) return false
  const bg = cs.backgroundColor
  const hasBg = bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)
  const hasEdge = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && parseFloat(cs.borderRadius) > 0
  return hasBg || hasEdge || (cs.backdropFilter && cs.backdropFilter !== 'none')
}

// Outermost cards; a card taller than the window that holds cards of its own counts as those cards.
export function blocksIn(main) {
  const out = []
  const H = window.innerHeight
  const visit = el => {
    for (const c of el.children) {
      if (c.matches(SKIP)) continue
      if (isCard(c)) {
        if (c.offsetHeight > H * 0.9 && [...c.querySelectorAll('*')].some(isCard)) visit(c)
        else out.push(c)
      } else visit(c)
    }
  }
  visit(main)
  return out
}

export function foldLine() {
  const bar = [...document.querySelectorAll('.fx-bar, .tp-bar')].find(b => {
    const cs = getComputedStyle(b)
    return cs.display !== 'none' && cs.position === 'fixed' && b.offsetHeight > 0
  })
  return bar ? Math.round(bar.getBoundingClientRect().top) : window.innerHeight
}

// Does a card continue below the fold (at the top of the page)? A page whose only overflow is the small
// "Sample info" footer line counts as fitting.
export function continuesBelow(main) {
  const fold = foldLine()
  return blocksIn(main).some(b => docTop(b) + b.offsetHeight > fold + 8)
}

const nextBlockAfter = el => {
  for (let n = el; n; n = n.parentElement) {
    let s = n.nextElementSibling
    while (s && (s.matches(SKIP) || getComputedStyle(s).display === 'none')) s = s.nextElementSibling
    if (s) return s
    if (n.matches('.fx-main, .tp-main')) return null
  }
  return null
}

// The page's first screen ([data-fold], opt-in per page) grows to fill the window, so the section after it starts
// a third of its height above the fold, heading included, at any window height. It only ever adds height (never
// shrinks content), only on pages that scroll anyway, and only from 1000px wide unless the page sets data-fold-phone.
// data-fold-next="<selector>" names the section to peek when it is not the next sibling.
// data-fold-peek (P914, admin Overview): peek that section even when it would just fit above the fold, as long as
// the page goes on below it, so the window never ends on a clean edge that hides the rest.
// A small section heading just above a card (outside it, not itself holding a card) belongs to the card: its top.
export function headAbove(el) {
  const top = docTop(el)
  let p = el
  for (let d = 0; d < 4 && p; d++) {
    let s = p.previousElementSibling
    while (s && getComputedStyle(s).display === 'none') s = s.previousElementSibling
    if (s) {
      const h = s.offsetHeight
      const sb = docTop(s) + h
      if (h > 0 && h < 80 && top - sb < 40 && top - sb > -2 && !isCard(s) && ![...s.querySelectorAll('*')].some(isCard)) return s
      return null
    }
    p = p.parentElement
    if (!p || p.matches('.fx-main, .tp-main')) return null
  }
  return null
}

export function applyFold(main) {
  const el = main?.querySelector('[data-fold]')
  if (!el) return
  el.style.removeProperty('--fold-min')
  el.style.removeProperty('--fold-h')
  // data-fold-fit="<min px>": the region is sized to the window both ways (it grows or shrinks to the fold), for
  // a block with no natural height of its own, like a week calendar (P867 admin Fulfillment).
  const fit = el.hasAttribute('data-fold-fit')
  if (window.innerWidth < 1000 && !el.hasAttribute('data-fold-phone')) return
  const fold = foldLine()
  const top = docTop(el)
  const bottom = top + el.offsetHeight
  // The section to peek: data-fold-next, else the first card below the region that the fold cuts or hides.
  const next = el.dataset.foldNext ? main.querySelector(el.dataset.foldNext)
    : fit ? nextBlockAfter(el)
    : blocksIn(main).filter(b => docTop(b) >= bottom - 2 && docTop(b) + b.offsetHeight > fold + 8).sort((a, b) => docTop(a) - docTop(b))[0]
  if (!next || next.offsetHeight < 60) {
    // Nothing after a fitted block: it fills the window down to the fold.
    if (fit) el.style.setProperty('--fold-h', `${Math.max(Number(el.dataset.foldFit) || 0, Math.round(fold - top - 16))}px`)
    return
  }
  const ha = fit ? null : headAbove(next)
  const nextTop = ha ? docTop(ha) : docTop(next)
  const nextH = docTop(next) + next.offsetHeight - nextTop
  const goesOn = el.hasAttribute('data-fold-peek') && blocksIn(main).some(b => docTop(b) >= nextTop + nextH - 2)
  if (!fit && !goesOn && nextTop + nextH <= fold + 8) return // it all fits: leave the page as it is
  const gap = Math.max(0, nextTop - bottom)
  const head = ha || next.querySelector('h2, h3, .fx-tile-h, .fx-sec-h, .adm-sec-h, header')
  const headShare = head ? (docTop(head) - nextTop + head.offsetHeight + 18) / nextH : 0
  const share = Math.min(0.55, Math.max(0.32, headShare))
  const want = Math.round(fold - share * nextH - gap - top)
  if (fit) el.style.setProperty('--fold-h', `${Math.max(Number(el.dataset.foldFit) || 0, want)}px`)
  else if (want > el.offsetHeight + 2) el.style.setProperty('--fold-min', `${want}px`)
}
