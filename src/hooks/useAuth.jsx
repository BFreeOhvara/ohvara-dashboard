import { useState, useEffect, createContext, useContext } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session,        setSession]        = useState(undefined)
  const [profile,        setProfile]        = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchProfile(session.user.id, false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (session) fetchProfile(session.user.id, event === 'SIGNED_IN')
      else { setProfile(null); setProfileLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId, recordLogin = false) {
    setProfileLoading(true)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) {
        console.error('[useAuth] profiles query failed:', error.code, error.message)
        setProfile(null)
      } else if (!data) {
        console.error('[useAuth] no profile row for user id:', userId)
        setProfile(null)
      } else {
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
