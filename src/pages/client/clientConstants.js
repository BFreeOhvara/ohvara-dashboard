export const TIER_NAMES = { basic: 'Basic', pro: 'Pro', premium: 'Premium', elite: 'Elite' }

export const TIER_FEATURES = [
  { key: 'receptionist', icon: '📞', name: 'AI Receptionist',      desc: '24/7 inbound call handling — your AI answers every call, qualifies the caller, and books appointments.',           tiers: ['basic', 'pro', 'premium', 'elite'] },
  { key: 'textback',     icon: '💬', name: 'Missed Call Text Back', desc: 'When a call is missed, your AI texts the caller within seconds to re-engage them.',                                 tiers: ['basic', 'pro', 'premium', 'elite'] },
  { key: 'reviews',      icon: '⭐', name: 'Review Generation',    desc: 'After a job completes, your AI sends review requests to build your online reputation automatically.',                 tiers: ['pro', 'premium', 'elite'] },
  { key: 'followup',     icon: '🔁', name: 'Lead Follow-Up',       desc: 'Automatically follows up with leads who did not book, turning cold inquiries into appointments.',                    tiers: ['pro', 'premium', 'elite'] },
  { key: 'reminders',    icon: '🔔', name: 'Appointment Reminders', desc: 'Automated SMS reminders reduce no-shows and keep your calendar full.',                                               tiers: ['pro', 'premium', 'elite'] },
  { key: 'dispatcher',   icon: '🗂', name: 'AI Dispatcher',        desc: 'Routes incoming jobs to the right technician based on availability, location, and skill.',                           tiers: ['premium', 'elite'] },
  { key: 'sms',          icon: '📣', name: 'SMS Marketing',        desc: 'Send targeted text campaigns to your customer list to drive repeat business.',                                       tiers: ['premium', 'elite'] },
  { key: 'website',      icon: '🌐', name: 'Professional Website',  desc: 'A custom website optimized for your local market, included with your Elite plan.',                                  tiers: ['elite'] },
  { key: 'multiagent',   icon: '🤖', name: 'Multiple AI Agents',   desc: 'Deploy up to 5 AI lines simultaneously — ideal for high-volume businesses.',                                        tiers: ['elite'] },
]

export const TIER_ORDER = ['basic', 'pro', 'premium', 'elite']
