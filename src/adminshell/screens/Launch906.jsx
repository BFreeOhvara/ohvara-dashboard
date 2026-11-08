import { useState } from 'react'
import { Bot, Megaphone, CalendarCheck, CalendarClock, Moon, Gauge, Lock } from 'lucide-react'
import { Switch, SampleTag, useNote } from '../../template/kit'
import { Dropdown } from '../kit'
import { useAdmSettings, useAdmActions, useAdmSource } from '../data'
import { useCheckSettings, setCheckSettings } from '../../template/checkSettings'
import { hourText } from '../../lib/priceBook'
import SampleSwitch from '../SampleSwitch'
import { callAdsOn, setCallAdsOn } from '../splitStore'

// P906 — Settings › Switches opens with tonight's launch switches in one place: the AI caller, call ads (Google), sample
// data, the monthly check timing, the booking gap, the nightly charge time, the max daily spend and the founding lock.
// Each one is the same setting its own page holds (AI caller, Lead split, Clients › Servicing, Pay rules), so a change
// here shows there too. Sample until the backend saves them; Show sample data is the real switch when signed in.
const GAPS = [30, 45, 60, 90].map(m => ({ value: m, label: `${m} minutes` }))
const HOURS = [17, 18, 19, 20, 21, 22].map(h => ({ value: h, label: `${hourText(h)} Central` }))
const MAXES = [300, 400, 500, 750, 1000].map(n => ({ value: n, label: `$${n} a day` }))
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(String(v).replace(/[^0-9]/g, '')) || lo))
// A small number box that saves when you leave it (or press Enter), not on every key.
function NumIn({ value, lo, hi, label, onSave }) {
  const [v, setV] = useState(String(value))
  const [was, setWas] = useState(value)
  if (was !== value) { setWas(value); setV(String(value)) }
  const commit = () => { const n = clamp(v, lo, hi); setV(String(n)); if (n !== value) onSave(n) }
  return <input className="tp-num" inputMode="numeric" aria-label={label} value={v} onChange={e => setV(e.target.value.replace(/[^0-9]/g, ''))} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} />
}

function Row({ icon: Icon, title, sub, children }) {
  return (
    <li className="fx-form-row fx-form-sw">
      <div className="tp-grow"><b><Icon size={14} aria-hidden="true" /> {title}</b><p className="tp-sub">{sub}</p></div>
      {children}
    </li>
  )
}

export function LaunchSwitches({ live }) {
  const { data: s } = useAdmSettings()
  const { setSwitch, saveBilling, setBookingGap } = useAdmActions()
  const src = useAdmSource()
  const check = useCheckSettings()
  const note = useNote()
  const [calls, setCalls] = useState(callAdsOn)
  const b = s.billing
  const bill = (patch, words) => { if (!saveBilling) { note('Saved on Pay rules once billing is wired'); return } saveBilling({ ...b, ...patch }); note(`${words} (sample)`) }
  const ai = !!s.switches.ai_caller_live
  return (
    <div className="adm-swgroup adm-launch">
      <h3 className="fx-h3">Tonight's switches {src !== 'real' && <SampleTag>Sample</SampleTag>}</h3>
      <ul className="tp-list">
        <Row icon={Bot} title="AI caller" sub="On: the AI calls every new form lead right away and books it, transfers it to the agent, or marks No answer. It never hands a new lead to a VA.">
          <Switch on={ai} label="AI caller" onChange={v => { setSwitch('ai_caller_live', v); note(`AI caller ${v ? 'on' : 'off'} (sample)`) }} />
        </Row>
        <Row icon={Megaphone} title="Call ads (Google)" sub={calls ? 'On: transfer agents’ spend splits between form ads and call ads (Settings › Lead split).' : 'Off at launch: all spend goes to Meta form ads.'}>
          <Switch on={calls} label="Call ads (Google)" onChange={v => { setCallAdsOn(v); setCalls(v); note(`Call ads ${v ? 'on' : 'off'} (sample)`) }} />
        </Row>
        <SampleSwitch live={live} bare />
        <Row icon={CalendarCheck} title="Monthly check timing" sub={`Agents are asked "Still on the books?" ${check.delayDays} days after each draft, monthly for ${check.monthlyFor} months, then every ${check.thenEvery}.`}>
          <span className="adm-launch-pair">
            <NumIn label="Days after the draft" value={check.delayDays} lo={0} hi={14} onSave={n => { setCheckSettings({ delayDays: n }); note(`Asked ${n} days after the draft (sample)`) }} />
            <NumIn label="Monthly for (months)" value={check.monthlyFor} lo={1} hi={36} onSave={n => { setCheckSettings({ monthlyFor: n }); note(`Monthly for ${n} months (sample)`) }} />
            <NumIn label="Then every (months)" value={check.thenEvery} lo={1} hi={12} onSave={n => { setCheckSettings({ thenEvery: n }); note(`Then every ${n} months (sample)`) }} />
          </span>
        </Row>
        <Row icon={CalendarClock} title="Booking gap" sub="Kept free around every booked call, for agents and VAs. The server refuses a booking inside it.">
          <Dropdown className="adm-dd-sm" label="Booking gap" value={s.bookingGap ?? 30} options={GAPS} onChange={v => { if (!setBookingGap) { note('Saved once the booking backend reads it'); return } setBookingGap(v); note(`Booking gap ${v} minutes (sample)`) }} />
        </Row>
        <Row icon={Moon} title="Nightly charge time" sub={`Cards are charged tomorrow's spend plus 12% at this time; a decline retries at ${hourText(b.retryHour)}.`}>
          <Dropdown className="adm-dd-sm" label="Nightly charge time" value={b.chargeHour} options={HOURS} onChange={v => bill({ chargeHour: v }, `Nightly charge at ${hourText(v)}`)} />
        </Row>
        <Row icon={Gauge} title="Max daily spend" sub="Per agent. Raise one agent from their page on Agents.">
          <Dropdown className="adm-dd-sm" label="Max daily spend" value={b.maxDaily} options={MAXES.some(m => m.value === b.maxDaily) ? MAXES : [...MAXES, { value: b.maxDaily, label: `$${b.maxDaily} a day` }]} onChange={v => bill({ maxDaily: v }, `Max $${v} a day`)} />
        </Row>
        <Row icon={Lock} title="Founding lock" sub={`The first ${b.foundingCount} paying agents keep today's prices for ${b.foundingMonths} months.`}>
          <span className="adm-launch-pair">
            <NumIn label="Founding agents" value={b.foundingCount} lo={0} hi={500} onSave={n => bill({ foundingCount: n }, `First ${n} agents`)} />
            <NumIn label="Founding lock in months" value={b.foundingMonths} lo={1} hi={60} onSave={n => bill({ foundingMonths: n }, `Locked for ${n} months`)} />
          </span>
        </Row>
      </ul>
    </div>
  )
}
