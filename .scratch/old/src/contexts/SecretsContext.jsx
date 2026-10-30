import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const defaultCaps = {
  has_anthropic: false,
  has_retell: false,
  has_twilio: false,
  has_stripe: false,
  has_google_maps: false,
  has_indeed: false,
}

const SecretsContext = createContext({
  capabilities: defaultCaps,
  secrets: [],        // admin only: list of configured secret names + metadata
  loading: true,
  refresh: () => {},
})

export function SecretsProvider({ children }) {
  const { profile } = useAuth()
  const [capabilities, setCapabilities] = useState(defaultCaps)
  const [secrets, setSecrets] = useState([])
  const [loading, setLoading] = useState(true)

  async function fetchCapabilities() {
    if (!profile) { setLoading(false); return }
    try {
      // invoke() defaults to POST — capabilities live on the GET branch
      // (POST is the admin-only secret-write path and 403s for reps)
      const { data, error } = await supabase.functions.invoke('fetch-secrets', { method: 'GET' })
      if (!error && data) {
        setCapabilities(data.capabilities || defaultCaps)
        setSecrets(data.secrets || [])
      }
    } catch {
      // fetch-secrets not yet deployed or no network — use env-based defaults
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (profile) fetchCapabilities()
    else { setLoading(false) }
  }, [profile?.id])

  return (
    <SecretsContext.Provider value={{ capabilities, secrets, loading, refresh: fetchCapabilities }}>
      {children}
    </SecretsContext.Provider>
  )
}

export function useSecrets() {
  return useContext(SecretsContext)
}

// Convenience hook: returns a specific capability boolean
export function useCapability(key) {
  const { capabilities } = useContext(SecretsContext)
  return capabilities[key] ?? false
}
