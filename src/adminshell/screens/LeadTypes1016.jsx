import { useState } from 'react'
import { ArrowUp, ArrowDown, Plus, Star } from 'lucide-react'
import { Switch, useNote } from '../../template/kit'
import { useAdmAgents, useAdmSource } from '../data'
import { useCoverageTypes, useLeadTypeAdmin } from '../../hooks/useLeadTypes'
import { byOrder, effectiveType } from '../../lib/coverageTypes'
import './leadTypes1016.css'

// P1016 — Settings › Lead types: the kinds of life insurance leads agents pick from. Rename (the label agents see and
// the words the AI caller says), add, hide, reorder, and move "Most popular". Keys never change and a type is never
// deleted (old leads keep it); hide it instead. Every change is audit-logged (migration 281).
const keyOf = label => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 't_$1').slice(0, 40)

function Row({ t, i, n, agents, onSave, onMove, onPopular }) {
  const [d, setD] = useState(null)
  const v = d ?? t
  const dirty = d && (d.label !== t.label || d.words !== t.words || d.blurb !== t.blurb)
  return (
    <li className={`lty-row${t.hidden ? ' is-hidden' : ''}`} data-testid={`lty-${t.key}`}>
      <div className="lty-move">
        <button type="button" aria-label={`Move ${t.label} up`} disabled={i === 0} onClick={() => onMove(i, -1)}><ArrowUp size={14} /></button>
        <button type="button" aria-label={`Move ${t.label} down`} disabled={i === n - 1} onClick={() => onMove(i, 1)}><ArrowDown size={14} /></button>
      </div>
      <div className="lty-fields">
        <label><span>Name agents see</span><input value={v.label} maxLength={40} onChange={e => setD({ ...v, label: e.target.value })} /></label>
        <label><span>The AI caller says “…about the <i>{v.words || '…'}</i> coverage you looked at”</span><input value={v.words} maxLength={60} onChange={e => setD({ ...v, words: e.target.value })} /></label>
        <label className="lty-wide"><span>One line under the name</span><input value={v.blurb || ''} maxLength={160} onChange={e => setD({ ...v, blurb: e.target.value })} /></label>
        {dirty && <div className="lty-save"><button type="button" className="tp-btn ov-ghost" onClick={() => setD(null)}>Discard</button>
          <button type="button" className="tp-primary fx-accent" disabled={!v.label.trim() || !v.words.trim()} onClick={() => onSave(v).then(ok => ok && setD(null))}>Save</button></div>}
      </div>
      <div className="lty-side">
        <span className="lty-n">{agents} {agents === 1 ? 'agent' : 'agents'}</span>
        <button type="button" className={`lty-pop${t.most_popular ? ' is-on' : ''}`} aria-pressed={t.most_popular} disabled={t.hidden || t.most_popular} onClick={() => onPopular(t.key)}>
          <Star size={13} aria-hidden="true" />{t.most_popular ? 'Most popular' : 'Make most popular'}
        </button>
        <Switch on={!t.hidden} onChange={on => onSave({ ...t, hidden: !on })} label={`${t.label}: offered to agents`} />
        <small>{t.hidden ? 'Hidden' : 'Offered'}</small>
      </div>
    </li>
  )
}

export function LeadTypes() {
  const { all } = useCoverageTypes(useAdmSource() === 'real')
  const { data: agents } = useAdmAgents()
  const admin = useLeadTypeAdmin(useAdmSource() === 'real')
  const note = useNote()
  const [add, setAdd] = useState({ label: '', words: '', blurb: '' })
  const list = byOrder(all)
  const count = key => agents.filter(a => effectiveType(a.coverage, all) === key && a.role !== 'admin').length
  const tryIt = async (fn, done) => {
    try { await fn(); if (done) note(done); return true } catch (e) { note(e.message || 'Couldn’t save'); return false }
  }
  const move = (i, by) => {
    const keys = list.map(t => t.key)
    const [k] = keys.splice(i, 1)
    keys.splice(i + by, 0, k)
    tryIt(() => admin.order(keys))
  }
  const key = keyOf(add.label)
  const taken = all.some(t => t.key === key)
  return (
    <>
      <header className="fx-form-h"><h2>Lead types</h2><p>The kinds of life insurance leads agents pick from, in this order. Each agent takes one; its ads and lead form are made for it. Everything else works the same for every type.</p></header>
      <ol className="lty-list">
        {list.map((t, i) => (
          <Row key={t.key} t={t} i={i} n={list.length} agents={count(t.key)}
            onSave={v => tryIt(() => admin.save(v), `${v.label} saved`)}
            onMove={move} onPopular={k => tryIt(() => admin.popular(k), 'Most popular moved')} />
        ))}
      </ol>
      <div className="lty-add">
        <b>Add a lead type</b>
        <div className="lty-fields">
          <label><span>Name agents see</span><input value={add.label} maxLength={40} placeholder="e.g. Accidental death" onChange={e => setAdd({ ...add, label: e.target.value, words: add.words || '' })} /></label>
          <label><span>What the AI caller says</span><input value={add.words} maxLength={60} placeholder="e.g. accidental death" onChange={e => setAdd({ ...add, words: e.target.value })} /></label>
          <label className="lty-wide"><span>One line under the name</span><input value={add.blurb} maxLength={160} onChange={e => setAdd({ ...add, blurb: e.target.value })} /></label>
        </div>
        {taken && add.label && <p className="lty-warn">That name is already a lead type.</p>}
        <button type="button" className="tp-primary fx-accent" disabled={key.length < 2 || taken || !add.words.trim()}
          onClick={() => tryIt(() => admin.save({ key, label: add.label.trim(), words: add.words.trim(), blurb: add.blurb.trim(), hidden: false }), `${add.label.trim()} added`).then(ok => ok && setAdd({ label: '', words: '', blurb: '' }))}>
          <Plus size={15} aria-hidden="true" />Add lead type
        </button>
        <p className="lty-note">A new type needs its own ads and lead form before agents can get leads for it. Tell Jordan first.</p>
      </div>
    </>
  )
}
