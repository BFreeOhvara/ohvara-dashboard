import { useState, useEffect, useRef, useContext } from 'react'
import { AuthContext } from './authContext'
import { supabase } from '../lib/supabase'
import { stopPush } from '../lib/push'
import { isNativeApp } from '../lib/native'
import {
  SESSION_LIMITS, LIMIT_KEYS, ACTIVITY_EVENTS, limitsApply, limitBroken, mustWait, ensureStamps, markLogin,
  noteActivity, clearStamps, safeReturnPath,
} from '../lib/sessionLimits'

// P970 — the stamps live in localStorage (shared by every tab); blocked storage means no limits, never a lockout.
function stampStore() { try { return window.localStorage } catch { return null } }


export function AuthProvider({ children }) {
  const [session,        setSession]        = useState(undefined)
  const [profile,        setProfile]        = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  // Prompt 720 — two-step verification. `aal` is the session's assurance
  // level ({ current, next }); undefined until the first read for a session,
  // so `loading` holds and no page flashes before the code step.
  const [aal,            setAal]            = useState(undefined)
  // Tracks which user the loaded profile belongs to, so token refreshes
  // and focus-replayed SIGNED_IN events never re-trigger the loading
  // spinner (which unmounts the whole dashboard — open modals included).
  const profileUserId = useRef(null)
  // P970 — the user whose 8 h / 7 day limits were checked on load. `loading` holds until then, so an agent past a
  // limit goes to the login page without the portal flashing first.
  const [limitsUid, setLimitsUid] = useState(null)
  const expiring = useRef(false)
  const latest = useRef({ session: null, profile: null })
  latest.current = { session, profile }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      readAal(session)
      if (session) fetchProfile(session.user.id, false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (!session) {
        profileUserId.current = null
        setProfile(null)
        setProfileLoading(false)
        setAal(null)
        return
      }
      // Re-read the assurance level on a new sign-in, a verified code and
      // every refresh (enrolling or removing a factor refreshes the session).
      // Deferred: supabase-js warns against awaiting auth calls inside this
      // callback, since it holds the auth lock while it runs.
      // A different user starts unread (holds `loading`); a replayed SIGNED_IN
      // for the same user must not, or the dashboard would unmount on focus.
      if (profileUserId.current !== session.user.id) setAal(undefined)
      if (['SIGNED_IN', 'MFA_CHALLENGE_VERIFIED', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event) || profileUserId.current !== session.user.id) {
        setTimeout(() => readAal(session), 0)
      }
      // Supabase fires TOKEN_REFRESHED (and replays SIGNED_IN) when the
      // tab regains visibility. Same user + profile already loaded →
      // update the session silently and touch nothing else.
      if (profileUserId.current === session.user.id) return
      fetchProfile(session.user.id, event === 'SIGNED_IN')
    })

    // Page visibility: supabase-js pauses token auto-refresh while the
    // tab is hidden and resumes on return. Resuming explicitly here makes
    // the refresh happen in the background the moment the rep tabs back,
    // instead of stalling the first query they trigger.
    function onVisibility() {
      if (document.visibilityState === 'visible') {
        supabase.auth.startAutoRefresh()
      } else {
        supabase.auth.stopAutoRefresh()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // P970 — sign an agent out of the WEB portal after 8 h idle or 7 days since login. Admin, VAs and the phone app
  // never. Returns true when it signed them out (or is about to).
  function checkLimits() {
    const { session: ses, profile: prof } = latest.current
    const store = stampStore()
    if (!store || !ses?.user?.id || !prof) return false
    const native = isNativeApp()
    if (!limitsApply({ role: prof.role, native })) return false
    const now = Date.now()
    const { lastActive, loginAt } = ensureStamps(store, ses.user.id, now)
    const reason = limitBroken({ role: prof.role, native, now, lastActive, loginAt })
    if (!reason) return false
    if (mustWait({ reason, now, lastActive, doc: document })) return false
    expireSession(reason)
    return true
  }

  async function expireSession(reason) {
    if (expiring.current) return
    expiring.current = true
    const back = safeReturnPath(window.location.pathname + window.location.search + window.location.hash)
    try {
      sessionStorage.setItem(LIMIT_KEYS.note, reason)
      if (back) sessionStorage.setItem(LIMIT_KEYS.back, back)
    } catch { /* storage blocked */ }
    const store = stampStore()
    if (store) clearStamps(store)
    try { await signOut() } catch (err) { console.error('[useAuth] limit sign-out failed:', err) }
    // A full load drops every cached page of data along with the session.
    window.location.replace('/login')
  }

  // On load (once the profile is in) and whenever the user changes.
  const uid = session?.user?.id || null
  const role = profile?.role || null
  const signedOut = session === null
  useEffect(() => {
    if (!uid) {
      if (signedOut) { const st = stampStore(); if (st) clearStamps(st) }
      return
    }
    if (!profile) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the check reads the clock and storage, so it can only run here
    if (!checkLimits()) setLimitsUid(uid)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, role, signedOut])

  // A tab left open: activity stamps, a timer, and a look when the tab comes back.
  const watching = !!uid && limitsUid === uid && limitsApply({ role, native: isNativeApp() })
  useEffect(() => {
    if (!watching) return undefined
    const store = stampStore()
    let handled = 0
    function onActivity() {
      const now = Date.now()
      if (now - handled < 1000) return
      handled = now
      // Look first: the first touch after a long absence must not reset the clock.
      if (checkLimits()) return
      if (store) noteActivity(store, now)
    }
    const onBack = () => { if (document.visibilityState === 'visible') checkLimits() }
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { passive: true, capture: true })
    document.addEventListener('visibilitychange', onBack)
    window.addEventListener('focus', onBack)
    const timer = setInterval(() => checkLimits(), SESSION_LIMITS.checkEveryMs)
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity, { capture: true })
      document.removeEventListener('visibilitychange', onBack)
      window.removeEventListener('focus', onBack)
      clearInterval(timer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching])

  async function readAal(session) {
    if (!session) { setAal(null); return }
    try {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (error) throw error
      setAal({ current: data.currentLevel, next: data.nextLevel })
    } catch (err) {
      // Fail open to "no code needed": the portal still loads, and anything
      // a verified factor protects server-side would reject the request anyway.
      console.error('[useAuth] assurance level read failed:', err)
      setAal({ current: null, next: null })
    }
  }

  async function fetchProfile(userId, recordLogin = false) {
    // Only show the blocking loader on a genuine user change — silent
    // refetches must not flip `loading` (it swaps the app for a spinner).
    const isNewUser = profileUserId.current !== userId
    if (isNewUser) setProfileLoading(true)
    try {
      // Own full row via a definer RPC — authenticated only has SELECT on
      // profiles' directory columns since migration 112. get_my_profile()
      // is keyed on auth.uid(), so userId is only used to track changes.
      const { data, error } = await supabase
        .rpc('get_my_profile')
        .maybeSingle()

      if (error) {
        console.error('[useAuth] profiles query failed:', error.code, error.message)
        profileUserId.current = null
        setProfile(null)
      } else if (!data) {
        console.error('[useAuth] no profile row for user id:', userId)
        profileUserId.current = null
        setProfile(null)
      } else {
        profileUserId.current = userId
        setProfile(data)
        // Record last login time on actual SIGNED_IN events (fire and forget)
        if (recordLogin) {
          supabase
            .from('profiles')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', userId)
            .then(() => {})
        }
      }
    } catch (err) {
      console.error('[useAuth] fetchProfile threw:', err)
      profileUserId.current = null
      setProfile(null)
    } finally {
      setProfileLoading(false)
    }
  }

  async function signIn(identifier, password) {
    // Sign-in is by email (Prompt 720). An @ in the input means "use as-is".
    // Usernames survive only for the three legacy accounts that already have
    // one (testagent11, brayden11, testfulfill11); no screen mentions them.
    // Prompt 768 — a bare username signs in on the server (username-sign-in):
    // it looks the email up and checks the password there, and only a
    // session comes back. The browser never learns the email, so a username
    // can't be used to find one (resolve_login_email is closed to the browser).
    const input = identifier.trim()
    let authData
    if (input.includes('@')) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: input, password })
      if (error) throw error
      authData = data
    } else {
      const { data: tokens, error: fnErr } = await supabase.functions.invoke('username-sign-in', {
        body: { username: input, password },
      })
      if (fnErr || !tokens?.access_token) throw new Error('Invalid login credentials')
      const { data, error } = await supabase.auth.setSession(tokens)
      if (error) throw error
      authData = data
    }

    // Check if account is deactivated before allowing the session through
    const { data: profileData } = await supabase
      .from('profiles')
      .select('is_active')
      .eq('id', authData.user.id)
      .single()

    if (profileData?.is_active === false) {
      await supabase.auth.signOut()
      throw new Error('Your account has been deactivated. Contact your administrator.')
    }
    // P970 — a real login starts the 7-day clock (and the idle one).
    const st = stampStore()
    if (st) markLogin(st, authData.user.id, Date.now())
  }

  async function signOut() {
    // Prompt 775 — this phone stops getting this user's alerts.
    await stopPush()
    const st = stampStore()
    if (st) clearStamps(st)
    await supabase.auth.signOut()
  }

  // Re-fetch the current user's own profile row without the blocking loader
  // that a user-change would trigger — Settings (Prompt 226) calls this
  // after a self-service save so profile fields update in place instead of
  // requiring a full page reload (the pattern MyCommissions/RevenueTracker
  // use for the Stripe onboarding flag).
  async function refreshProfile() {
    if (!session?.user?.id) return
    await fetchProfile(session.user.id, false)
  }

  // Supabase's own session refresh after enrolling / removing a factor, so
  // the next assurance-level read sees the new state.
  async function refreshSession() {
    const { data } = await supabase.auth.refreshSession()
    await readAal(data?.session ?? session)
  }

  // A verified factor exists but this session hasn't passed the code step.
  const mfaRequired = !!session && aal?.next === 'aal2' && aal?.current !== 'aal2'
  const loading = session === undefined || profileLoading || (!!session && aal === undefined) || (!!session && !!profile && limitsUid !== session.user.id)

  return (
    <AuthContext.Provider value={{ session, profile, signIn, signOut, loading, refreshProfile, refreshSession, mfaRequired }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

// P929: for small shared pieces (the sample line, SampleTag) that also render outside the provider (previews, tests).
export { useOptionalAuth } from './authContext'
