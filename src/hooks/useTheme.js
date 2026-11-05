import { useEffect, useState } from 'react'

// Theme, shared. The header toggle (DashboardLayout) and Settings →
// Appearance both drive it, so it can't live as local state in either — one
// would go stale the moment the other flipped it.
//
// P844: the saved choice (the "pref") is 'light', 'dark' or 'system'. useTheme() still returns the theme that is
// actually showing ('light' or 'dark'), so every existing caller keeps working. Settings → Appearance uses
// useThemePref() for the saved choice and previewTheme() to try one on without saving it.

const KEY = 'ohvara-theme'
const listeners = new Set()
const prefListeners = new Set()
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
const systemTheme = () => (media && !media.matches ? 'light' : 'dark')
const resolve = pref => (pref === 'system' ? systemTheme() : pref)
const apply = theme => document.documentElement.setAttribute('data-theme', theme)

let pref = (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) || 'dark'
let current = resolve(pref)

// Prompt 669 — apply the saved theme as soon as this module loads (main.jsx
// imports it). Before, the attribute was only set when a component called
// useTheme(), and the only caller was Settings → Appearance — so a saved
// "light" choice reverted to dark on every reload until Settings was opened.
if (typeof document !== 'undefined') apply(current)

// 'System' follows the device while it is the saved choice.
if (media) {
  media.addEventListener?.('change', () => {
    if (pref !== 'system') return
    current = systemTheme()
    apply(current)
    listeners.forEach(fn => fn(current))
  })
}

export function setTheme(next) {
  pref = next
  current = resolve(next)
  apply(current)
  localStorage.setItem(KEY, next)
  listeners.forEach(fn => fn(current))
  prefListeners.forEach(fn => fn(pref))
}

// Show a choice without saving it (Settings → Appearance preview). previewTheme(savedPref) puts the saved one back.
export function previewTheme(next) {
  apply(resolve(next))
}

export function useTheme() {
  const [theme, set] = useState(current)

  useEffect(() => {
    // Re-assert on mount: index.css defaults to dark, so a stored 'light'
    // needs the attribute set before first paint of any themed page. No
    // setState here — useState already read `current` at mount.
    apply(current)
    listeners.add(set)
    return () => { listeners.delete(set) }
  }, [])

  return [theme, setTheme]
}

// The saved choice: 'light', 'dark' or 'system'.
export function useThemePref() {
  const [p, set] = useState(pref)
  useEffect(() => {
    prefListeners.add(set)
    return () => { prefListeners.delete(set) }
  }, [])
  return [p, setTheme]
}
