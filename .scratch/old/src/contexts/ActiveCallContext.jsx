import { createContext, useContext, useState } from 'react'

const ActiveCallContext = createContext({ isInCall: false, setIsInCall: () => {} })

export function ActiveCallProvider({ children }) {
  const [isInCall, setIsInCall] = useState(false)
  return (
    <ActiveCallContext.Provider value={{ isInCall, setIsInCall }}>
      {children}
    </ActiveCallContext.Provider>
  )
}

export function useActiveCall() {
  return useContext(ActiveCallContext)
}
