import { useEffect, useRef, useState } from 'react'

/**
 * Animates a number from 0 to `target` over `duration` ms.
 * Uses easeOutCubic for a snappy, premium feel.
 */
export function useCountUp(target, duration = 800) {
  const [value, setValue] = useState(0)
  const startTime = useRef(null)
  const frameRef  = useRef(null)
  const prevTarget = useRef(null)

  useEffect(() => {
    // Reset on target change
    if (prevTarget.current !== target) {
      startTime.current = null
      prevTarget.current = target
    }

    const animate = (timestamp) => {
      if (!startTime.current) startTime.current = timestamp
      const progress = Math.min((timestamp - startTime.current) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // easeOutCubic
      setValue(Math.round(target * eased))
      if (progress < 1) frameRef.current = requestAnimationFrame(animate)
    }

    frameRef.current = requestAnimationFrame(animate)
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current) }
  }, [target, duration])

  return value
}
