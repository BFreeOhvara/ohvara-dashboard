import { CreditCard, Phone, CalendarDays, Check, CircleAlert } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useMembershipTiers } from '../../../hooks/useMembershipTiers'
import { PortalV2Layout, Ico, Skel, ErrorCard } from '../../../components/agent/PortalV2Nav'

// Plan & billing (/agent/plan, v2 portal only). Read only: the membership_tiers rows (migration 180)
// in row order, How it works for each product, and what the agent does. There is no checkout yet:
// prices are Ohvara's to set, a null price reads "Price set by Ohvara", and every choose button is
// disabled ("Available soon"). The old /agent/billing page is untouched.
// Mockup: ohvara/mockups/build-calendar-clients-and-plan-billing-.html.

// What a tier includes, from its product_keys (the row has no list of its own yet). A tier on top
// of Servicing lists "Everything in Servicing" plus what it adds.
const PRODUCT = {
  cancellations: { blurb: 'We cancel your clients’ old policies with the carrier.', items: ['Cancellation calls booked from Clients', 'Fulfillment calls the carrier for you'] },
  servicing: { blurb: 'We keep your policies on the books.', items: ['Everything in Cancellations', 'Packet check and review call', 'Changes, lapse saves and claims help', '12-month chargeback watch'] },
  booked_appointments: { blurb: 'New people booked on your calendar.', items: ['Booked appointments each month', 'Reminders and no-show rebooking'] },
  live_calls: { blurb: 'People who need help now, sent to you live.', items: ['Live transfers from an Ohvara VA', 'Booked on your calendar when you’re away'] },
}
const BASES = ['servicing', 'cancellations']
const BASE_NAME = { servicing: 'Servicing', cancellations: 'Cancellations' }

function tierContents(t) {
  const keys = t.product_keys || []
  const base = BASES.find(k => keys.includes(k))
  const extras = keys.filter(k => !BASES.includes(k) && PRODUCT[k])
  const items = []
  if (extras.length) {
    if (base) items.push({ text: `Everything in ${BASE_NAME[base]}` })
    for (const k of extras) for (const text of PRODUCT[k].items) items.push({ text, plus: !!base })
  } else if (base) {
    for (const text of PRODUCT[base].items) items.push({ text })
  }
  const blurb = t.description || PRODUCT[extras[extras.length - 1] || base]?.blurb || null
  return { items, blurb, live: keys.includes('live_calls') }
}

const priceText = cents => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0 })

function Tier({ t }) {
  const { items, blurb, live } = tierContents(t)
  const priced = Number.isInteger(t.price_cents)
  return (
    <article className="ov-card pv-card pv-tier" aria-label={t.name}>
      <div><h3>{t.name}</h3>{blurb && <p className="pv-sub">{blurb}</p>}</div>
      <div className="pv-price">
        {priced ? <b className="mono">{priceText(t.price_cents)}</b> : <b>Price set by Ohvara</b>}
        <span>per month, paid upfront</span>
      </div>
      {items.length > 0 && <ul className="pv-inc">{items.map(i => <li key={i.text} className={i.plus ? 'plus' : undefined}>{i.text}</li>)}</ul>}
      {live && <p className="pv-must"><Ico icon={CircleAlert} size={16} />You must be active in Ohvara to get live transfers.</p>}
      <button type="button" className="pv-soon" disabled aria-disabled="true">Available soon</button>
    </article>
  )
}

function Tiers() {
  const { data, isLoading, isError, refetch } = useMembershipTiers()
  if (isError) return <ErrorCard title="We couldn't load the plans" text="Try again in a moment." onRetry={() => refetch()} />
  if (isLoading) {
    return (
      <div className="pv-tiers">
        {[0, 1, 2, 3].map(i => (
          <section key={i} className="ov-card pv-card pv-tier" aria-busy="true">
            <Skel w="60%" h={20} /><Skel w="100%" h={56} style={{ borderRadius: 14 }} /><Skel w="80%" h={14} /><Skel w="70%" h={14} />
            <Skel w="100%" h={44} style={{ borderRadius: 999 }} />
          </section>
        ))}
      </div>
    )
  }
  if (!data.length) {
    return (
      <section className="ov-card pv-card pv-empty">
        <h3>Plans are being set up</h3>
        <p className="pv-sub">Ohvara is finishing what each plan includes. You can still read how it works below.</p>
      </section>
    )
  }
  return <div className="pv-tiers">{data.map(t => <Tier key={t.key} t={t} />)}</div>
}

function YourPlan() {
  const { profile } = useAuth()
  const { data } = useMembershipTiers()
  const mine = (data || []).find(t => t.key === profile?.membership_tier)
  return (
    <section className="ov-hero pv-hero" aria-label="Your plan">
      <p className="pv-sub" style={{ fontWeight: 600 }}>Your plan</p>
      <p style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 34, letterSpacing: '-0.03em', lineHeight: 1.1, margin: '8px 0 12px' }}>
        {mine ? mine.name : 'No plan yet'}
      </p>
      <div className="pv-chips"><span className="ov-hero-chip">Paid upfront</span><span className="ov-hero-chip">Checkout opens once prices are set</span></div>
    </section>
  )
}

function How({ icon, tone, title, sub, steps, youDo }) {
  return (
    <section className="ov-card pv-card">
      <div className="pv-card-head">
        <span className={`pv-tile ${tone}`}><Ico icon={icon} size={20} /></span>
        <div className="pv-grow"><h3>{title}</h3><p className="pv-sub">{sub}</p></div>
      </div>
      <ol className="pv-nsteps">{steps.map(s => <li key={s}>{s}</li>)}</ol>
      <div className="pv-youdo"><h4>What you do</h4><ul>{youDo.map(s => <li key={s}>{s}</li>)}</ul></div>
    </section>
  )
}

function Note({ icon, title, children }) {
  return (
    <section className="ov-card pv-card pv-after">
      <span className="pv-tile a"><Ico icon={icon} size={20} /></span>
      <div className="pv-grow"><h3>{title}</h3><p className="pv-sub" style={{ marginTop: 4 }}>{children}</p></div>
    </section>
  )
}

export default function Plan() {
  return (
    <PortalV2Layout active="plan" crumb="Account" title="Plan & billing" icon={CreditCard}>
      <div className="pv-ph1"><h1>Plan &amp; billing</h1><p className="pv-sub">Membership is paid upfront each month. Read how each plan works before you choose.</p></div>
      <YourPlan />
      <div className="pv-hd" style={{ margin: '8px 4px -4px' }}><h2>Plans</h2><span className="pv-sub">Prices are set by Ohvara</span></div>
      <Tiers />
      <div className="pv-hd" style={{ margin: '14px 4px -4px' }}><h2>How it works</h2><span className="pv-sub">What we do with every inbound, and what you do</span></div>
      <div className="pv-how">
        <How
          icon={Phone} tone="b" title="Live Calls" sub="People who already have a policy and want help now"
          steps={[
            'They call in, or pick a time for us to call them.',
            'An Ohvara VA answers and asks a few questions.',
            'If you’re active, the VA transfers the call to you live. Your portal rings and your phone gets a push.',
            'If you’re not active, the VA books them on your calendar at the first open time within the hour.',
          ]}
          youDo={['Turn on Active when you can take calls. You must be active to get live transfers.', 'Pick up when it rings.', 'Mark each one Sold, Follow up or Not interested.']}
        />
        <How
          icon={CalendarDays} tone="a" title="Booked Appointments" sub="Homeowners asking about mortgage protection"
          steps={[
            'They fill in a short form.',
            'An Ohvara VA calls them right away.',
            'They’re booked on your calendar.',
            'They get a confirmation, a reminder the day before and one an hour before, each with a link to move the time.',
            'If they don’t show, the VA rebooks them within the hour, up to twice.',
            'If we can’t reach them, we call or text on day 0, 1, 3 and 7, then once a month. We stop when they reply, book or ask us to stop.',
          ]}
          youDo={['Show up at the booked time.', 'Mark each one Sold, Follow up or Not interested.']}
        />
      </div>
      <Note icon={Check} title="After a sale">
        Mark it Sold and they become your client. Servicing starts on its own: we check the policy packet, book a review call and watch for chargebacks for 12 months.
      </Note>
      <Note icon={CreditCard} title="Payment">
        You&rsquo;ll pay for your plan upfront each month. Checkout opens here once Ohvara sets the prices. Nothing is charged today.
      </Note>
    </PortalV2Layout>
  )
}
