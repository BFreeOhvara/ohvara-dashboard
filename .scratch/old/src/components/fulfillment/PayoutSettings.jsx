import { lazy, Suspense, useCallback, useState } from 'react'
import { Landmark, CalendarDays, UserRound, FileText, Mail, TriangleAlert, CircleCheck } from 'lucide-react'
import { SettingsCard, SettingsChip } from '../agent/AgentUI'
import { BackBar } from '../agent/ManageBilling'
import { Switch } from '../ui/Switch'
import { destination, requirementText, form1099 } from '../../lib/myPay'

// Prompt 753 — Payout settings, the second view of /fulfillment/pay
// (?settings=1), in Manage billing's look (P734): a back link to My pay and
// SettingsCards on a centred 820px column. Every form is a Stripe Connect
// embedded component inside our card (ConnectEmbeds.jsx); Ohvara only shows
// what fulfillment-connect-session returns: status, bank name + last 4, and
// masked details. Mockup: media/fulfillment-my-calls/payout-settings.dc.html.
// ?setup=1 opens first-time onboarding straight away (ignored once set up).

const LazyEmbed = lazy(() => import('./ConnectEmbeds'))

const STATUS_CHIP = {
  ready: ['on', 'Ready'],
  action_needed: ['warn', 'Action needed'],
  incomplete: ['warn', 'Not finished'],
  none: ['off', 'Not set up'],
}

function Row({ k, v, mono, tag, tagTone }) {
  return (
    <div className="ps-row">
      <span className="ps-row-main"><span className="ps-k">{k}</span><span className={`ps-v${mono ? ' mp-mono' : ''}`}>{v}</span></span>
      {tag && <span className={`ps-tag is-${tagTone || 'mute'}`}>{tag}</span>}
    </div>
  )
}

function Box({ title, children }) {
  return (
    <div className="ov-mb-cardbox ps-box">
      {title && <b className="ps-box-title">{title}</b>}
      <Suspense fallback={<div className="ps-wait">Loading…</div>}>{children}</Suspense>
    </div>
  )
}

export function PayoutSettingsView({
  overview, overviewLoading, overviewError, payouts = [], profile, now, onBack, onChanged,
  emails, onEmail, autoSetup = false, Embed = LazyEmbed,
}) {
  const [open, setOpen] = useState(autoSetup ? 'onboarding' : null)
  const [documents, setDocuments] = useState(true)
  const status = overview?.status || 'none'
  const acct = overview?.account
  const d = overview?.details
  const [tone, chip] = STATUS_CHIP[status] || STATUS_CHIP.none
  const close = useCallback(() => { setOpen(null); onChanged?.() }, [onChanged])
  const embed = kind => <Embed kind={kind} onDone={close} onDocuments={setDocuments} />
  const f1099 = form1099(payouts, now)
  const setUp = status === 'ready' || status === 'action_needed'

  return (
    <div className="ps-page">
      <BackBar onBack={onBack} backLabel="My pay" title="Payout settings"
        sub="Where your pay goes, your details and your tax forms. Handled by Stripe, without leaving Ohvara." />

      {overviewError && <div role="alert" className="ov-mb-notice is-error"><TriangleAlert size={18} aria-hidden="true" /><div>{overviewError}</div></div>}
      {status === 'action_needed' && open == null && <div className="ps-banner">{embed('banner')}</div>}

      {/* 1. Payout account */}
      <SettingsCard icon={Landmark} title="Payout account" sub="Where your weekly pay is sent"
        right={overviewLoading ? null : <SettingsChip tone={tone}>{chip}</SettingsChip>}>
        {overviewLoading ? <div className="mp-skel" /> : setUp ? (
          <>
            {acct?.last4 ? (
              <Row k={acct.external_kind === 'card' ? 'Debit card' : 'Bank account'} v={destination(acct)} mono tag="Default" tagTone="teal" />
            ) : <Row k="Bank account" v="None yet" />}
            {status === 'action_needed' && (
              <p className="ps-warn"><TriangleAlert size={15} strokeWidth={2} aria-hidden="true" /> {requirementText(acct?.requirements_due, acct?.disabled_reason)}</p>
            )}
            {open === 'bank' || open === 'card' ? (
              <Box title={open === 'card' ? 'Use a debit card instead' : 'Replace your bank account'}>{embed('bank')}</Box>
            ) : (
              <div className="ps-btns">
                <button type="button" className="ov-solid ov-mb-btn" onClick={() => setOpen('bank')}>{acct?.last4 ? 'Replace bank account' : 'Add a bank account'}</button>
                <button type="button" className="ov-ghost ov-mb-btn" onClick={() => setOpen('card')}>Use a debit card instead</button>
              </div>
            )}
          </>
        ) : open === 'onboarding' ? (
          <Box title="Set up payouts">{embed('onboarding')}</Box>
        ) : (
          <>
            <p className="ps-p">Add where your pay should go. It takes about 3 minutes: who you are, your bank, and your tax info, all in Stripe's secure fields.</p>
            <div className="ps-btns">
              <button type="button" className="ov-solid ov-mb-btn" onClick={() => setOpen('onboarding')}>
                {status === 'incomplete' ? 'Finish setting up' : 'Connect a bank account'}
              </button>
              <span className="mp-later ps-later">PayPal · coming later</span>
            </div>
          </>
        )}
      </SettingsCard>

      {/* 2. Payout schedule (read-only) */}
      <SettingsCard icon={CalendarDays} title="Payout schedule" sub="Set by Ohvara for everyone" right={<SettingsChip tone="info">Weekly</SettingsChip>}>
        <Row k="When" v="Every Monday, for the week before (Mon to Sun)" />
        <Row k="After" v="Brayden approves your hours · usually lands in 1–2 business days" />
      </SettingsCard>

      {/* 3. Your details */}
      <SettingsCard icon={UserRound} title="Your details" sub="Stripe checks these once so payouts aren't held"
        right={setUp && d ? <SettingsChip tone={d.verified ? 'on' : 'warn'}>{d.verified ? 'Verified' : 'Action needed'}</SettingsChip> : null}>
        {!setUp ? <p className="ps-p">You'll add these when you connect your bank.</p> : (
          <>
            <Row k="Legal name" v={d?.legal_name || 'On file with Stripe'} />
            <Row k="Address" v={d?.address || 'On file with Stripe'} />
            <Row k="Date of birth" v={d?.dob || '••/••/••••'} mono />
            {open === 'details' ? <Box title="Update your details">{embed('details')}</Box> : (
              <div className="ps-btns"><button type="button" className="ov-ghost ov-mb-btn" onClick={() => setOpen('details')}>Update details</button></div>
            )}
          </>
        )}
      </SettingsCard>

      {/* 4. Tax info */}
      <SettingsCard icon={FileText} title="Tax info" sub="For your 1099 at the end of the year"
        right={setUp ? <SettingsChip tone={d?.tin_on_file ? 'on' : 'warn'}>{d?.tin_on_file ? 'W-9 on file' : 'Needed'}</SettingsChip> : null}>
        {!setUp ? <p className="ps-p">Stripe asks for your taxpayer ID when you connect your bank.</p> : (
          <>
            <Row k="Taxpayer ID" v={d?.tin_on_file ? '•••-••-••••' : 'Not added yet'} mono={!!d?.tin_on_file} />
            <Row k={`${f1099.year} 1099-NEC`} v={f1099.ready ? 'Ready to download' : `Ready by ${f1099.readyBy.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
              tag={f1099.ready ? 'Ready' : 'Not yet'} tagTone={f1099.ready ? 'up' : 'mute'} />
            {open === 'tax' ? <Box title="Update tax info">{embed('tax')}</Box>
              : open === 'documents' ? <Box title="Your tax forms">{embed('documents')}</Box> : (
                <div className="ps-btns">
                  <button type="button" className="ov-ghost ov-mb-btn" onClick={() => setOpen('tax')}>Update tax info</button>
                  {documents && (
                    <button type="button" className="ov-ghost ov-mb-btn" disabled={!f1099.ready} onClick={() => setOpen('documents')}
                      title={f1099.ready ? undefined : 'Your 1099 is ready after your first year of payouts'}>Download 1099</button>
                  )}
                </div>
              )}
          </>
        )}
      </SettingsCard>

      {/* 5. Emails */}
      <SettingsCard icon={Mail} title="Emails" sub="We'll let you know about your pay"
        right={<SettingsChip tone={emails.sent || emails.problem ? 'on' : 'off'}>{emails.sent || emails.problem ? 'On' : 'Off'}</SettingsChip>}>
        <div className="ps-row">
          <span className="ps-row-main"><span className="ps-k">Payout sent</span><span className="ps-v">Email me when my pay is on its way</span></span>
          <Switch checked={emails.sent} disabled={emails.saving} onChange={v => onEmail({ payout_email_sent: v })} />
        </div>
        <div className="ps-row">
          <span className="ps-row-main"><span className="ps-k">Payout problem</span><span className="ps-v">Email me if a payout fails or is held</span></span>
          <Switch checked={emails.problem} disabled={emails.saving} onChange={v => onEmail({ payout_email_problem: v })} />
        </div>
        {emails.error && <p className="ov-mb-error">{emails.error}</p>}
        {emails.saved && <p className="ps-saved"><CircleCheck size={14} aria-hidden="true" /> Saved</p>}
        {profile?.email && <p className="ps-note">Sent to {profile.email}.</p>}
      </SettingsCard>

      <p className="ps-footer">Bank and tax details are entered into Stripe's own secure fields inside this page. Ohvara only ever sees the last 4 digits.</p>
    </div>
  )
}
