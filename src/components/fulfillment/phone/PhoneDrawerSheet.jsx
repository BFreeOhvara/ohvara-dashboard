import { PhoneSheet } from '../../agent/phone/PhoneSheet'

// Prompt 773 — on a Fulfillment rep's phone a call's details open as a bottom
// sheet (P772's pattern) instead of the side drawer. Same props as
// ClientDrawer, so CallDrawer keeps every field and action and only swaps its
// shell: the header's title sits next to the X, its body (avatar, name,
// status, Call and Message buttons) tops the sheet, the footer is pinned.

export function PhoneDrawerSheet({ name, onClose, header, footer, footerStyle, children }) {
  return (
    <PhoneSheet
      label={name} onClose={onClose}
      head={header?.title || <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--ov-mute)' }}>{name}</span>}
      foot={footer ? <div className="ph-foot-main pc-drawer-foot" style={footerStyle}>{footer}</div> : null}
    >
      <div className="pc-drawer">
        {header?.body && <div className="pc-drawer-head">{header.body}</div>}
        {children}
      </div>
    </PhoneSheet>
  )
}
