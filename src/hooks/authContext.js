// P929: the auth context on its own (no Supabase import), so sample-only code (src/template) can read the signed-in
// profile without loading the client. useAuth.jsx provides it.
import { createContext, useContext } from 'react'

export const AuthContext = createContext(null)
export const useOptionalAuth = () => useContext(AuthContext)
