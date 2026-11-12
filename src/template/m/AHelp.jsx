import { useState } from 'react'
import { MessageCircle, Headphones, Bug, Download, ChevronDown } from 'lucide-react'
import { GetApp } from '../TemplateFrame'
import { TalkDrawer } from '../Talk'
import { ReportBug } from '../ReportBug'
import { isNativeApp } from '../../lib/native'
import { isSupport } from '../support911'
import { useApp, SubPage, Row, rise } from './AppKit'
import { useThreadList } from './AMessages'

// P972 — Help as its own screen (it was the portal's drawer): message Ohvara Support first, then a call with the
// team, report a problem, get the phone app, and short answers to what agents ask most.
const FAQ = [
  ['How do I tell you how a call went?', 'Open Leads, tap Mark on the call and pick one result. Our team handles what comes next.'],
  ['Who works my clients?', 'Our team does: the review call, the carrier and every change after. You see where each one stands under Clients.'],
  ['When am I charged?', 'Lead spend is charged each night, one day ahead. Your plan, card and receipts are in Billing.'],
  ['Can I change the hours I take calls?', 'Yes. Settings, then Hours you take calls. We only book inside those hours.'],
  ['How do I reach a person?', 'Message Ohvara Support here. Brayden or Jordan answers, usually the same day.'],
]

export function AHelp() {
  const app = useApp()
  const native = isNativeApp()
  const { threads } = useThreadList()
  const support = threads.find(isSupport)
  const [panel, setPanel] = useState(null)
  const [open, setOpen] = useState(null)
  const close = () => setPanel(null)
  return (
    <SubPage big title="Help" line="We answer in minutes">
      {support && (
        <button type="button" className="ma-helphero ma-press ma-rise" onClick={() => app.openSub('thread', { t: support.id })}>
          <span className="ma-helphero-ic" aria-hidden="true"><MessageCircle size={24} /></span>
          <span className="ma-grow"><b>Message Ohvara Support</b><small>Anything about your account, billing or leads</small></span>
        </button>
      )}
      <div className="ma-glass ma-list ma-rise" style={rise(1)}>
        <Row onClick={() => setPanel('talk')} lead={<span className="ma-sym is-sage"><Headphones size={16} aria-hidden="true" /></span>} title="Talk to the team" sub="Pick a time for a quick call" />
        <Row onClick={() => setPanel('bug')} lead={<span className="ma-sym is-coral"><Bug size={16} aria-hidden="true" /></span>} title="Report a problem" sub="Something broken or looks wrong" />
        {!native && <Row onClick={() => setPanel('app')} lead={<span className="ma-sym is-sky"><Download size={16} aria-hidden="true" /></span>} title="Get the phone app" sub="Alerts the moment a lead comes in" />}
      </div>
      <p className="ma-cap is-out">Common questions</p>
      <div className="ma-glass ma-list ma-faq ma-rise" style={rise(2)}>
        {FAQ.map(([q, a], i) => (
          <div key={q} className={`ma-faq-i${open === i ? ' is-open' : ''}`}>
            <button type="button" className="ma-row" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
              <span className="ma-grow"><b>{q}</b></span><ChevronDown size={18} className="ma-chev" aria-hidden="true" />
            </button>
            {open === i && <p className="ma-faq-a">{a}</p>}
          </div>
        ))}
      </div>
      <GetApp open={panel === 'app'} onClose={close} />
      <TalkDrawer open={panel === 'talk'} onClose={close} />
      <ReportBug open={panel === 'bug'} onClose={close} role="Agent" />
    </SubPage>
  )
}
