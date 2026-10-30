import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { isNativeApp } from './native'

// Is public sign-up open? Asks self-signup's `status` action. Fails closed:
// an error, a timeout or any answer other than open === true means closed. The
// phone app never asks (and never shows sign-up): it is always closed there.
// The server still enforces the switch; this only decides what the page shows.

const TTL_MS = 60_000
let cached = null // { at, promise } — one in-flight ask is shared by Login and /signup

async function ask() {
  try {
    const { data, error } = await supabase.functions.invoke('self-signup', { body: { action: 'status' } })
    return !error && data?.open === true
  } catch {
    return false
  }
}

export function fetchSignupOpen() {
  if (!cached || Date.now() - cached.at >= TTL_MS) cached = { at: Date.now(), promise: ask() }
  return cached.promise
}

// null = still asking, true = open, false = closed / unknown / phone app.
export function useSignupOpen() {
  const native = isNativeApp()
  const [open, setOpen] = useState(native ? false : null)
  useEffect(() => {
    if (native) return
    let cancelled = false
    fetchSignupOpen().then(v => { if (!cancelled) setOpen(v) })
    return () => { cancelled = true }
  }, [native])
  return open
}
