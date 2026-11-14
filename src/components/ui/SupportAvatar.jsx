import { OhvaraMark } from './OhvaraMark'
import './supportAvatar.css'

// P1001 — Ohvara Support's avatar: the Ohvara logo (big piece navy, wing teal, the site header mark's colours; see
// brain/Gotchas "The Ohvara logo") on a white disc, the same in every portal, on desktop and phone, for every viewer.
// `className` carries the host avatar's own size class (tp-av, ma-ini, fx-av ...); `style` its size variable.
export function SupportAvatar({ className = '', style }) {
  return (
    <span className={`${className} ov-support-av`} style={style} aria-hidden="true">
      <OhvaraMark height="58%" front="#0A1F44" back="#00BFA6" />
    </span>
  )
}
