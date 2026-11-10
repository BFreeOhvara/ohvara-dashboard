// P932 — the portal's playbook state on sample data: saved edits (they win over the researched seed), the edit log,
// each change's e-sign progress, the hold line settings and the callers on hold now. Real mode reads and writes the
// same tables (migration 262: carrier_playbook, playbook_save, hold_line_settings, front_desk_calls).
import { useSyncExternalStore } from 'react'

let state = {
  edits: {},                 // { [carrier_key]: { [action]: entry } }
  log: [
    { id: 'lg-1', key: 'cat-americo', carrier: 'Americo', action: 'name', by: 'Sarah Kim', at: 'Wed 3:12 PM', what: 'Noted: name change form isn’t listed on their page' },
  ],
  esign: { 'st-4': { stage: 1, sentAt: 'Thu 9:40 AM' } },   // Tom's address change: link out, waiting on his signature
  hold: { track: 'calm', custom_name: null, custom_url: null, front_desk_on: true, ai_after_sec: 20, update_every_sec: 60, max_wait_min: 10 },
  waiting: [
    { id: 'fd-1', name: 'Gloria Hayes', carrier: 'Foresters', need: 'beneficiary', minutes: 4, ahead: 0, since: '1:29 PM',
      summary: 'Gloria Hayes · Foresters\nBeneficiary change: “I want to change my beneficiary”\nThey said: “my son Marcus Hayes, instead of my late husband”' },
    { id: 'fd-2', name: 'Sam Ortiz', carrier: null, need: 'address', minutes: 7, ahead: 1, since: '1:31 PM',
      summary: 'Sam Ortiz (not on file: check name and date of birth) · DOB March 4 1950\nAddress change: “I moved last month”\nThey said: “12 Oak Street, Dallas 75201”' },
  ],
}
const subs = new Set()
const set = fn => { state = { ...state, ...fn(state) }; subs.forEach(f => f()) }
const subscribe = f => { subs.add(f); return () => subs.delete(f) }
export const usePlaybookState = () => useSyncExternalStore(subscribe, () => state)
export const playbookState = () => state

let n = 0
export const playbookActions = {
  // Admin or a VA saves an entry (a new carrier too). Logged with who, when and what.
  save: (key, carrier, action, entry, by = 'You') => set(s => ({
    edits: { ...s.edits, [key]: { ...(s.edits[key] || {}), [action]: entry } },
    log: [{ id: `lg-n${++n}`, key, carrier, action, by, at: 'Thu now', what: entry.method === 'check' ? 'Marked: check on first call' : `Set to ${entry.method === 'esign' ? 'e-sign' : entry.method === 'online' ? 'online' : 'merge call'}` }, ...s.log],
  })),
  // The e-sign path for one change: 1 link texted · 2 signed · 3 sent to the carrier · 4 carrier processed · 5 "done" text.
  esign: (itemId, stage) => set(s => ({ esign: { ...s.esign, [itemId]: { ...(s.esign[itemId] || {}), stage, [`at${stage}`]: 'Thu now' } } })),
  setHold: patch => set(s => ({ hold: { ...s.hold, ...patch } })),
}
