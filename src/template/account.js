import { createContext } from 'react'

// Sign out and delete for the screens. AgentShell fills it in; /template renders above AuthProvider, so it reads null there.
export const ShellAccount = createContext(null)
