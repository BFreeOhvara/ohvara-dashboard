import { SPLIT_RULES } from '../lib/leadSplit'

// P889 lead split rules saved this visit (sample). P906: Settings › Switches flips call ads (Google) from the same rules.
export const splitStore = { rules: { ...SPLIT_RULES } }
export const callAdsOn = () => !!splitStore.rules.callAdsOn
export const setCallAdsOn = v => { splitStore.rules = { ...splitStore.rules, callAdsOn: !!v } }
