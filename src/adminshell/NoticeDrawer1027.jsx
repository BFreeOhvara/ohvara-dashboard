// P1027 — the admin drawer for one carrier notice that needs a look (data: notices1027.js).
import { useEffect, useState } from 'react'
import { Drawer, useNote } from '../template/kit'
import { noticeWhy } from './notices1027'

export function NoticeDrawer({ n, onClose, match, dismiss }) {
  const note = useNote()
  const [pick, setPick] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPick(''); setDue(n?.parsed?.due_date || '') }, [n?.id, n?.parsed?.due_date])
  const run = async (f, done) => {
    setBusy(true)
    try { await f(); note(done); onClose() } catch (e) { note(e.message) } finally { setBusy(false) }
  }
  return (
    <Drawer open={!!n} center onClose={onClose} title="Carrier notice needs a look" sub={n ? `${n.agent} · ${noticeWhy(n.why)}` : ''}
      footer={n && <>
        <button type="button" className="tp-btn ov-ghost" disabled={busy} onClick={() => run(() => dismiss(n.id), 'Set aside')}>Not a missed payment</button>
        <button type="button" className="tp-primary fx-accent" disabled={busy || !pick} onClick={() => run(() => match(n.id, pick, due), 'Matched: the save call is open')}>Match and open save call</button>
      </>}>
      {n && <div className="adm-notice">
        <p className="tp-mid"><b>{n.subject || 'No subject'}</b><br /><small>{n.from}{n.parsed?.carrier ? ` · ${n.parsed.carrier}` : ''}{n.parsed?.client_name ? ` · about ${n.parsed.client_name}` : ''}</small></p>
        {n.excerpt && <pre className="adm-notice-text">{n.excerpt}</pre>}
        <label className="tp-field"><span>Which client is it?</span>
          <select value={pick} onChange={e => setPick(e.target.value)}>
            <option value="">Pick one of {n.agent?.split(' ')[0] || 'the agent'}{'’'}s clients</option>
            {(n.policies || []).map(p => <option key={p.id} value={p.id}>{p.name}{p.carrier ? ` · ${p.carrier}` : ''}{p.number ? ` · ${p.number}` : ''}</option>)}
          </select>
        </label>
        <label className="tp-field"><span>Payment due date (if the notice says)</span><input type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
      </div>}
    </Drawer>
  )
}
