import { useState, useEffect, createContext, useContext } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session,        setSession]        = useState(undefined) // undefined = initial check in flight
  const [profile,        setProfile]        = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchProfile(session.user.id)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) fetchProfile(session.user.id)
      else { setProfile(null); setProfileLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    setProfileLoading(true)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) {
        console.error('[useAuth] profiles query failed:', error.code, error.message, error.details)
        setProfile(null)
      } else if (!data) {
        console.error('[useAuth] no profile row for user id:', userId)
        setProfile(null)
      } else {
        console.log('[useAuth] profile loaded:', data.email, '| role:', data.role)
        setProfile(data)
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
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  // loading is true until: initial session check AND subsequent profile fetch both complete
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
