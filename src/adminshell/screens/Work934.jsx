import { useState } from 'react'
import { Image as ImageIcon, Check } from 'lucide-react'
import { useAdmBugs, useAdmActions } from '../data'
import { Seg, Chip, Avatar, Empty, useNote } from '../../template/kit'
import { BUG_STATUS } from '../../template/bugReport'
import '../../template/reportbug.css'
import '../../template/settings929.css'
import { Compliance } from './Compliance879'
import { DeedstoneNumbers } from './Numbers916'

// P934 (Brayden, Nov 10): the admin's working pages left Settings for their own page on the left rail, so Settings is
// only things that are set: Bug reports, Deedstone numbers (and the VA pods), Wording to approve, Training and
// Compliance, plus P932's Carrier playbook. Each is the same section it was; old Settings links (?tab=bugs ...) land here (Settings.jsx MOVED).
// P936: Training, Wording to approve and Carrier playbook left the rail (paths.js ADM_OLD sends their old addresses to Overview).
const Page = ({ label, children }) => (
  <div className="tp-page adm-work">
    <section className="fx-tile fx-panel" aria-label={label}><div className="fx-form">{children}</div></section>
  </div>
)
const Head = ({ title, sub }) => <header className="fx-form-h"><h2>{title}</h2><p>{sub}</p></header>

// P876 — Bug reports: what agents, VAs and admins send from Help & Support → Report a bug, newest first, with what was
// captured for them. New → Seen → Fixed. Sample until P858 reads bug_reports (the P711 table).
const BUG_TONE = { new: 'warn', seen: 'blue', fixed: 'green' }
export function BugsPage() {
  const { data: bugs } = useAdmBugs()
  const { setBugStatus } = useAdmActions()
  const note = useNote()
  const [show, setShow] = useState('open')
  const pick = k => b => (k === 'open' ? b.status !== 'fixed' : k === 'fixed' ? b.status === 'fixed' : true)
  const list = bugs.filter(pick(show))
  const count = k => bugs.filter(pick(k)).length
  return (
    <Page label="Bug reports">
      <Head title="Bug reports" sub="Sent from Help and support → Report a bug. Each one tells you the page, time, browser and screen." />
      <Seg label="Show" value={show} onChange={setShow} options={[{ key: 'open', label: 'Open', count: count('open') }, { key: 'fixed', label: 'Fixed', count: count('fixed') }, { key: 'all', label: 'All', count: count('all') }]} />
      {list.length === 0 && <Empty title="Nothing here" sub={show === 'open' ? 'No open bug reports.' : 'None yet.'} />}
      <ul className="tp-list adm-bugs">{list.map(b => (
        <li key={b.id} className="fx-mrow"><Avatar name={b.who} />
          <span className="tp-grow"><b>{b.who}{b.role ? ` (${b.role})` : ''} · {b.at}</b><small>{b.text}</small>{b.expected && <small>Expected: {b.expected}</small>}
            <small className="adm-bug-ctx">{[b.page, b.browser, b.screen].filter(Boolean).join(' · ')}</small></span>
          {b.shot && <button type="button" className="fx-pillbtn" onClick={() => note('Screenshots open once you sign in for real')}><ImageIcon size={13} />{b.file ? 'File' : 'Screenshot'}</button>}
          <Chip tone={BUG_TONE[b.status]}>{BUG_STATUS[b.status]}</Chip>
          {b.status !== 'fixed' && <button type="button" className="fx-pillbtn" onClick={() => { const to = b.status === 'new' ? 'seen' : 'fixed'; setBugStatus(b.id, to, b.who); note(to === 'seen' ? 'Marked seen' : 'Marked fixed') }}><Check size={13} />{b.status === 'new' ? 'Mark seen' : 'Mark fixed'}</button>}
        </li>
      ))}</ul>
    </Page>
  )
}

// The numbers page also holds the P932 hold line (its music and the AI front desk), the same phone lines.
export const NumbersPage = () => <Page label="Deedstone numbers"><DeedstoneNumbers /></Page>
export const CompliancePage = () => <Page label="Compliance"><Compliance /></Page>
