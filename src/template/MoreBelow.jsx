import { useEffect, useLayoutEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { applyFold, blocksIn, continuesBelow, docTop, foldLine } from './fold'
import { still } from './motion'
import './morebelow.css'

// P867 — every page that scrolls shows that it does. Mounted once in each frame (agent TemplateFrame, VA FulFrame,
// admin AdminFrame), keyed by the page:
//   1. lays out the page's first screen to the window (fold.js applyFold: the next section peeks about a third), and
//   2. on first load, when a card continues below, a soft fade along the bottom and a small "More below" pill.
//      It goes away after the first scroll; clicking it scrolls to the next section. Reduced motion: no glide, no bob.
// Pages that fit get neither.
const mainEl = () => document.querySelector('.fx-main, .tp-main')

export default function MoreBelow({ page }) {
  const [show, setShow] = useState(null) // { page, on }: a fresh page starts hidden

  // The layout pass: on each page, again once the entrance has settled, on resize and when the page's size changes.
  useLayoutEffect(() => {
    let raf = 0
    const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => applyFold(mainEl())) }
    applyFold(mainEl())
    const t = [setTimeout(run, 120), setTimeout(run, 900)]
    const main = mainEl()
    const ro = typeof ResizeObserver !== 'undefined' && main ? new ResizeObserver(run) : null
    if (ro) for (const c of main.children) ro.observe(c)
    window.addEventListener('resize', run)
    return () => { cancelAnimationFrame(raf); t.forEach(clearTimeout); ro?.disconnect(); window.removeEventListener('resize', run) }
  }, [page])

  // The cue: only at the top of a fresh page, only when there is more, gone for good after the first scroll.
  useEffect(() => {
    let gone = false
    const check = () => { if (!gone) setShow({ page, on: window.scrollY < 8 && continuesBelow(mainEl() || document.body) }) }
    const t = setTimeout(check, 700)
    const onScroll = () => { if (window.scrollY > 16) { gone = true; setShow({ page, on: false }) } }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', check)
    return () => { clearTimeout(t); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', check) }
  }, [page])

  if (!show || show.page !== page || !show.on) return null
  const go = () => {
    const main = mainEl()
    const fold = foldLine()
    // The first section the fold cuts or hides; bring its top up under the top bar.
    const target = main && blocksIn(main).map(b => [b, docTop(b)]).filter(([b, y]) => y + b.offsetHeight > fold + 8).sort((a, b) => a[1] - b[1])[0]
    const bar = document.querySelector('.fx-top, .fx-ptop')
    const barH = bar && getComputedStyle(bar).position === 'sticky' ? bar.offsetHeight : 0
    const y = target ? Math.max(0, target[1] - barH - 16) : Math.round(window.innerHeight * 0.75)
    window.scrollTo({ top: y, behavior: still() ? 'auto' : 'smooth' })
  }
  return (
    <div className="tp fx-morecue" aria-hidden="false">
      <i className="fx-morecue-fade" aria-hidden="true" />
      <button type="button" className="fx-morecue-pill" onClick={go}>More below<ChevronDown size={15} aria-hidden="true" /></button>
    </div>
  )
}
