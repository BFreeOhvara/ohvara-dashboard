import { TodayCards } from '../../../components/agent/TodayCards'

// Today (v2): its cards moved into components/agent/TodayCards.jsx (portal parity T3), which the
// old Overview at /agent renders under its hero when the v2 portal is on. This page keeps working
// for anything still pointing at it: the same cards, with Texts waiting as its own card.
export default function Today() {
  return <TodayCards showTexts />
}
