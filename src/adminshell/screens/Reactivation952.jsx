import { useState } from 'react'
import { RotateCcw, PauseCircle, PlayCircle, SlidersHorizontal, ShieldAlert } from 'lucide-react'
import { Chip, Drawer, Empty, Field, SampleTag, useNote } from '../../template/kit'
import { useAdmSource } from '../data'
import { useAdmReactivation, qualityOf } from '../reactivation952'
import { LIST_STATUS, pctText, usd0 } from '../../lib/reactivation.js'
import '../../template/react952.css'

// P952 — admin Leads › Reactivation. Every agent's old-lead list with its quality: contact rate (reached ÷ worked),
// booked rate (booked + transferred ÷ reached) and stop rate (stop calling ÷ reached). A list over the stop limit
// pauses itself and lands on Needs you; an admin can pause or resume any list here. Price, minimum, tries and the
// pause limit are admin settings. The switch (reactivation_live) and the scrub provider are CC-only.
export function ReactivationView() {
  const src = useAdmSource()
  const v = useAdmReactivation(src)
  const note = useNote()
  const [edit, setEdit] = useState(null)
  const [busy, setBusy] = useState(false)
  const s = v.settings
  if (v.missing) return <Empty title="Reactivation isn’t set up yet" sub="It needs migration 267. Nothing is called until then." />
  if (!s) return null
  const run = async (fn, ok) => { setBusy(true); try { await fn(); note(ok + (src === 'real' ? '' : ' (sample)')) } catch (e) { note(e.message) } finally { setBusy(false) } }
  const open = () => setEdit({ price: String(s.price_cents / 100), min: String(s.min_leads), tries: String(s.max_attempts), rate: String(Math.round(Number(s.pause_stop_rate) * 100)), reached: String(s.pause_min_reached) })
  const save = () => run(async () => {
    await v.save({ price_cents: Math.round(Number(edit.price) * 100), min_leads: Number(edit.min), max_attempts: Number(edit.tries), pause_stop_rate: Number(edit.rate) / 100, pause_min_reached: Number(edit.reached) })
    setEdit(null)
  }, 'Reactivation settings saved')
  const ok = edit && Number(edit.price) >= 0.5 && Number(edit.price) <= 50 && Number(edit.min) >= 1 && Number(edit.tries) >= 1 && Number(edit.tries) <= 10 && Number(edit.rate) > 0 && Number(edit.rate) <= 100 && Number(edit.reached) >= 1
  return (
    <section className="rx-adm" aria-label="Reactivation lists">
      <div className="rx-adm-top">
        <span className="rx-adm-facts">
          <Chip tone={s.live ? 'green' : 'mute'}>{s.live ? 'Calling is on' : 'Calling is off'}</Chip>
          <Chip tone={s.scrub_provider !== 'none' ? 'green' : 'warn'}>{s.scrub_provider !== 'none' ? 'Do Not Call check connected' : 'Do Not Call check not connected'}</Chip>
          <Chip tone={s.numbers ? 'blue' : 'warn'}>{s.numbers} reactivation number{s.numbers === 1 ? '' : 's'}</Chip>
          {src !== 'real' && <SampleTag>Sample</SampleTag>}
        </span>
        <span className="tp-grow" />
        <span className="rx-adm-price"><b className="tp-money">{usd0(s.price_cents)}</b> a lead · at least {s.min_leads} · {s.max_attempts} tries</span>
        <button type="button" className="tp-btn ov-ghost" onClick={open}><SlidersHorizontal size={15} aria-hidden="true" />Settings</button>
      </div>
      {!(v.lists || []).length && <Empty title="No lists yet" sub="When an agent sends a list of old leads, it shows here with how it’s going." />}
      <ul className="rx-adm-lists">
        {(v.lists || []).map((l, i) => {
          const q = qualityOf(l, s)
          const [tone, word] = LIST_STATUS[l.status] || ['mute', l.status]
          const pr = l.progress || {}
          const over = q.stop > Number(s.pause_stop_rate)
          return (
            <li key={l.id} className="fx-card rx-adm-row" style={{ '--i': i }}>
              <header>
                <RotateCcw size={14} aria-hidden="true" />
                <b>{l.name}</b><small>{l.agent} · {l.callable} people · <span className="tp-money">{usd0(l.amount_cents)}</span>{l.refunded_cents ? <> · <span className="tp-money">{usd0(l.refunded_cents)}</span> back</> : null}</small>
                <Chip tone={tone}>{word}</Chip>
              </header>
              <dl className="rx-n rx-adm-n">
                <div><dt>Worked</dt><dd className="tp-money">{pr.worked || 0}</dd></div>
                <div><dt>Contact rate</dt><dd className="tp-money">{pctText(q.contact)}</dd></div>
                <div><dt>Booked rate</dt><dd className="tp-money">{pctText(q.booked)}</dd></div>
                <div className={over ? 'is-bad' : ''}><dt>Stop rate</dt><dd className="tp-money">{pctText(q.stop)}</dd></div>
                <div><dt>Remaining</dt><dd className="tp-money">{pr.remaining || 0}</dd></div>
                <div><dt>AI cost</dt><dd className="tp-money">{usd0(l.cost_cents || 0)}</dd></div>
              </dl>
              {l.status === 'paused' && l.pause_reason && <p className="rx-adm-why"><ShieldAlert size={14} aria-hidden="true" />{l.pause_reason}</p>}
              {(l.status === 'working' || l.status === 'paused') && (
                <div className="rx-adm-acts">
                  {l.status === 'working'
                    ? <button type="button" className="tp-btn ov-ghost" disabled={busy} onClick={() => run(() => v.pause(l.id, true), `${l.name} paused`)}><PauseCircle size={15} aria-hidden="true" />Pause</button>
                    : <button type="button" className="tp-btn ov-ghost" disabled={busy} onClick={() => run(() => v.pause(l.id, false), `${l.name} calling again`)}><PlayCircle size={15} aria-hidden="true" />Resume</button>}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <Drawer open={!!edit} onClose={() => setEdit(null)} title="Reactivation settings" sub="Applies to lists sent from now on (price and minimum) and to every list (tries and the pause limit)."
        footer={<button type="button" className="tp-primary fx-accent" disabled={!ok || busy} onClick={save}>Save settings</button>}>
        {edit && <>
          <Field label="Price per callable lead ($)" hint="Numbers we take off are free."><input inputMode="decimal" value={edit.price} onChange={e => setEdit({ ...edit, price: e.target.value })} /></Field>
          <Field label="Minimum leads per list" hint="Counted after cleaning."><input inputMode="numeric" value={edit.min} onChange={e => setEdit({ ...edit, min: e.target.value })} /></Field>
          <Field label="Tries per person" hint="Day 1, 2, 4, 7 and 14. Up to 10."><input inputMode="numeric" value={edit.tries} onChange={e => setEdit({ ...edit, tries: e.target.value })} /></Field>
          <Field label="Pause a list when the stop rate is over (%)" hint="Stop calling ÷ people reached."><input inputMode="decimal" value={edit.rate} onChange={e => setEdit({ ...edit, rate: e.target.value })} /></Field>
          <Field label="…once this many people were reached"><input inputMode="numeric" value={edit.reached} onChange={e => setEdit({ ...edit, reached: e.target.value })} /></Field>
        </>}
      </Drawer>
    </section>
  )
}
