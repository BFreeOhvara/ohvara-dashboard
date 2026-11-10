import { CircleCheck, CircleDashed, Rocket } from 'lucide-react'
import { Chip } from './kit'
import './p941.css'

// P941 — the agent's own setup progress: the same steps, in the same words, as the admin's Setup ticket (launchChecks,
// who: 'agent'). Each is a tick or what's next. Settings › Your setup always shows it; Overview shows it until their
// leads are live. Agent words only, no engine or ad-platform names (AGENT_WORDS and agentText in setup.js).

export function SetupProgress({ view, compact = false }) {
  if (!view) return null
  const { checks, live, signup } = view
  const { list, passed } = checks
  return (
    <div className={`sp${compact ? ' is-compact' : ''}`} data-testid="setup-progress">
      <div className="sp-top">
        <span className="sp-ic" aria-hidden="true"><Rocket size={18} /></span>
        <span className="tp-grow"><b>{live ? 'Your leads are live' : 'Getting your leads live'}</b>
          <small>{live ? `Every step done. Signed up ${signup.paid?.short || view.data.paid?.short || ''}`.trim() : `${passed} of ${list.length} steps done. We’ll tell you the moment your leads start.`}</small></span>
        <Chip tone={live ? 'green' : 'blue'}>{passed} of {list.length}</Chip>
      </div>
      <ol className="sp-list" aria-label="Setup steps">
        {list.map(x => (
          <li key={x.key} className={x.ok ? 'is-ok' : 'is-open'}>
            {x.ok ? <CircleCheck size={16} aria-label="Done" /> : <CircleDashed size={16} aria-label="Not yet" />}
            <span className="tp-grow"><b>{x.label}</b><small>{x.text}</small></span>
          </li>
        ))}
      </ol>
    </div>
  )
}
