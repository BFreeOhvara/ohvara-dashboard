import FulFrame from '../../ful/FulFrame'
import { usePhone } from '../phone'
import VaApp from './VaApp'

// P975 — below 768 px the VA side is the phone app (src/template/m/va), same addresses and data; 768 px and up is
// the desktop VA desk exactly as it was (FulFrame untouched).
export function VaShellFrame() { return usePhone() ? <VaApp /> : <FulFrame /> }
