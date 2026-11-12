import { useSampleSettings, useSampleActions } from './data'
import { useNote } from './kit'
import { asPick } from './licenceModel'
import { clockNow } from './leadLifecycle'
import { stateDiff, diffWords, dayWords, makeChange, addStateChange, useStateChanges } from './adStates'

// P949 — the hooks behind Your states (YourStates.jsx, Billing) and Settings › Licence: one save path for both.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const stampNow = () => { const w = clockNow(); const h = Number(w.slice(11, 13)); return `${MON[Number(w.slice(5, 7)) - 1]} ${Number(w.slice(8, 10))}, ${h % 12 || 12}:${w.slice(14, 16)} ${h < 12 ? 'AM' : 'PM'}` }
export const todayIso = () => clockNow().slice(0, 10)
export const AGENT = { id: 'ag-dana' } // sample: the agent shell's account on the admin side

export const statesText = states => (states.length ? states.join(', ') : 'None picked yet')

// Save a new set of states: the licence (with its tick), one history row and the admin's to-do.
export function useSaveStates() {
  const { data: s } = useSampleSettings()
  const { saveLicence } = useSampleActions()
  const note = useNote()
  return (to, ticked) => {
    const from = asPick(s.licence).states
    const { added } = stateDiff(from, to)
    const at = stampNow()
    // The tick covers every state now picked: the old ones were ticked before, the new ones just now.
    saveLicence({ ...(s.licence || {}), states: [...to], licensed: { at: added.length && ticked ? at : (s.licence?.licensed?.at || at), states: [...to] } })
    // First pick (setup, before the campaign exists): the Setup ticket carries the states, so no change row or to-do.
    if (!from.length) { note('States saved. Leads come from these states only'); return null }
    const c = makeChange({ agentId: AGENT.id, agentName: s.profile?.name || 'Your agent', from, to, todayIso: todayIso(), at })
    addStateChange(c)
    note(`States saved: ${diffWords(c)}. Your leads change ${dayWords(c.starts)}`)
    return c
  }
}

// The row in Billing's Your plan.
export function useAgentStates() {
  const { data: s } = useSampleSettings()
  const all = useStateChanges()
  const waiting = all.find(c => c.agentId === AGENT.id && !c.done)
  return { states: asPick(s.licence).states, waiting }
}
