// Settings → Texting number (agents). Ohvara texts every client from ONE shared
// number (Brayden, Oct 29), so an agent never buys or manages one. Agents have
// no read source for the real number and it is not hardcoded: this says only
// whether texting is live, in plain words and with no digits.
//   textingNumberState({ smsLive, configLoaded }) -> { chip, line }
// chip is 'Live', 'Not live yet', or null while the config is still loading.

export const TEXTING_LIVE_LINE = "Your clients get texts from Ohvara's one shared number. You never buy or manage a number."
export const TEXTING_OFF_LINE = "Texting starts once carriers approve Ohvara's number."
export const TEXTING_LOADING_LINE = 'Checking the texting number…'

export function textingNumberState({ smsLive, configLoaded } = {}) {
  if (!configLoaded) return { chip: null, line: TEXTING_LOADING_LINE }
  if (smsLive) return { chip: 'Live', line: TEXTING_LIVE_LINE }
  return { chip: 'Not live yet', line: TEXTING_OFF_LINE }
}
