// P916 — the agent portal's Call through Deedstone: DeedstoneCallProvider (DeedstoneCall.jsx) puts start(target) here.
import { createContext, useContext } from 'react'
export const DeedstoneCallCtx = createContext(null)
export const useDeedstoneCall = () => useContext(DeedstoneCallCtx)
