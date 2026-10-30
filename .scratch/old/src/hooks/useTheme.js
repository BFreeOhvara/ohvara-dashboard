import { useEffect, useState } from 'react'

// Theme, shared. The header toggle (DashboardLayout) and Settings →
// Appearance both drive it, so it can't live as local state in either — one
// would go stale the moment the other flipped it.

const KEY = 'ohvara-theme'
const listeners = new Set()

let current = (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) || 'dark'

// Prompt 669 — apply the saved theme as soon as this module loads (main.jsx
// imports it). Before, the attribute was only set when a component called
// useTheme(), and the only caller was Settings → Appearance — so a saved
// "light" choice reverted to dark on every reload until Settings was opened.
if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', current)

export function setTheme(theme) {
  current = theme
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem(KEY, theme)
  listeners.forEach(fn => fn(theme))
}

export function useTheme() {
  const [theme, set] = useState(current)

  useEffect(() => {
    // Re-assert on mount: index.css defaults to dark, so a stored 'light'
    // needs the attribute set before first paint of any themed page. No
    // setState here — useState already read `current` at mount.
    document.documentElement.setAttribute('data-theme', current)
    listeners.add(set)
    return () => { listeners.delete(set) }
  }, [])

  return [theme, setTheme]
}
