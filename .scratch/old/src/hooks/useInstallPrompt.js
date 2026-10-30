import { useSyncExternalStore } from 'react'
import { getDeferredPrompt, subscribeInstallPrompt } from '../lib/installPrompt'

// Non-null only on Android/Chrome-family browsers that fired
// beforeinstallprompt and haven't already been installed/dismissed. Always
// null on iOS Safari — there's no equivalent API there.
export function useInstallPrompt() {
  return useSyncExternalStore(subscribeInstallPrompt, getDeferredPrompt)
}
