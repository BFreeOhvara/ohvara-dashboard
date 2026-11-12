import { needsResult, resultsFor, RESULT_STATUS } from './agentView.js'
import { clockNow } from './leadLifecycle.js'

// P978 — drag a lead that's waiting for its result onto the result's column (desktop Leads board only). Pure, no React.
// The agent can't move leads around freely (billing, delivered counts and servicing hand-offs hang on a result), so
// the drag is only a shortcut for what the Mark result menu already does:
//  1. only a lead waiting for its result can be picked up: the call (a booked time that has passed, or a live call
//     the agent took) happened and no result is marked. A ringing transfer hasn't happened yet, so it can't.
//  2. only the columns that are valid results for that lead take the drop: exactly the choices its Mark result menu
//     offers (agentView.js resultsFor), so No show only for a booked call.
export const DRAG_REFUSED = 'Use Mark result for this one'

export const dragResults = (l, now = clockNow()) => (l && l.stage !== 'ringing' && needsResult(l, now) ? resultsFor(l) : [])
export const canDrag = (l, now) => dragResults(l, now).length > 0
// board column (agentView status key) -> the result a drop there means, or null when that column refuses this lead
export const laneResults = (l, now) => Object.fromEntries(dragResults(l, now).map(k => [RESULT_STATUS[k], k]))
