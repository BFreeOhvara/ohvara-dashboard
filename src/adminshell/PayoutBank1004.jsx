import { lazy, Suspense, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Landmark, Lock, PieChart } from 'lucide-react'
import { Chip, Drawer, useNote } from '../template/kit'
import './p1004.css'
import { useMyPayoutBank, useOwnerPayouts, useSplitLine } from './payoutBank'

// P1004 — each admin's own payout bank, the same way VAs add theirs (Stripe Connect, the fulfillment-connect-session
// function, which already takes admins). Ohvara never stores account or routing numbers: Stripe holds them and we
// keep only Stripe's account id plus the bank name and last four (fulfillment_payout_accounts). Like a password or
// two-step sign-in this is the admin's own account, so it is real whenever they are signed in, sample or not; only
// the signed-out preview shows a sample bank. Owner payouts (the 50/50 split between the two owners) are OFF until
// Brayden says go: app_settings.owner_payouts_on, changed only by CC (migration 275's guard). Nothing here pays anyone.
const Embed = lazy(() => import('../components/fulfillment/ConnectEmbeds'))
const BANK_SUB = {
  none: 'Not set up yet',
  incomplete: 'Stripe still needs a few details',
  action_needed: 'Stripe needs something from you',
}

// Desktop: Settings › Profile.
export function PayoutBankSection() {
  const bank = useMyPayoutBank()
  const owners = useOwnerPayouts()
  const split = useSplitLine()
  const note = useNote()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const setUp = bank.status === 'ready' || bank.status === 'action_needed'
  const go = () => (bank.live ? setOpen(true) : note('Sign in for real to add your bank (sample)'))
  const close = () => { setOpen(false); qc.invalidateQueries({ queryKey: ['fulfillment-payouts'] }) }
  return (
    <div className="adm-bank" aria-label="Payout bank">
      <div className="fx-mrow adm-bank-row">
        <Landmark size={17} aria-hidden="true" />
        <span className="tp-grow">
          <b>Payout bank{bank.text ? <> · <span className="tp-num">{bank.text}</span></> : ''}</b>
          <small>{bank.loading ? 'Checking with Stripe…' : bank.error ? 'Couldn’t reach Stripe. Try again in a minute.' : setUp ? (bank.status === 'action_needed' ? BANK_SUB.action_needed : 'Where your owner payouts go. Held by Stripe, never stored by Ohvara.') : BANK_SUB[bank.status] || BANK_SUB.none}</small>
        </span>
        <button type="button" className="fx-pillbtn" onClick={go} disabled={bank.loading}>{setUp ? 'Change' : 'Add bank'}</button>
      </div>
      <div className="fx-mrow adm-bank-row">
        <PieChart size={17} aria-hidden="true" />
        <span className="tp-grow"><b>Owner payouts · split {owners.pct}/{100 - owners.pct}</b><small>{split}</small></span>
        <Chip tone={owners.on ? 'green' : 'mute'}>{owners.on ? 'On' : 'Owner payouts are off'}</Chip>
      </div>
      <Drawer open={open} center onClose={close} title={setUp ? 'Change your payout bank' : 'Add your payout bank'} sub="Stripe’s secure form. Ohvara only ever sees the bank name and last four.">
        {open && <Suspense fallback={<p className="tp-sub">Loading…</p>}><Embed kind={setUp ? 'bank' : 'onboarding'} onDone={close} /></Suspense>}
        <p className="tp-sub adm-bank-lock"><Lock size={13} aria-hidden="true" /> Owner payouts stay off until they’re switched on. Adding a bank pays nothing.</p>
      </Drawer>
    </div>
  )
}
