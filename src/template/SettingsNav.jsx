import { ChevronRight } from 'lucide-react'
import { initials } from './kit'
import { avatarHue } from './avatarHue'
import './settings924.css'

// P924 — Settings in every portal (agent, VA, admin): a left list of sections and one section on the right. The page
// never scrolls on a desktop, so the header always stays; a long section scrolls inside itself, with Save pinned to
// its bottom. On a phone the list is a row of sections above the section.
export function SettingsNav({ name, role, tabs, value, onChange, children }) {
  return (
    <nav className="fx-tile st-nav" aria-label="Settings sections">
      <div className="st-who">
        <span className={`st-av av-${avatarHue(name || '')}`} aria-hidden="true">{initials(name || '').toUpperCase()}</span>
        <span className="tp-grow"><b>{name}</b><small>{role}</small></span>
      </div>
      <ul className="st-list" role="tablist" aria-orientation="vertical" aria-label="Settings sections">
        {tabs.map(([key, label, Icon]) => (
          <li key={key}>
            <button type="button" role="tab" aria-selected={value === key} className={`st-item${value === key ? ' is-on' : ''}`} onClick={() => onChange(key)}>
              {Icon && <Icon size={17} aria-hidden="true" />}<span className="tp-grow">{label}</span><ChevronRight size={15} className="st-chev" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {children}
    </nav>
  )
}
