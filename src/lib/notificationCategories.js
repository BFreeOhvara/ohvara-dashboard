// Notification categories a user can individually toggle in Settings
// (Prompt 226). Scoped per role — only categories with a real producer for
// that role are listed; admin's NotificationBell (new_client/client_live) is
// a separate, uncategorized legacy stream and isn't included here, and
// client has no bell at all.
export const REP_NOTIFICATION_CATEGORIES = [
  { key: 'message',                    label: 'Message replies',        description: 'Brayden or Nate replied to a message you sent' },
  { key: 'deal_closed',                label: 'Deal closed',            description: 'One of your booked appointments closed' },
  { key: 'badge',                      label: 'Badges & achievements',  description: 'You unlocked a new badge' },
  { key: 'leads_unlocked',             label: 'Leads ready',            description: "Today's batch is ready to call" },
  { key: 'follow_up',                  label: 'Follow-up reminders',    description: 'A follow-up you scheduled is coming due' },
  { key: 'call_graded',                label: 'Call graded',            description: 'One of your calls was graded' },
]

export const CLOSER_NOTIFICATION_CATEGORIES = [
  { key: 'message',                    label: 'Message replies',            description: 'Brayden or a rep replied to a message you sent' },
  { key: 'appointment_booked',         label: 'Appointment booked',         description: 'A rep booked a new appointment for you' },
  { key: 'appointment_reminder_5min',  label: 'Appointment reminders',      description: 'An appointment is starting in 5 minutes' },
  { key: 'call_graded',                label: 'Call graded',                description: 'One of your calls was graded' },
]

export function notificationCategoriesForRole(role) {
  if (role === 'rep') return REP_NOTIFICATION_CATEGORIES
  if (role === 'closer') return CLOSER_NOTIFICATION_CATEGORIES
  return []
}
