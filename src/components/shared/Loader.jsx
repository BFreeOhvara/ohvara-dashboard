import { useEffect, useLayoutEffect, useState } from 'react'
import { acquire, release, isPhone, hold, SLOW_MS } from '../../lib/loader'

// P1020 — the one loading screen (Brayden's approved mockups, obsidian-mind/media/loader/). Desktop: the portal's soft
// blue-to-beige background, the logo in its real colours (big piece navy, wing teal), the wing lifting and settling on a
// 1.6 s loop, a slim teal line sliding underneath, a soft "Loading". Phone (the app, or under 768 px) and a dark desktop:
// a dark background, big piece teal, wing white, no word on the phone. The look lives in index.html (<style id="ol-css">)
// so the very first paint, before this bundle, can show it too (#ol-boot).
//
// One overlay, many owners. It only shows once loading has taken 300 ms, so fast pages never flash it, and fades out
// when ready. A loader that mounts right as another unmounts (sign-in check -> shell code -> page data) takes over the
// same overlay, so a chain of loads reads as one, and the 300 ms counts from the first.
//
// P1026: it always covers the whole window, never a box inside the page. `hold` also hides the app behind it
// (html.ol-hold) so the header and menus never show with an empty body: the whole page comes up at once.
export function Loader({ hold: covers = false }) {
  useLayoutEffect(() => {
    const h = acquire()
    h.el.classList.toggle('ol-phone', isPhone())
    if (covers) hold(true)
    return () => {
      if (covers) hold(false)
      release(h)
    }
  }, [covers])
  return null
}

// P1026: a page that is slow after the portal has opened. The page on screen stays; only a slim teal line runs along
// the very top of the window (after 300 ms, so quick pages show nothing). Past SLOW_MS it becomes the full-screen loader.
export function PageWait() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_MS)
    return () => clearTimeout(t)
  }, [])
  if (slow) return <Loader hold />
  return <div className="ol-top" role="progressbar" aria-label="Loading"><i /></div>
}
