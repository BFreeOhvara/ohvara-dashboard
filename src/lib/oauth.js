// P999 — Sign in with Apple / Google (Supabase Auth). Kept apart from the pages so Login and Signup share it.
//
// Web: Supabase sends the browser to Apple or Google and back to /login, where supabase-js reads the session from
// the address (detectSessionInUrl) and the page's role redirect takes over.
// Phone app: the sign-in opens in the system browser sheet (Google refuses in-app web views) and comes back to the
// app on ohvara://auth#access_token=…; finishNativeOAuth() turns that into a session. Only app builds from 1.2 on
// register ohvara://auth, so older installed apps hide the buttons (the update to the pages reaches them, the
// link handler doesn't).
//
// Linking: an existing email account with the same (confirmed) email gets the Google / Apple sign-in added to it by
// Supabase. A brand-new person gets an agent account only while public sign-up is on (handle_new_user, 274).
import { supabase } from './supabase'
import { isNativeApp, webUrl, opening } from './native'
import { versionAtLeast, parseAuthReturn, oauthErrorText } from './oauthCore'

export { versionAtLeast, parseAuthReturn, oauthErrorText, needsTerms } from './oauthCore'

export const NATIVE_REDIRECT = 'ohvara://auth'
export const MIN_NATIVE_VERSION = '1.2'
// The version of the terms a person agrees to (same as self-signup's TERMS_VERSION).
export const TERMS_VERSION = '2026-10-30'

let nativeOk = null
// Can this device sign in with Apple / Google? Always on the web; in the app only from 1.2.
export async function socialAvailable() {
  if (!isNativeApp()) return true
  if (nativeOk !== null) return nativeOk
  try {
    const { App } = await import('@capacitor/app')
    const info = await App.getInfo()
    nativeOk = versionAtLeast(info?.version, MIN_NATIVE_VERSION)
  } catch { nativeOk = false }
  return nativeOk
}

// Start Apple or Google sign-in. Web: leaves the page. App: opens the browser sheet and resolves once it's open.
export async function signInWithProvider(provider, { next = '/login' } = {}) {
  if (!['apple', 'google'].includes(provider)) throw new Error('Unknown provider')
  if (!isNativeApp()) {
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: webUrl(next) } })
    if (error) throw error
    return
  }
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider, options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true },
  })
  if (error) throw error
  const { Browser } = await import('@capacitor/browser')
  opening.now = true
  try { await Browser.open({ url: data.url, presentationStyle: 'popover' }) } finally { opening.now = false }
}

// App only: ohvara://auth#… → a session. Returns { ok } | { error } | null (not our link).
export async function finishNativeOAuth(url) {
  if (!String(url || '').startsWith(NATIVE_REDIRECT)) return null
  try { const { Browser } = await import('@capacitor/browser'); await Browser.close() } catch { /* Android: nothing to close */ }
  const r = parseAuthReturn(url)
  if (!r) return { error: oauthErrorText('failed') }
  if (r.error) return { error: oauthErrorText(r.error) }
  const { error } = await supabase.auth.setSession(r)
  return error ? { error: oauthErrorText(error.message) } : { ok: true }
}

// A refused app sign-in: kept for /login to show (it may not be mounted yet) and announced to it if it is.
export const OAUTH_ERROR_EVENT = 'ohvara-oauth-error'
const HELD = 'ohvara-oauth-error'
export function takeOauthError() {
  try { const v = sessionStorage.getItem(HELD); sessionStorage.removeItem(HELD); return v || '' } catch { return '' }
}
function holdOauthError(text) {
  try { sessionStorage.setItem(HELD, text) } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent(OAUTH_ERROR_EVENT, { detail: text }))
  try { sessionStorage.removeItem(HELD) } catch { /* fine */ }
}

// App only: listen for the return from the browser sheet (also on a cold start).
let listening = false
export async function listenNativeOAuth(onError = holdOauthError) {
  if (!isNativeApp() || listening) return
  listening = true
  try {
    const { App } = await import('@capacitor/app')
    const take = async url => { const r = await finishNativeOAuth(url); if (r?.error) onError?.(r.error) }
    App.addListener('appUrlOpen', e => { take(e?.url) })
    const launch = await App.getLaunchUrl?.()
    if (launch?.url) take(launch.url)
  } catch { listening = false }
}

// Create account's Apple / Google buttons only start once the terms box is ticked; the account that comes back
// then accepts them by itself (Login) instead of asking again.
const AGREED = 'ohvara-terms-agreed'
export function markTermsAgreed() { try { localStorage.setItem(AGREED, String(Date.now())) } catch { /* blocked */ } }
export function termsAgreedHere() {
  try { const t = Number(localStorage.getItem(AGREED)); return !!t && Date.now() - t < 60 * 60e3 } catch { return false }
}
export function forgetTermsAgreed() { try { localStorage.removeItem(AGREED) } catch { /* blocked */ } }

export async function acceptTerms() {
  const { error } = await supabase.rpc('accept_signup_terms', { p_version: TERMS_VERSION })
  if (error) throw error
  forgetTermsAgreed()
}
