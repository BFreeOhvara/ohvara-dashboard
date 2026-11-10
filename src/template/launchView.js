import { launchChecks, signupOf } from '../adminshell/setup.js'
import { useSampleLaunch } from './data'

// P941 — the agent's launch checks in the Setup ticket's words (who: 'agent'), for SetupProgress. live = their
// campaign is on and every step still passes. null until there's anything to show (real: before migration 264).
export function useLaunchView() {
  const { data } = useSampleLaunch()
  if (!data) return null
  const checks = launchChecks(data, { who: 'agent' })
  return { data, checks, live: data.launchState === 'on' && checks.ok, signup: signupOf(data) }
}
