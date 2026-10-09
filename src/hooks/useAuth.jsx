import { useState, useEffect, useRef, createContext, useContext } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

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
    // For a bare username, resolve_login_email (migration 069) returns that
    // profile's email on file, and only if there's no match does it fall
    // back to the old synthetic <username>@ohvara.internal pattern.
    const input = identifier.trim()
    let email = input
    if (!input.includes('@')) {
      const { data: resolvedEmail } = await supabase.rpc('resolve_login_email', { p_username: input })
      email = resolvedEmail || `${input}@ohvara.internal`
    }
    const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error

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
  }

  async function signOut() {
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
  const loading = session === undefined || profileLoading || (!!session && aal === undefined)

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
