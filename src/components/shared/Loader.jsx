import { useLayoutEffect, useRef } from 'react'
import { acquire, release, isPhone, regionOf, place } from '../../lib/loader'

// P1020 — the one loading screen (Brayden's approved mockups, obsidian-mind/media/loader/). Desktop: the portal's soft
// blue-to-beige background, the logo in its real colours (big piece navy, wing teal), the wing lifting and settling on a
// 1.6 s loop, a slim teal line sliding underneath, a soft "Loading". Phone (the app, or under 768 px) and a dark desktop:
// a dark background, big piece teal, wing white, no word on the phone. The look lives in index.html (<style id="ol-css">)
// so the very first paint, before this bundle, can show it too (#ol-boot).
//
// One overlay, many owners. It only shows once loading has taken 300 ms, so fast pages never flash it, and fades out
// when ready. A loader that mounts right as another unmounts (sign-in check -> shell code -> page data) takes over the
// same overlay, so a chain of loads reads as one, and the 300 ms counts from the first. <Loader /> covers the screen;
// <Loader area /> covers only the page area (from the top of the page column down), never the top bar or menus.

export function Loader({ area = false }) {
  const slot = useRef(null)
  useLayoutEffect(() => {
    const h = acquire()
    h.el.classList.toggle('ol-phone', isPhone())
    h.el.classList.toggle('ol-area', area)
    const region = area ? regionOf(slot.current) : null
    const fit = () => place(h.el, region)
    fit()
    const ro = region && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
    ro?.observe(region)
    window.addEventListener('resize', fit)
    if (region) window.addEventListener('scroll', fit, true)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', fit)
      window.removeEventListener('scroll', fit, true)
      release(h)
    }
  }, [area])
  // In the page, the slot keeps the page area its height while the overlay sits on top of it.
  return <span ref={slot} className={area ? 'ol-slot' : undefined} hidden={!area} aria-hidden="true" />
}
