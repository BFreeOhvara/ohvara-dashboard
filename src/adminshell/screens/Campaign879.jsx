import { Megaphone, TriangleAlert } from 'lucide-react'
import { Chip } from '../../template/kit'
import { Block } from '../../template/Record'
import { EngineSlot } from '../kit'
import { campaignOf, CAMPAIGN_STATE, reviewHours } from '../p879'
import '../p879.css'

// P879 — the campaign piece for the agent drawer. P914: the Pilot block (switch, VA cost line, pilot to paid) and the
// Pilot results tab are gone: there is no pilot, every agent pays from day one. Agent results live on Revenue.

// N-A-02, N-A-04: the campaign's status and its time from the engine, with the reason; an alert when an ad is
// rejected or in review over 24 h (Jordan fixes and resubmits). Admin only; agents never see ads.
export function CampaignBlock({ agent }) {
  const c = campaignOf(agent.id)
  const [w, tone] = CAMPAIGN_STATE[c.status]
  const slow = c.status === 'in_review' && reviewHours(c) > 24
  return (
    <Block title="Campaign" sub="One campaign per agent in the Deedstone ad account" aside={<EngineSlot />}>
      <div className="fx-form-row"><Megaphone size={16} aria-hidden="true" /><span className="tp-grow"><b>{w}</b><small className="tp-sub">{c.at ? `Since ${c.at}` : 'No campaign yet'}{c.reason ? ` · ${c.reason}` : ''}</small></span><Chip tone={tone}>{w}</Chip></div>
      {(c.status === 'rejected' || slow) && <p className="adm-warn-t"><TriangleAlert size={13} aria-hidden="true" />{c.status === 'rejected' ? 'Rejected. Jordan fixes it and resubmits.' : `In review ${Math.floor(reviewHours(c))} h. Admins are alerted after 24 h.`}</p>}
    </Block>
  )
}
