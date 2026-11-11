import { useState } from 'react'
import { RotateCcw, PauseCircle, PlayCircle, SlidersHorizontal, ShieldAlert } from 'lucide-react'
import { Chip, Drawer, Empty, Field, SampleTag, useNote } from '../../template/kit'
import { useAdmSource } from '../data'
import { useAdmReactivation, qualityOf } from '../reactivation952'
import { statusOf, pctText, usd0 } from '../../lib/reactivation.js'
import '../../template/react952.css'

// P952 — admin Leads › Reactivation. Every agent's old-lead list with its quality: contact rate (reached ÷ worked),
// booked rate (booked + transferred ÷ reached) and stop rate (stop calling ÷ reached). A list over the stop limit
// pauses itself and lands on Needs you; an admin can pause or resume any list here. P957: the price per delivered
// appointment or live call, the new-account limits, tries and the pause limit are admin settings; Accounts shows each
// agent's calls vs paid appointments (many calls, nothing paid = watch, also a to-do), their card and duplicate leads. The switch (reactivation_live) and the scrub provider are CC-only.
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
  const open = () => setEdit({ price: String(s.delivered_cents / 100), secs: String(s.transfer_min_secs), untilPaid: String(s.new_until_paid),
    newMax: String(s.new_max_callable), newDaily: String(s.new_daily_calls), max: String(s.max_callable), daily: String(s.daily_calls), watch: String(s.watch_calls),
    tries: String(s.max_attempts), rate: String(Math.round(Number(s.pause_stop_rate) * 100)), reached: String(s.pause_min_reached) })
  const n = k => Number(edit?.[k])
  const save = () => run(async () => {
    await v.save({ delivered_cents: Math.round(n('price') * 100), transfer_min_secs: n('secs'), new_until_paid: n('untilPaid'), new_max_callable: n('newMax'),
      new_daily_calls: n('newDaily'), max_callable: n('max'), daily_calls: n('daily'), watch_calls: n('watch'),
      max_attempts: n('tries'), pause_stop_rate: n('rate') / 100, pause_min_reached: n('reached') })
    setEdit(null)
  }, 'Reactivation settings saved')
  const ok = edit && n('price') >= 1 && n('price') <= 500 && n('secs') >= 5 && n('secs') <= 600 && n('untilPaid') >= 0 && n('newMax') >= 1 && n('newDaily') >= 1
    && n('max') >= n('newMax') && n('daily') >= 1 && n('watch') >= 1 && n('tries') >= 1 && n('tries') <= 10 && n('rate') > 0 && n('rate') <= 100 && n('reached') >= 1
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
        <span className="rx-adm-price"><b className="tp-money">{usd0(s.delivered_cents)}</b> per appointment or live call · {s.max_attempts} tries</span>
        <button type="button" className="tp-btn ov-ghost" onClick={open}><SlidersHorizontal size={15} aria-hidden="true" />Settings</button>
      </div>
      {(v.accounts || []).length > 0 && (
        <div className="rx-adm-acc" role="region" aria-label="Accounts">
          <table>
            <thead><tr><th>Agent</th><th>AI calls</th><th>AI cost</th><th>Paid</th><th>Charged</th><th>Owed</th><th>Card</th><th>Flags</th></tr></thead>
            <tbody>{v.accounts.map(a => (
              <tr key={a.agent_id} className={a.watch ? 'is-bad' : ''}>
                <td>{a.agent}</td><td className="tp-money">{a.calls}</td><td className="tp-money">{usd0(a.cost_cents || 0)}</td>
                <td className="tp-money">{a.paid}</td><td className="tp-money">{usd0(a.paid_cents || 0)}</td><td className="tp-money">{a.owed}</td>
                <td>{a.card ? `${a.card.brand || 'card'} ${a.card.last4 || ''} · ${a.card.status}` : 'not checked'}</td>
                <td>{[a.watch && 'Many calls, nothing paid', a.shared_card && 'Card on another account', a.dupes > 0 && `${a.dupes} leads also on another account`, a.limits?.is_new && 'New account limits', a.free_rebooks > 0 && `${a.free_rebooks} free rebooks`].filter(Boolean).join(' · ') || '—'}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {!(v.lists || []).length && <Empty title="No lists yet" sub="When an agent sends a list of old leads, it shows here with how it’s going." />}
      <ul className="rx-adm-lists">
        {(v.lists || []).map((l, i) => {
          const q = qualityOf(l, s)
          const [tone, word] = statusOf(l)
          const pr = l.progress || {}
          const over = q.stop > Number(s.pause_stop_rate)
          return (
            <li key={l.id} className="fx-card rx-adm-row" style={{ '--i': i }}>
              <header>
                <RotateCcw size={14} aria-hidden="true" />
                <b>{l.name}</b><small>{l.agent} · {l.callable} people · {l.model === 'per_lead' ? <span className="tp-money">{usd0(l.amount_cents)}</span> : <>{l.delivered || 0} delivered · <span className="tp-money">{usd0(l.charged_cents || 0)}</span></>}{l.refunded_cents ? <> · <span className="tp-money">{usd0(l.refunded_cents)}</span> back</> : null}{l.dupes ? ` · ${l.dupes} on another account` : ''}</small>
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
      <Drawer open={!!edit} onClose={() => setEdit(null)} title="Reactivation settings" sub="The price applies to appointments and live calls from now on; limits, tries and the pause limit to every list."
        footer={<button type="button" className="tp-primary fx-accent" disabled={!ok || busy} onClick={save}>Save settings</button>}>
        {edit && <>
          <Field label="Price per appointment or live call ($)" hint="Upload is free. A no-show rebook is free."><input inputMode="decimal" value={edit.price} onChange={e => setEdit({ ...edit, price: e.target.value })} /></Field>
          <Field label="A live call counts after (seconds connected)"><input inputMode="numeric" value={edit.secs} onChange={e => setEdit({ ...edit, secs: e.target.value })} /></Field>
          <Field label="New accounts: limits until this many appointments are paid"><input inputMode="numeric" value={edit.untilPaid} onChange={e => setEdit({ ...edit, untilPaid: e.target.value })} /></Field>
          <Field label="New accounts: people being called, at most"><input inputMode="numeric" value={edit.newMax} onChange={e => setEdit({ ...edit, newMax: e.target.value })} /></Field>
          <Field label="New accounts: AI calls a day"><input inputMode="numeric" value={edit.newDaily} onChange={e => setEdit({ ...edit, newDaily: e.target.value })} /></Field>
          <Field label="Everyone else: people being called, at most"><input inputMode="numeric" value={edit.max} onChange={e => setEdit({ ...edit, max: e.target.value })} /></Field>
          <Field label="Everyone else: AI calls a day"><input inputMode="numeric" value={edit.daily} onChange={e => setEdit({ ...edit, daily: e.target.value })} /></Field>
          <Field label="Flag an account after this many calls with nothing paid"><input inputMode="numeric" value={edit.watch} onChange={e => setEdit({ ...edit, watch: e.target.value })} /></Field>
          <Field label="Tries per person" hint="Day 1, 2, 4, 7 and 14. Up to 10."><input inputMode="numeric" value={edit.tries} onChange={e => setEdit({ ...edit, tries: e.target.value })} /></Field>
          <Field label="Pause a list when the stop rate is over (%)" hint="Stop calling ÷ people reached."><input inputMode="decimal" value={edit.rate} onChange={e => setEdit({ ...edit, rate: e.target.value })} /></Field>
          <Field label="…once this many people were reached"><input inputMode="numeric" value={edit.reached} onChange={e => setEdit({ ...edit, reached: e.target.value })} /></Field>
        </>}
      </Drawer>
    </section>
  )
}
