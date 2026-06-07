// ============================================================
// Ohvara Stack Recommendation Engine
// Transparent scoring — update TIERS or SCORING_RULES to change behavior.
// ============================================================

export const TIERS = {
  starter: {
    name: 'Starter',
    price: 497,
    features: 'AI Receptionist/Dispatcher + Missed Call Text Back',
    color: 'blue',
  },
  growth: {
    name: 'Growth',
    price: 797,
    features: 'Starter + Review Generation + Lead Follow-Up Automation',
    color: 'indigo',
  },
  full_stack: {
    name: 'Full Stack',
    price: 1297,
    features: 'Everything + Website',
    color: 'purple',
  },
}

// Niches that rely heavily on inbound calls — push toward Full Stack
const HIGH_INBOUND_NICHES = [
  'roofing', 'hvac', 'electrical', 'trucking', 'plumbing',
  'towing', 'emergency', 'restoration', 'locksmith', 'pest control',
]

// Keywords in rep notes / pain points that signal urgency
const URGENCY_KEYWORDS = [
  'missing calls', 'miss calls', 'losing jobs', 'lost jobs',
  'too busy', 'cant answer', "can't answer", 'no one answering',
  'always busy', 'overwhelmed',
]

/**
 * recommendStack(lead)
 * Returns { tier, score, reasons } where tier is one of TIERS.
 * Score range: 0–7 | 0–2 → Starter | 3–4 → Growth | 5+ → Full Stack
 */
export function recommendStack(lead) {
  let score = 0
  const reasons = []

  // --- Labor cost signal (strongest indicator) ---
  const cost = parseFloat(lead.monthly_labor_cost) || 0
  if (cost > 3200) {
    score += 3
    reasons.push(`High labor cost ($${cost.toLocaleString()}/mo) — Full Stack ROI is immediate`)
  } else if (cost >= 2800) {
    score += 2
    reasons.push(`Moderate labor cost ($${cost.toLocaleString()}/mo) — Growth tier pays for itself`)
  } else if (cost > 0) {
    score += 1
    reasons.push(`Labor cost present ($${cost.toLocaleString()}/mo)`)
  }

  // --- Niche signal ---
  const nicheText = (lead.niche || '').toLowerCase()
  if (HIGH_INBOUND_NICHES.some(n => nicheText.includes(n))) {
    score += 2
    reasons.push(`High-inbound niche (${lead.niche}) — call volume is a core problem`)
  }

  // --- Job title signal ---
  const jobTitle = (lead.job_title || '').toLowerCase()
  if (jobTitle.includes('dispatcher')) {
    score += 2
    reasons.push(`Dispatcher role — AI Dispatcher angle is the lead hook`)
  } else if (jobTitle.includes('receptionist') || jobTitle.includes('admin')) {
    score += 1
    reasons.push(`Front-office role — AI Receptionist replaces or augments`)
  }

  // --- Rep notes / pain points urgency ---
  const combined = `${lead.pain_points || ''} ${lead.notes || ''}`.toLowerCase()
  if (URGENCY_KEYWORDS.some(k => combined.includes(k))) {
    score += 1
    reasons.push(`Rep notes flag call-handling urgency`)
  }

  // --- Map score to tier ---
  let tier
  if (score >= 5) tier = TIERS.full_stack
  else if (score >= 3) tier = TIERS.growth
  else tier = TIERS.starter

  return { tier, score, reasons }
}

/**
 * Build a concise pitch anchor sentence from the recommendation.
 * Used as fallback when the Claude-generated anchor isn't loaded yet.
 */
export function buildPitchAnchorTemplate(lead, { tier }) {
  const cost = parseFloat(lead.monthly_labor_cost)
  if (cost > 0 && tier.name !== 'Starter') {
    const saving = Math.round(cost - tier.price)
    return `At $${cost.toLocaleString()}/month for their ${lead.job_title || 'staff'}, the ${tier.name} at $${tier.price.toLocaleString()}/month saves them $${saving.toLocaleString()} monthly from day one.`
  }
  return `${tier.name} at $${tier.price.toLocaleString()}/month is the right fit for ${lead.business_name || 'this business'} based on their profile.`
}
