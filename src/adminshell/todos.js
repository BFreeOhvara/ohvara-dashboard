// P914 — admin To-dos (was "Needs you" on Overview): a clean list of real admin jobs, each with one action. Plain data
// in, rows out (no React), so it runs under node --test. The Overview hands it what the admin data already has.
//   unassigned  leads that matched no agent (no agent ID in the link, no Meta campaign ID)  → Assign
//   pipeline    Setup tickets: launch checks waiting, a campaign request that failed, a launched campaign paused  → Open ticket
//   failed      agents whose card was declined (their leads stop until it's fixed)  → See bill
//   cover       days ahead with fewer VAs on shift than the minimum once days off come out  → Open rota
//   ads         an ad rejected, or in review over 24 h  → Open agent
//   states      P949: an agent changed their states; their campaign needs the new ones by the next day  → Open agent, Done
// Order: money and leads first (a lead waiting, a declined card), then launches, then the team, then ads.
// P945: no "Call past its time · Give it": a booked call nobody starts moves on by itself (lib/callEscalation.js),
// so it never needs an admin. The Overview has a Calendar shortcut instead.

export function shortCover({ rota = {}, dayOff = [], days = [], min = 2, nameOf = id => id }) {
  return days.flatMap(d => {
    const off = dayOff.filter(x => x.date === d && x.status !== 'declined').map(x => x.va_id)
    const on = (rota[d] || []).filter(id => !off.includes(id))
    return on.length < min ? [{ day: d, on: on.length, min, off: off.map(nameOf) }] : []
  })
}

export function adminTodos({ unassigned = [], pipeline = [], failed = [], cover = [], ads = [], states = [], react = [], ap, money = n => `$${n}`, dayText = d => String(d), agentName = id => id }) {
  const rows = []
  for (const l of unassigned) {
    rows.push({ id: `lead-${l.id}`, kind: 'lead', tone: 'warn', title: 'Lead not matched to an agent', sub: `${l.name} · ${[l.city, l.state].filter(Boolean).join(', ')} · came in ${l.came}`, action: 'Assign', to: ap('leads', l.id) })
  }
  for (const a of failed) {
    const f = a.billing?.failed || {}
    rows.push({ id: `card-${a.id}`, kind: 'card', tone: 'warn', title: 'Card declined', sub: `${a.name} · ${f.what || 'Charge'}${f.amount != null ? ` · ${money(f.amount)}` : ''} · leads stop until it's fixed`, action: 'See bill', to: `${ap('billing')}?tab=agents` })
  }
  for (const c of pipeline) {
    if (c.paused) rows.push({ id: `paused-${c.id}`, kind: 'launch', tone: 'warn', title: 'Campaign paused', sub: `${c.name} · ${c.checks?.failed?.[0]?.why || 'a launch check broke'}`, action: 'Open ticket', to: ap('setup', c.id) })
    else if (c.req === 'failed') rows.push({ id: `req-${c.id}`, kind: 'launch', tone: 'warn', title: 'Campaign request failed', sub: `${c.name}${c.campaignReq?.why ? ` · ${c.campaignReq.why}` : ''}`, action: 'Open ticket', to: ap('setup', c.id) })
    else if (c.stage === 'checks') rows.push({ id: `checks-${c.id}`, kind: 'launch', tone: 'teal', title: 'Launch checks waiting', sub: `${c.name} · ${c.checks ? `${c.checks.passed} of ${c.checks.list.length} pass` : 'not run yet'}`, action: 'Open ticket', to: ap('setup', c.id) })
  }
  for (const g of cover) {
    rows.push({ id: `cover-${g.day}`, kind: 'cover', tone: 'blue', title: 'Shift short on cover', sub: `${dayText(g.day)} · ${g.on} of ${g.min} VAs on shift${g.off.length ? ` · ${g.off.join(', ')} off` : ''}`, action: 'Open rota', to: `${ap('team')}?tab=rota` })
  }
  // P949: { id, agentId, name, diff: '+FL, −GA', states, startsText, onDone }
  for (const c of states) {
    rows.push({ id: `states-${c.id}`, kind: 'states', tone: 'blue', title: `Update ad states for ${c.name}: ${c.diff}`, sub: `From ${c.startsText}: ${c.states.join(', ')}`, action: 'Open agent', to: ap('agents', c.agentId), onDone: c.onDone })
  }
  // P952: an old-lead list that paused itself (too many people asked us to stop calling).
  for (const l of react) {
    // P957: lots of AI calls and nothing paid yet.
    if (l.watch) { rows.push({ id: `react-${l.id}`, kind: 'reactivation', tone: 'warn', title: 'Your own leads: many calls, nothing paid', sub: `${l.agent || 'An agent'} · ${l.calls} calls · ${money(Math.round((l.cost_cents || 0) / 100))} AI cost`, action: 'Open', to: `${ap('leads')}?view=reactivation` }); continue }
    rows.push({ id: `react-${l.id}`, kind: 'reactivation', tone: 'warn', title: 'Imported list paused', sub: `${l.agent || 'An agent'} · ${l.name}${l.pause_reason ? ` · ${l.pause_reason}` : ''}`, action: 'Open list', to: `${ap('leads')}?view=reactivation` })
  }
  for (const x of ads) {
    rows.push({ id: `ad-${x.agent}`, kind: 'ad', tone: 'warn', title: x.kind === 'rejected' ? 'Ad rejected' : 'Ad in review over 24 h', sub: `${agentName(x.agent)} · ${x.text}`, action: 'Open agent', to: ap('agents', x.agent) })
  }
  return rows
}
