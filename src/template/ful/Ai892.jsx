// P892 — the VA's "From the AI" card, RETIRED by P902 (Brayden, Nov 7 23:12): the AI never hands a new lead to a VA.
// Asks for a person, or about coverage or price → "Your agent will go over that with you" → Check agent → transfer,
// or book. The card renders nothing; Queue.jsx still imports it until the VA Queue goes (P907), and the old sample
// rows' fromAi fields are ignored.
export function FromAi() {
  return null
}
