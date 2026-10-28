// The lead follow-up texts, one per stage, copied word for word from the vault
// note ohvara/leads/text-stage-map.md ("Drafts", stages 1-3). Each names the
// assigned agent and says Ohvara texts with them, as consent draft A in
// brain/ohvara/research/Texting On Behalf.md does; none starts "Ohvara: Hi".
// The opted_out stage has no text: nothing is ever sent to it.
// No Deno APIs, so node --test can load it.

export type Stage = 'just_submitted' | 'not_reached' | 'reached' | 'opted_out'
export type SendStage = Exclude<Stage, 'opted_out'>

export type Template = { body: string; needsLink: boolean }

// DRAFT: not approved, not A2P-registered
export const DRAFT_JUST_SUBMITTED =
  'Hi [Lead first name], this is [Agent first name], a licensed agent, texting with Ohvara about the mortgage protection info you asked for. Reply STOP to opt out.'

// DRAFT: not approved, not A2P-registered
export const DRAFT_NOT_REACHED =
  'Hi [Lead first name], [Agent first name] here, a licensed agent texting with Ohvara. Still want help with mortgage protection? Reply here for the next step. Reply STOP to opt out.'

// DRAFT: not approved, not A2P-registered
export const DRAFT_REACHED =
  'Hi [Lead first name], [Agent first name] here, a licensed agent texting with Ohvara. Good to talk. If you have more questions, reply here. Reply STOP to opt out.'

// No draft has a link yet (question 2 in the note). A template that adds
// "[Booking link]" must set needsLink so a missing LEAD_BOOKING_URL skips it.
export const TEMPLATES: Record<SendStage, Template> = {
  just_submitted: { body: DRAFT_JUST_SUBMITTED, needsLink: false },
  not_reached: { body: DRAFT_NOT_REACHED, needsLink: false },
  reached: { body: DRAFT_REACHED, needsLink: false },
}

// Fill the brackets. No lead first name → "Hi, …" rather than "Hi , …".
export function fill(t: Template, v: { agentFirst: string; leadFirst: string | null; link: string | null }): string {
  let s = t.body
  s = v.leadFirst ? s.replace('[Lead first name]', v.leadFirst) : s.replace('Hi [Lead first name], ', 'Hi, ')
  s = s.replace('[Agent first name]', v.agentFirst)
  if (v.link) s = s.replace('[Booking link]', v.link)
  return s
}
