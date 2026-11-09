import TemplateFrame from '../TemplateFrame'
import MobileFrame from './MobileFrame'

// P908 — below 768 px the agent side is the phone build (src/template/m), not the desktop squeezed. Same addresses,
// same data; 768 px and up is the desktop exactly as it was.
import { usePhone } from './phone'

// The frame: the phone frame (bottom tabs) or the desktop frame (pill tabs + rail).
export function ShellFrame() { return usePhone() ? <MobileFrame /> : <TemplateFrame /> }

// One page: its phone build or its desktop screen.
export function Pick({ d: Desk, m: Phone }) { return usePhone() && Phone ? <Phone /> : <Desk /> }
