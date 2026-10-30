import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { eyebrow, fieldLabel, control, primaryBtn, MONO, DISPLAY } from '../../lib/exportStyles'
import { Segmented } from '../ui/Segmented'
import { SavedTick } from '../ui/SavedTick'
import { Avatar } from '../ui/Avatar'
import { Switch } from '../ui/Switch'
import { useFulfillmentReps } from '../../hooks/useFulfillmentPay'
import { payPeriod, fmtPeriod, fmtCents } from '../../lib/payPeriod'
import { useNow } from '../../lib/agentBookings'
import { useCancels, usePaySettings, usePayouts, usePayoutAccounts, useSavePaySettings } from '../../hooks/useFulfillmentPayouts'
import { accountStatus, cancelTotals, isoDay } from '../../lib/myPay'

// Fulfillment pay, the admin's card in Settings → Team tools (Prompt 681;
// Prompt 764: pay per verified cancel). The pay settings (pay per cancel,
// weekly minimum, the unusual-volume cap), the Payouts and Pause switches,
// and each rep's cancels for the week. Pay goes out by itself every Monday at
// 8 AM Central (fulfillment-pay-week); there is nothing to approve here.
// Hours and shifts no longer feed pay (their data is kept).

const PERIODS = [{ value: 'this', label: 'This week' }, { value: 'last', label: 'Last week' }]
const dollars = cents => (cents == null ? '' : (cents / 100).toFixed(2))
const toCents = v => (String(v).trim() === '' ? null : Math.round(Number(v) * 100))

function PaySettingsForm({ settings }) {
  const save = useSavePaySettings()
  const [rate, setRate] = useState(dollars(settings.pay_per_cancel_cents))
  const [min, setMin] = useState(dollars(settings.weekly_min_cents))
  const [cap, setCap] = useState(String(settings.weekly_cancel_cap ?? 40))
  const [saved, setSaved] = useState(false)
  const rateC = toCents(rate)
  const minC = toCents(min)
  const capN = Number(cap)
  const rateBad = rateC == null || !Number.isFinite(rateC) || rateC < 0 || rateC > 100000
  const minBad = minC != null && (!Number.isFinite(minC) || minC < 1 || minC > 1000000)
  const capBad = !Number.isInteger(capN) || capN < 1 || capN > 1000
  const dirty = rateC !== settings.pay_per_cancel_cents || minC !== (settings.weekly_min_cents ?? null) || capN !== settings.weekly_cancel_cap

  function submit() {
    save.mutate({ pay_per_cancel_cents: rateC, weekly_min_cents: minC, weekly_cancel_cap: capN }, {
      onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000) },
    })
  }

  return (
    <div style={{ margin: '0 0 14px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))', gap: 14 }}>
        <label>
          <p style={fieldLabel}>Pay per cancel ($)</p>
          <input value={rate} onChange={e => setRate(e.target.value)} inputMode="decimal" placeholder="10.00"
            style={{ ...control, fontFamily: MONO, borderColor: rateBad ? 'var(--danger)' : undefined }} />
        </label>
        <label>
          <p style={fieldLabel}>Weekly minimum ($, optional)</p>
          <input value={min} onChange={e => setMin(e.target.value)} inputMode="decimal" placeholder="Off"
            style={{ ...control, fontFamily: MONO, borderColor: minBad ? 'var(--danger)' : undefined }} />
        </label>
        <label>
          <p style={fieldLabel}>Hold past (verified cancels a week)</p>
          <input value={cap} onChange={e => setCap(e.target.value)} inputMode="numeric" placeholder="40"
            style={{ ...control, fontFamily: MONO, borderColor: capBad ? 'var(--danger)' : undefined }} />
        </label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <button onClick={submit} disabled={!dirty || rateBad || minBad || capBad || save.isPending}
          style={{ ...primaryBtn, height: 36, opacity: !dirty || rateBad || minBad || capBad || save.isPending ? 0.5 : 1 }}>
          {save.isPending ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
        </button>
        <SavedTick show={saved} />
        {save.isError && <span style={{ fontSize: 12.5, color: 'var(--danger)' }}>{save.error?.message}</span>}
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--ov-mute)' }}>
        A new rate applies to cancels logged after you save; each cancel keeps the rate it was logged at. The minimum tops a rep up in a week they have at least one verified cancel. Past the hold number, extra verified cancels wait for you as Needs a listen.
      </p>
    </div>
  )
}

function SwitchRow({ title, text, checked, disabled, onChange }) {
  return (
    <div className="fp-live">
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ov-hi)' }}>{title}</p>
        <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--ov-mute)' }}>{text}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  )
}

const PAYOUT_CHIP = { paid: ['is-up', 'Paid'], approved: ['is-warn', 'Sending…'], held: ['is-warn', 'On hold'], failed: ['is-bad', 'Failed'] }

export function FulfillmentPayAdminPanel() {
  const now = useNow(30e3)
  const [which, setWhich] = useState('this')
  const period = useMemo(() => payPeriod(which === 'last' ? now - 7 * 864e5 : now), [which, now])
  const startIso = isoDay(period.start)
  const { data: reps = [], isLoading: repsLoading } = useFulfillmentReps()
  const settingsQ = usePaySettings()
  const settings = settingsQ.data
  const save = useSavePaySettings()
  const { data: cancels = [] } = useCancels(null, startIso)
  const { data: payouts = [] } = usePayouts(null)
  const { data: accounts = [] } = usePayoutAccounts(null)

  const rows = reps.map(r => ({
    rep: r,
    t: cancelTotals(cancels.filter(c => c.rep_id === r.id && c.week_start === startIso)),
    payout: payouts.find(p => p.rep_id === r.id && p.period_start === startIso) || null,
    ready: accountStatus(accounts.find(a => a.rep_id === r.id) || null) === 'ready',
  }))
  const total = rows.reduce((s, r) => s + r.t.verifiedCents, 0)

  return (
    <section className="ov-card ov-set-card" aria-label="Fulfillment pay" style={{ gap: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h2 style={{ margin: 0, flex: 1, fontFamily: DISPLAY, fontSize: 18, fontWeight: 600, color: 'var(--ov-hi)' }}>
          Fulfillment pay <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 400, color: 'var(--ov-mute)', marginLeft: 6 }}>{fmtPeriod(period)}</span>
        </h2>
        <Segmented size="sm" value={which} onChange={setWhich} options={PERIODS} />
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 13.5, color: 'var(--ov-mute)' }}>
        Reps are paid per verified cancel. Pay goes out by itself every Monday at 8 AM Central through Stripe; there is nothing to approve.
      </p>

      {settings && (
        <>
          <SwitchRow title={`Payouts ${settings.payouts_live ? 'on' : 'off'}`}
            text={settings.payouts_live ? 'Monday runs send real money.' : "Off: nothing moves. Turn on once the accountant confirms contractor vs employee."}
            checked={!!settings.payouts_live} disabled={save.isPending} onChange={v => save.mutate({ payouts_live: v })} />
          <SwitchRow title="Pause payouts"
            text={settings.payouts_paused ? 'Paused: Monday runs are skipped until you turn this off.' : 'Skips Monday runs while it’s on. Nothing is lost; it pays on the next run.'}
            checked={!!settings.payouts_paused} disabled={save.isPending} onChange={v => save.mutate({ payouts_paused: v })} />
          <PaySettingsForm key={`${settings.pay_per_cancel_cents}-${settings.weekly_min_cents}-${settings.weekly_cancel_cap}`} settings={settings} />
        </>
      )}

      {repsLoading ? <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</p>
        : rows.length === 0 ? <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>No Fulfillment reps yet.</p>
          : (
            <div style={{ border: 'var(--border-w) solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div className="hidden md:grid md:grid-cols-[minmax(0,1.4fr)_70px_90px_90px_80px_110px] gap-x-4"
                style={{ ...eyebrow, padding: '10px 16px', background: 'var(--bg-elevated)' }}>
                <span>Rep</span><span style={{ justifySelf: 'end' }}>Cancels</span><span style={{ justifySelf: 'end' }}>Verified</span>
                <span style={{ justifySelf: 'end' }}>Checking</span><span style={{ justifySelf: 'end' }}>Listen</span><span style={{ justifySelf: 'end' }}>Payout</span>
              </div>
              {rows.map((r, i) => {
                const chip = r.payout ? PAYOUT_CHIP[r.payout.status] : null
                return (
                  <div key={r.rep.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.4fr)_70px_90px_90px_80px_110px] gap-x-4 gap-y-1 items-center"
                    style={{ padding: '12px 16px', borderTop: i ? 'var(--border-w) solid var(--border)' : 'none' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <Avatar profile={r.rep} size={26} />
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.rep.full_name}</span>
                    </span>
                    <span className="hidden md:block" style={{ justifySelf: 'end', fontFamily: MONO, fontSize: 13 }}>{r.t.count}</span>
                    <span style={{ justifySelf: 'end', fontFamily: MONO, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{fmtCents(r.t.verifiedCents)}</span>
                    <span className="hidden md:block" style={{ justifySelf: 'end', fontFamily: MONO, fontSize: 13, color: 'var(--text-secondary)' }}>{fmtCents(r.t.checkingCents)}</span>
                    <span className="hidden md:block" style={{ justifySelf: 'end', fontFamily: MONO, fontSize: 13, color: r.t.listen ? 'var(--warning)' : 'var(--text-muted)' }}>{r.t.listen}</span>
                    <span className="col-span-2 md:col-span-1" style={{ justifySelf: 'end' }}>
                      {chip ? <span className={`fp-chip ${chip[0]}`} title={r.payout.failure_reason || ''}>{chip[1]}</span>
                        : <span style={{ fontSize: 12.5, color: r.ready ? 'var(--text-muted)' : 'var(--warning)' }}>{r.ready ? 'Next Monday' : 'No bank yet'}</span>}
                    </span>
                  </div>
                )
              })}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 18, padding: '12px 16px', borderTop: 'var(--border-w) solid var(--border)', background: 'var(--bg-elevated)' }}>
                <span style={{ ...eyebrow, color: 'var(--text-muted)' }}>Verified</span>
                <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{fmtCents(total)}</span>
              </div>
            </div>
          )}
    </section>
  )
}
