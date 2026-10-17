import { createContext, useContext, useEffect, useState } from 'react'

// Prompt 772 — the agent's phone layout. Under 768px an agent gets the
// app-style shell (PhoneShell) and each agent page renders its phone screen.
// Pages ask usePhoneLayout(), which is only true inside that shell, so admins
// on the same routes and every desktop/tablet width keep the desktop page.

const QUERY = '(max-width: 767.98px)'

export function useIsPhone() {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const on = () => setMatch(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return match
}

export const PhoneLayoutContext = createContext(false)

export const usePhoneLayout = () => useContext(PhoneLayoutContext)
