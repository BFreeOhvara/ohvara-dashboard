import { useIsPhone } from '../../hooks/usePhoneLayout'
import { isNativeApp } from '../../lib/native'

// P999: the phone layout for the signed-out pages (PhoneAuth.jsx): the app always, the website under 768 px.
export function usePhoneAuth() {
  const narrow = useIsPhone()
  return isNativeApp() || narrow
}
