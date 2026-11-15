import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

// P1015 — a sideways-scrolling row says "there's more" with a soft fade on the side that has more. Returns the class to
// put on the row (has-left / has-right, styled in p1015.css) and the onScroll to wire to it. Phone screens only.
export function useEdgeFade(ref, deps = []) {
  const [edge, setEdge] = useState({ l: false, r: false })
  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const l = el.scrollLeft > 2
    const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setEdge(e => (e.l === l && e.r === r ? e : { l, r }))
  }, [ref])
  useLayoutEffect(measure, [measure, ...deps])
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure) }
  }, [ref, measure])
  return { fade: `${edge.l ? ' has-left' : ''}${edge.r ? ' has-right' : ''}`, onScroll: measure }
}
