import { createContext, useContext } from 'react'

// Prompt 751 — the pop-up phone's context (provider: PortalPhoneContext.jsx).
//   voiceLive  calling in the portal is switched on
//   open(p)    open the phone for a cancellation (starts the call when live,
//              a preview when not); brings back a call that's already up
//   activeId   the policy on the phone right now, if any
//   toast(msg) a one-off message top-right (P756: "It's not time to call yet")
//   tz         the signed-in profile's zone
export const PhoneContext = createContext({ voiceLive: false, open: () => false, activeId: null, toast: () => {}, tz: null })

export const usePortalPhone = () => useContext(PhoneContext)
