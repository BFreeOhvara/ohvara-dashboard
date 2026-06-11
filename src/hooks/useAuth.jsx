import { useState, useEffect, useRef, createContext, useContext } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session,        setSession]        = useState(undefined)
  const [profile,        setProfile]        = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  // Tracks which user the loaded profile belongs to, so token refreshes
  // and focus-replayed SIGNED_IN events never re-trigger the loading
  // spinner (which unmounts the whole dashboard — open modals included).
  const profileUserId = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchProfile(session.user.id, false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (!session) {
        profileUserId.current = null
        setProfile(null)
        setProfileLoading(false)
        return
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

  async function fetchProfile(userId, recordLogin = false) {
    // Only show the blocking loader on a genuine user change — silent
    // refetches must not flip `loading` (it swaps the app for a spinner).
    const isNewUser = profileUserId.current !== userId
    if (isNewUser) setProfileLoading(true)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

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

  async function signIn(username, password) {
    const email = `${username}@ohvara.internal`
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

  const loading = session === undefined || profileLoading

  return (
    <AuthContext.Provider value={{ session, profile, signIn, signOut, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
