import { ShieldCheck, TriangleAlert, Download, CircleCheck, Lock } from 'lucide-react'
import { Chip, Empty, useNote } from '../kit'
import { Block } from '../Record'
import { DOC_TYPE, DOC_STATUS, SEND_STATUS, gateWords } from '../../lib/documents.js'
import { useDocs, docActions } from './data'
import '../p886.css'

// P886 — the agent's side of documents (N-E-31; E-87): the papers the team collected and sent for this client, and
// "upload this in your carrier portal" when a carrier only takes uploads from the producer. Sample only; 848 wires it
// to policy_documents_for and doc_send_result (src/lib/documents.js docsApi). The VA side is ../ful/Docs886.jsx.

// Agent: the papers on their client. Never mentions engines or ads.
export function AgentDocsBlock({ who }) {
  const { docs, gate } = useDocs(who)
  const note = useNote()
  return (
    <Block title="Documents" sub="What the team collected and sent for this client" aside={<span className="fx-count">{docs.length}</span>}>
      {gate.applies && <p className={`dc-rule${gate.open ? ' is-ok' : ''}`}>{gate.open ? <ShieldCheck size={15} aria-hidden="true" /> : <Lock size={15} aria-hidden="true" />}{gateWords(gate)}</p>}
      {docs.length ? <ul className="dc-list">{docs.map(d => {
        const [tone, words] = DOC_STATUS[d.status]
        const ask = d.sends.find(s => s.channel === 'agent_portal' && s.status === 'sending')
        const last = d.sends[0]
        return (
          <li key={d.id} className="dc-doc">
            <div className="dc-doc-h"><span className="tp-grow"><b>{d.title}</b><small>{DOC_TYPE[d.doc_type]} · {d.date}{last ? ` · ${SEND_STATUS[last.status][1].replace(', confirm it', '')}` : ''}</small></span><Chip tone={tone}>{words}</Chip></div>
            {ask && (
              <div className="dc-ask">
                <p><TriangleAlert size={15} aria-hidden="true" />Upload this in your {d.carrier} producer portal. The team can’t log in for you.</p>
                <div className="tp-row tp-wrap">
                  <button type="button" className="tp-btn ov-ghost sm" onClick={() => note('Sample: the signed PDF would download')}><Download size={14} />Download</button>
                  <button type="button" className="tp-primary sm fx-accent" onClick={() => { docActions.markSent(who, d.id, ask.id); note('Thanks. The team confirms the carrier has it') }}><CircleCheck size={14} />I uploaded it</button>
                </div>
              </div>
            )}
            {!ask && ['signed', 'on_file'].includes(d.status) && <button type="button" className="tp-btn ov-ghost sm dc-dl" onClick={() => note('Sample: the PDF would download')}><Download size={14} />Download</button>}
          </li>
        )
      })}</ul> : <Empty title="No papers yet" sub="Signed forms and carrier letters show here." />}
    </Block>
  )
}
