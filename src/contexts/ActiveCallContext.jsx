import { createContext, useContext, useEffect, useState } from 'react'
import { holdSignOut } from '../lib/sessionLimits'

const ActiveCallContext = createContext({ isInCall: false, setIsInCall: () => {} })

export function ActiveCallProvider({ children }) {
  const [isInCall, setIsInCall] = useState(false)
  // P970: a live call is never cut off by the web portal's auto sign-out.
  useEffect(() => (isInCall ? holdSignOut('call') : undefined), [isInCall])
  return (
    <ActiveCallContext.Provider value={{ isInCall, setIsInCall }}>
      {children}
    </ActiveCallContext.Provider>
  )
}

export function useActiveCall() {
  return useContext(ActiveCallContext)
}
