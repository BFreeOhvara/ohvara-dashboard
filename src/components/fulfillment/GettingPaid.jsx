import { useMemo, useState } from 'react'
import { eyebrow, MONO, DISPLAY } from '../../lib/exportStyles'
import { Segmented } from '../ui/Segmented'
import { Avatar } from '../ui/Avatar'
import { Switch } from '../ui/Switch'
import { useFulfillmentReps, useFulfillmentPay } from '../../hooks/useFulfillmentPay'
import { payPeriod, fmtPeriod, fmtCents } from '../../lib/payPeriod'
import { useNow } from '../../lib/agentBookings'
import { usePaySettings, usePayouts, usePayoutAccounts, useSavePaySettings } from '../../hooks/useFulfillmentPayouts'
import { accountStatus, isoDay } from '../../lib/myPay'

// Fulfillment pay, the admin's card in Settings → Team tools (Prompt 681).
// P890: VAs are paid by the hour from clock in and out. This card has the
// Payouts and Pause switches and each rep's hourly rate and payout for the
// week. Pay goes out by itself every Monday at 8 AM Central
// (fulfillment-pay-week); there is nothing to approve here.

const PERIODS = [{ value: 'this', label: 'This week' }, { value: 'last', label: 'Last week' }]

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
  const { data: rates = [] } = useFulfillmentPay()
  const settingsQ = usePaySettings()
  const settings = settingsQ.data
  const save = useSavePaySettings()
  const { data: payouts = [] } = usePayouts(null)
  const { data: accounts = [] } = usePayoutAccounts(null)

  const rows = reps.map(r => ({
    rep: r,
    rate: rates.find(x => x.profile_id === r.id)?.hourly_rate_cents ?? null,
    payout: payouts.find(p => p.rep_id === r.id && p.period_start === startIso) || null,
    ready: accountStatus(accounts.find(a => a.rep_id === r.id) || null) === 'ready',
  }))

  return (
    <section className="ov-card ov-set-card" aria-label="Fulfillment pay" style={{ gap: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h2 style={{ margin: 0, flex: 1, fontFamily: DISPLAY, fontSize: 18, fontWeight: 600, color: 'var(--ov-hi)' }}>
          Fulfillment pay <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 400, color: 'var(--ov-mute)', marginLeft: 6 }}>{fmtPeriod(period)}</span>
        </h2>
        <Segmented size="sm" value={which} onChange={setWhich} options={PERIODS} />
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 13.5, color: 'var(--ov-mute)' }}>
        VAs are paid by the hour from clock in and out. Pay goes out by itself every Monday at 8 AM Central through Stripe; there is nothing to approve.
      </p>

      {settings && (
        <div style={{ marginBottom: 14 }}>
          <SwitchRow title={`Payouts ${settings.payouts_live ? 'on' : 'off'}`}
            text={settings.payouts_live ? 'Monday runs send real money.' : "Off: nothing moves. Turn on once the accountant confirms contractor vs employee."}
            checked={!!settings.payouts_live} disabled={save.isPending} onChange={v => save.mutate({ payouts_live: v })} />
          <SwitchRow title="Pause payouts"
            text={settings.payouts_paused ? 'Paused: Monday runs are skipped until you turn this off.' : 'Skips Monday runs while it’s on. Nothing is lost; it pays on the next run.'}
            checked={!!settings.payouts_paused} disabled={save.isPending} onChange={v => save.mutate({ payouts_paused: v })} />
        </div>
      )}

      {repsLoading ? <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</p>
        : rows.length === 0 ? <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>No Fulfillment reps yet.</p>
          : (
            <div style={{ border: 'var(--border-w) solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div className="hidden md:grid md:grid-cols-[minmax(0,1.4fr)_100px_110px] gap-x-4"
                style={{ ...eyebrow, padding: '10px 16px', background: 'var(--bg-elevated)' }}>
                <span>Rep</span><span style={{ justifySelf: 'end' }}>Hourly rate</span><span style={{ justifySelf: 'end' }}>Payout</span>
              </div>
              {rows.map((r, i) => {
                const chip = r.payout ? PAYOUT_CHIP[r.payout.status] : null
                return (
                  <div key={r.rep.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.4fr)_100px_110px] gap-x-4 gap-y-1 items-center"
                    style={{ padding: '12px 16px', borderTop: i ? 'var(--border-w) solid var(--border)' : 'none' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <Avatar profile={r.rep} size={26} />
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.rep.full_name}</span>
                    </span>
                    <span style={{ justifySelf: 'end', fontFamily: MONO, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{r.rate != null ? `${fmtCents(r.rate)}/hr` : '—'}</span>
                    <span className="col-span-2 md:col-span-1" style={{ justifySelf: 'end' }}>
                      {chip ? <span className={`fp-chip ${chip[0]}`} title={r.payout.failure_reason || ''}>{chip[1]}</span>
                        : <span style={{ fontSize: 12.5, color: r.ready ? 'var(--text-muted)' : 'var(--warning)' }}>{r.ready ? 'Next Monday' : 'No bank yet'}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
    </section>
  )
}
