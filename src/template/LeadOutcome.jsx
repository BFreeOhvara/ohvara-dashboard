import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Drawer, Field, useNote } from './kit'
import { useSampleActions } from './data'
import { paths } from './paths'

// The stage chip and the Sold / Follow up / Not interested drawer, shared by the Leads list and the lead page.
export const stageChip = stage => ({
  booked: ['blue', 'Appointment booked'], ringing: ['teal', 'Ringing now'], missed: ['warn', 'Missed call'], no_show: ['warn', 'No-show'],
  sold: ['green', 'Sold'], follow_up: ['outline', 'Follow up'], not_interested: ['mute', 'Not interested'],
}[stage] || ['blue', 'New'])

export function OutcomeDrawer({ lead, kind, onClose }) {
  const { moveLead } = useSampleActions()
  const note = useNote()
  const [when, setWhen] = useState('Fri, Nov 6')
  const [why, setWhy] = useState('Not interested right now')
  if (!lead || !kind) return null
  const name = `${lead.first_name} ${lead.last_name}`
  const save = () => {
    moveLead(lead.id, kind, kind === 'follow_up' ? { follow: when } : kind === 'not_interested' ? { reason: why } : {})
    note(kind === 'sold' ? `${name} marked sold` : kind === 'follow_up' ? `Follow up set for ${when}` : `${name} marked not interested`)
    onClose()
  }
  return (
    <Drawer open onClose={onClose} title={{ sold: 'Mark as sold', follow_up: 'Follow up', not_interested: 'Not interested' }[kind]} sub={name}
      footer={<><button type="button" className="tp-primary fx-accent" onClick={save}>{kind === 'sold' ? 'Mark sold' : 'Save'}</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      {kind === 'sold' && <p className="tp-mid">Nice work. After you save, submit the sale for servicing and the team takes it from there.</p>}
      {kind === 'sold' && <Link to={paths.submit()} className="tp-link" onClick={onClose}>Submit for servicing</Link>}
      {kind === 'follow_up' && <Field label="Follow up on" hint="Pick a day to call back."><select value={when} onChange={e => setWhen(e.target.value)}>{['Fri, Nov 6', 'Mon, Nov 9', 'Tue, Nov 10', 'Wed, Nov 11'].map(d => <option key={d}>{d}</option>)}</select></Field>}
      {kind === 'not_interested' && <Field label="Reason"><select value={why} onChange={e => setWhy(e.target.value)}>{['Not interested right now', 'Already covered', 'Cannot afford it', 'Wrong number'].map(d => <option key={d}>{d}</option>)}</select></Field>}
    </Drawer>
  )
}
