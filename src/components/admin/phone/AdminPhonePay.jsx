import { useState } from 'react'
import { ChevronRight, Play } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useAllProfiles } from '../../../hooks/useProfiles'
import { money, monDay, dayLong } from '../../../lib/adminPayouts'
import { DEFAULT_TIMEZONE } from '../../../lib/timezones'
import { Avatar } from '../../ui/Avatar'
import { ListenSheet } from './ListenSheet'
import { PhoneToast } from './PhoneToast'
import { useAdminPay, listenWhen } from './useAdminPay'

// Prompt 774 — Pay on a phone (mockup AdmPay.dc.html): the next pay run
// (Automatic / Paused / Stripe short, plus Not live yet before payouts are
// switched on), the cancels that need a listen (a row each, or one count row
// past two) opening the Listen sheet, who is in this run, and past runs. Same
// numbers as desktop Payouts (lib/adminPayouts.js); nothing here moves money.

const STATE = {
  auto: { badge: 'Pays automatically', cls: 'is-auto', note: () => 'Monday 8 AM. Nothing for you to do.' },
  paused: { badge: 'Paused', cls: 'is-warn', note: () => 'Automatic payouts are paused. Nobody gets paid Monday until you turn them back on in Payout settings.' },
  short: {
    badge: 'Won’t pay', cls: 'is-bad',
    note: (bal, need) => `Stripe balance is ${money(bal)}, short of ${money(need)}. Add ${money(need - bal)} to Stripe by Monday 8 AM or nobody gets paid.`,
  },
  off: { badge: 'Not live yet', cls: 'is-warn', note: () => 'Payouts are off, so Monday’s run moves no money. Turn them on in Settings.' },
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

export function AdminPhonePay() {
  const { profile } = useAuth()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const pay = useAdminPay()
  const { data: profiles = [] } = useAllProfiles()
  const [listenId, setListenId] = useState(null)
  const [toast, setToast] = useState(null)
  const byId = new Map(profiles.map(p => [p.id, p]))
  const { model } = pay
  const { nextRun, reps, past, listen } = model
  const st = STATE[pay.state]
  const rate = pay.settings?.pay_per_cancel_cents
  const listenCard = listenId ? listen.find(c => c.id === listenId) || null : null

  const row = (c, i) => (
    <button key={c.id} type="button" className="aph-listenrow" onClick={() => setListenId(c.id)}>
      <span className="aph-playdot" aria-hidden="true"><Play size={16} fill="currentColor" strokeWidth={0} style={{ marginLeft: 2 }} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {i === 0 && <span className="aph-kicker">Needs a listen · {listen.length}</span>}
        <span className="ph-row-title" style={{ fontSize: 15, marginTop: 2 }}>{c.client_name || 'Client'} · <span className="ph-mono">{money(c.amount_cents)}</span></span>
        <span className="ph-row-sub">{[c.carrier_name, byId.get(c.rep_id)?.full_name || c.agent_name, listenWhen(c.logged_at, tz)].filter(Boolean).join(' · ')}</span>
      </span>
      <ChevronRight size={16} strokeWidth={2.2} className="ph-chev" aria-hidden="true" />
    </button>
  )

  return (
    <div className="ph-stack" style={{ gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h1 className="ph-h1">Pay</h1>
        {rate != null && <span style={{ fontSize: 14, color: 'var(--ov-mute)' }}><span className="ph-mono">{money(rate)}</span> per verified cancel</span>}
      </div>

      <section className="ov-hero aph-payhero" aria-label="Next pay run">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="aph-payk">Next pay run · {monDay(nextRun.date)}</span>
          {!pay.loading && <span className={`aph-badge ${st.cls}`}><i aria-hidden="true" />{st.badge}</span>}
        </div>
        <div className="aph-payamt ph-mono">{pay.loading ? '—' : money(nextRun.cents)}</div>
        <div className="aph-paysub">
          {pay.loading ? 'Loading…' : pay.error ? `Couldn’t load pay: ${pay.error}` : `${plural(nextRun.count, 'verified cancel')} · ${plural(reps.length, 'person').replace('persons', 'people')}`}
        </div>
        {!pay.loading && <div className={`aph-paynote ${st.cls}`}>{st.note(pay.balance, nextRun.cents)}</div>}
      </section>

      {pay.listenError && <div className="ph-err" style={{ margin: 0 }}>Couldn’t load the cancels to listen to: {pay.listenError}</div>}
      {listen.length > 0 && (listen.length <= 2 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{listen.map(row)}</div>
      ) : (
        <button type="button" className="aph-listenrow" onClick={() => setListenId(listen[0].id)}>
          <span className="aph-playdot" aria-hidden="true"><Play size={16} fill="currentColor" strokeWidth={0} style={{ marginLeft: 2 }} /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="aph-kicker">Needs a listen</span>
            <span className="ph-row-title" style={{ fontSize: 15, marginTop: 2 }}>{plural(listen.length, 'cancel')} to listen to</span>
            <span className="ph-row-sub">Oldest: {[listen[0].client_name || 'Client', listen[0].carrier_name].filter(Boolean).join(' · ')}</span>
          </span>
          <ChevronRight size={16} strokeWidth={2.2} className="ph-chev" aria-hidden="true" />
        </button>
      ))}

      <section aria-label="In this run">
        <div className="ph-sechead" style={{ marginBottom: 10 }}><h2 className="ph-h2">In this run</h2></div>
        <div className="ov-card ph-card">
          {pay.loading ? <div className="ph-empty">Loading…</div>
            : !reps.length ? <div className="ph-empty">No verified cancels waiting for Monday.</div>
              : reps.map(r => {
                const rep = byId.get(r.repId)
                const n = plural(r.count, 'cancel')
                const [label, color] = r.state === 'ready' ? ['Bank ready', 'var(--ov-up)'] : r.state === 'held' ? ['Held', 'var(--ov-st-needs)'] : ['No bank', 'var(--ov-st-needs)']
                const sub = r.state === 'nobank' ? `${n} · held until they add a bank` : r.state === 'held' ? `${n} · ${r.over} over the weekly cap` : `${n} · ${r.bank}`
                return (
                  <div key={r.repId} className="ph-row" style={{ cursor: 'default', minHeight: 68 }}>
                    {rep ? <Avatar profile={rep} size={40} /> : <span className="aph-noav">?</span>}
                    <span className="ph-row-main">
                      <span className="ph-row-title" style={{ fontSize: 15 }}>{rep?.full_name || 'Unknown'}</span>
                      <span className="ph-row-sub">{sub}</span>
                    </span>
                    <span className="ph-row-end">
                      <b className="ph-mono" style={{ fontSize: 16 }}>{money(r.cents)}</b>
                      <span style={{ color, fontWeight: 700, fontSize: 12 }}>{label}</span>
                    </span>
                  </div>
                )
              })}
        </div>
      </section>

      <section aria-label="Past pay runs">
        <div className="ph-sechead" style={{ marginBottom: 10 }}>
          <h2 className="ph-h2">Past pay runs</h2><span style={{ flex: 1 }} />
          {model.paidSince && <span className="ph-mute"><span className="ph-mono">{money(model.paidTotal)}</span> since {dayLong(model.paidSince)}</span>}
        </div>
        <div className="ov-card ph-card">
          {!past.length ? <div className="ph-empty">No pay runs yet.</div> : past.map(r => (
            <div key={r.id} className="ph-row" style={{ cursor: 'default', minHeight: 60 }}>
              <span className="ph-row-main">
                <span className="ph-row-title">{r.day}</span>
                <span className="ph-row-sub">{r.sub}</span>
              </span>
              <span className="ph-row-end">
                <b className="ph-mono" style={{ fontSize: 15 }}>{money(r.cents)}</b>
                <span style={{ color: 'var(--ov-up)', fontWeight: 700, fontSize: 12 }}>Paid</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {listenCard && (
        <ListenSheet c={listenCard} rep={byId.get(listenCard.rep_id)} tz={tz} onClose={() => setListenId(null)}
          onDecided={paid => { setListenId(null); setToast(paid ? `Marked paid · ${money(listenCard.amount_cents)}` : 'Marked not paid') }} />
      )}
      <PhoneToast text={toast} onDone={() => setToast(null)} />
    </div>
  )
}
