import { useCallback, useRef } from 'react'

// P779 — a mutation's mutate that ignores a second call while the first is
// still out. `disabled={m.isPending}` alone lets a fast double-tap through:
// isPending reaches the button a render later, after the second tap landed,
// so the server got every save, send and result twice.
export function useOneAtATime(mutation) {
  const busy = useRef(false)
  const { mutate } = mutation
  return useCallback((vars, opts = {}) => {
    if (busy.current) return
    busy.current = true
    mutate(vars, { ...opts, onSettled: (...a) => { busy.current = false; opts.onSettled?.(...a) } })
  }, [mutate])
}
