import { useMemo, useRef, useState } from 'react'
import { Upload, Download, ClipboardPaste, UserPlus, CircleCheck, TriangleAlert, Copy } from 'lucide-react'
import { Drawer, Field, Seg, useNote } from './kit'
import { PhoneInput } from './PhoneInput'
import { StateSelect } from './StateSelect'
import { useSampleClients, useSampleActions } from './data'
import { FIELDS, parseRows, checkRows, checkRow, TEMPLATE_CSV, TEAM_CALL_ACK, showPhone } from '../lib/bookImport.js'
import './p891.css'

// P891 — Clients → Add clients: bring the agent's own clients (sold anywhere) into servicing, one at a time or from a
// file / a paste from a sheet. Everything read is shown before saving, missing and duplicate rows flagged (lib/
// bookImport); only good rows are added. Each one gets a welcome call from the client care team, then it is serviced
// like any client. Server: agent_add_clients (migration p891_book_import.sql).

const BLANK = Object.fromEntries(FIELDS.map(f => [f.key, '']))
const FORM = FIELDS.filter(f => !['first_name', 'last_name', 'phone', 'state', 'notes'].includes(f.key))
const HINT = { time_zone: 'Leave blank: we use their state', face_amount: 'e.g. 250000', monthly_premium: 'e.g. 84.20', draft_day: '1 to 31', effective_date: '6/1/2025' }
const WORD = { ok: ['ok', 'Ready'], missing: ['warn', 'Missing details'], duplicate: ['mute', 'Already on your book'] }

function Review({ result, only, setOnly }) {
  const rows = only ? result.checked.filter(c => c.status !== 'ok') : result.checked
  return (
    <section className="bi-review" aria-label="What we read">
      <div className="bi-sum">
        <span className="bi-pill is-ok"><CircleCheck size={14} aria-hidden="true" />{result.ok} ready</span>
        {result.missing > 0 && <span className="bi-pill is-warn"><TriangleAlert size={14} aria-hidden="true" />{result.missing} missing details</span>}
        {result.duplicate > 0 && <span className="bi-pill is-mute"><Copy size={14} aria-hidden="true" />{result.duplicate} already on your book</span>}
        <span className="tp-grow" />
        {result.checked.length > 1 && result.ok < result.checked.length && <label className="tp-check bi-only"><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} /><span>Only rows to fix</span></label>}
      </div>
      <ul className="bi-rows">
        {rows.map(c => {
          const [tone, word] = WORD[c.status]
          const name = `${c.row.first_name} ${c.row.last_name}`.trim() || 'No name'
          return (
            <li key={c.row.line ?? name} className={`bi-row is-${tone}`}>
              <span className="bi-l">{c.row.line ? `Row ${c.row.line}` : 'Client'}</span>
              <span className="tp-grow bi-who"><b>{name}</b><small>{[c.row.phone && showPhone(c.row.phone), c.row.carrier, c.row.policy_number].filter(Boolean).join(' · ') || 'Nothing read'}</small>
                {c.status !== 'ok' && <em>{[c.missing.length ? `Missing: ${c.missing.join(', ')}` : null, ...c.odd, c.dup].filter(Boolean).join('. ')}</em>}
              </span>
              <span className={`tp-chip is-${tone === 'ok' ? 'green' : tone}`}><i />{word}</span>
            </li>
          )
        })}
      </ul>
      {result.ok < result.checked.length && <p className="tp-sub">Only the ready rows are added. Fix the others in your file and import them again; duplicates are skipped.</p>}
    </section>
  )
}

export function AddClients({ open, onClose }) {
  const note = useNote()
  const { data: clients } = useSampleClients()
  const { addClients } = useSampleActions()
  const [mode, setMode] = useState('one')
  const [one, setOne] = useState(BLANK)
  const [paste, setPaste] = useState('')
  const [read, setRead] = useState(null) // { rows, ignored, error, cut, from }
  const [ack, setAck] = useState(false)
  const [only, setOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const file = useRef(null)
  const book = useMemo(() => clients.map(c => ({ policy_number: c.policy_number, client_phone: c.client_phone })), [clients])

  const oneCheck = useMemo(() => {
    const c = checkRow(one, book)
    return { checked: [c], ok: c.status === 'ok' ? 1 : 0, missing: c.status === 'missing' ? 1 : 0, duplicate: c.status === 'duplicate' ? 1 : 0 }
  }, [one, book])
  const fileCheck = useMemo(() => (read && !read.error ? checkRows(read.rows, book) : null), [read, book])
  const result = mode === 'one' ? oneCheck : fileCheck
  const typed = mode === 'one' && ['first_name', 'last_name', 'phone', 'policy_number'].some(k => String(one[k]).trim())
  const showReview = mode === 'one' ? typed : !!fileCheck
  const ready = result?.ok || 0

  const reset = () => { setMode('one'); setOne(BLANK); setPaste(''); setRead(null); setAck(false); setOnly(false); if (file.current) file.current.value = '' }
  const close = () => { reset(); onClose() }
  const set = k => e => setOne(o => ({ ...o, [k]: e?.target ? e.target.value : e }))
  const pick = async e => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 2_000_000) { setRead({ rows: [], error: 'That file is over 2 MB. Split it in two.', from: f.name }); return }
    setRead({ ...parseRows(await f.text()), from: f.name })
  }
  const readPaste = () => setRead({ ...parseRows(paste), from: 'your paste' })
  const save = async () => {
    const rows = result.checked.filter(c => c.status === 'ok').map(c => c.row)
    setBusy(true)
    try {
      await addClients(rows, { ack })
      note(rows.length === 1 ? `${rows[0].first_name} added. The team will call to welcome them` : `${rows.length} clients added. The team will call to welcome each one`)
      close()
    } finally { setBusy(false) }
  }
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`

  return (
    <Drawer open={open} onClose={close} title="Add your clients" sub="Clients you sold anywhere. Your client care team calls each one to welcome them, then looks after them like any client."
      footer={<>
        <label className="tp-check bi-ack"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /><span>{TEAM_CALL_ACK} <span className="tp-tag">Draft wording</span></span></label>
        <button type="button" className="tp-primary fx-accent" disabled={!ack || !ready || busy} onClick={save}><UserPlus size={16} />{ready > 1 ? `Add ${ready} clients` : 'Add client'}</button>
      </>}>
      <Seg label="How" value={mode} onChange={k => { setMode(k); setOnly(false) }} options={[{ key: 'one', label: 'One client' }, { key: 'import', label: 'Import' }]} className="bi-seg" />

      {mode === 'one' ? (
        <div className="bi-form">
          <Field label="First name"><input value={one.first_name} onChange={set('first_name')} autoComplete="off" /></Field>
          <Field label="Last name"><input value={one.last_name} onChange={set('last_name')} autoComplete="off" /></Field>
          <Field label="Phone"><PhoneInput value={one.phone} onChange={d => setOne(o => ({ ...o, phone: d }))} aria-label="Phone" /></Field>
          <div className="tp-field"><span>State</span><StateSelect value={one.state} onChange={v => setOne(o => ({ ...o, state: v }))} /></div>
          {FORM.map(f => <Field key={f.key} label={f.label} hint={HINT[f.key]}><input value={one[f.key]} onChange={set(f.key)} type={f.key === 'email' ? 'email' : 'text'} inputMode={['face_amount', 'monthly_premium', 'draft_day'].includes(f.key) ? 'decimal' : undefined} autoComplete="off" /></Field>)}
          <Field label="Notes"><textarea value={one.notes} onChange={set('notes')} placeholder="Anything the team should know before they call" /></Field>
        </div>
      ) : (
        <div className="bi-import">
          <div className="bi-ways">
            <button type="button" className="bi-way" onClick={() => file.current?.click()}><Upload size={18} aria-hidden="true" /><b>Upload a CSV</b><small>Save your sheet as CSV first</small></button>
            <a className="bi-way" href={templateHref} download="ohvara-clients-template.csv"><Download size={18} aria-hidden="true" /><b>Download the template</b><small>The columns we read, with an example</small></a>
            <input ref={file} type="file" accept=".csv,text/csv,.txt" className="bi-file" aria-label="CSV file" onChange={pick} />
          </div>
          <Field label="Or paste from a sheet" hint="Copy the rows with the header row on top, then paste here.">
            <textarea value={paste} onChange={e => setPaste(e.target.value)} placeholder={'First name\tLast name\tPhone\tState\tCarrier\tPolicy number\n…'} />
          </Field>
          {paste.trim() && <button type="button" className="tp-btn ov-ghost fx-self" onClick={readPaste}><ClipboardPaste size={15} />Read the paste</button>}
          {read?.error && <p className="bi-err" role="alert"><TriangleAlert size={15} aria-hidden="true" />{read.error}</p>}
          {read && !read.error && <p className="tp-sub">Read {read.rows.length} row{read.rows.length === 1 ? '' : 's'} from {read.from}.{read.ignored?.length ? ` Not read: ${read.ignored.join(', ')}.` : ''}{read.cut ? ` ${read.cut} rows past 2,000 were left out.` : ''}</p>}
        </div>
      )}

      {showReview && result && <Review result={result} only={only} setOnly={setOnly} />}
    </Drawer>
  )
}
