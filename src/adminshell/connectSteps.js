// P1018 — Admin → Connect as one numbered checklist, in the order Jordan does it. Every step here is needed for launch;
// nothing is optional. What came off the page (kept in the code and the database, just not shown) and why:
//   * "New lead", "No-show" and "Opt-out" workflow IDs: a new lead gets no text, and no-shows and opt-outs are already
//     tagged on the contact (ohvara-no-show, ohvara-opted-out) without a workflow.
//   * Texting number, sender name, brand and campaign status: GoHighLevel sends every text from its own numbers under
//     Jordan's A2P registration; Ohvara never uses these values. Texts are switched on by Brayden once A2P is approved.
//   * Ad account IDs and weekly budgets: spend comes in with the API key (Ad Manager), and each agent's budget is set
//     by Ohvara per agent (the campaign on/off step), not here. Call ads are off at launch.
//   * Lead site domain and forms: leads arrive through the lead webhook; Ohvara never needs the domain or form names.
// Pure data and rules (no React), so the tests can check them.

export const HOOK_URL = 'https://jjextitmbptoaolacocs.supabase.co/functions/v1/ghl-webhook'
export const SECRET_HEADER = 'x-ohvara-ghl-secret'
export const CONTROL_PREFIX = 'https://services.leadconnectorhq.com/hooks/'
export const SECRET = { key: 'GHL_API_KEY', hook: 'GHL_WEBHOOK_SECRET', control: 'GHL_CONTROL_WEBHOOK_URL' }

const LOCATION_RE = /^[A-Za-z0-9]{6,64}$/
const WORKFLOW_RE = /^[A-Za-z0-9-]{6,64}$/

// field.kind: 'text' (saved on ghl_settings[column]) or 'secret' (saved encrypted, never shown back).
// copy: what Jordan copies FROM this page into GoHighLevel. test: what the Test button does.
export const CONNECT_STEPS = [
  {
    key: 'location', title: 'Your sub-account ID',
    what: 'The ID of the Deedstone sub-account in GoHighLevel, the one that runs the ads and the texts.',
    why: 'It tells Ohvara which GoHighLevel account its leads, contacts and texts belong to.',
    where: 'GoHighLevel → switch to the Deedstone sub-account → Settings → Business Profile → Location ID',
    how: [
      'Open GoHighLevel and switch to the Deedstone sub-account (top left), not the agency view.',
      'Click Settings at the bottom of the left menu, then Business Profile.',
      'Under General Information, find Location ID and click the copy icon next to it.',
      'Paste it below and press Save.',
      'Also fine: it is the part of the address after /location/ when you are inside the sub-account.',
    ],
    field: { kind: 'text', column: 'location_id', label: 'Location ID', placeholder: 'Paste the location ID' },
    test: 'ghl',
  },
  {
    key: 'key', title: 'Your GoHighLevel key',
    what: 'A private key (GoHighLevel calls it a Private Integration token) that lets Ohvara work inside that sub-account.',
    why: 'Ohvara uses it to put each lead\'s call result, tags and booking time on their GoHighLevel contact, so your text workflows fire, and to read what each agent\'s ads cost.',
    where: 'GoHighLevel → Deedstone sub-account → Settings → Private Integrations → Create new Integration',
    how: [
      'In the Deedstone sub-account, open Settings → Private Integrations.',
      'Click Create new Integration. Name it "Ohvara".',
      'Tick these permissions: View Contacts, Edit Contacts, and View Ad Publishing (in the list they read contacts.readonly, contacts.write and adPublishing.readonly).',
      'Click Create, then copy the token. GoHighLevel only shows it once.',
      'Paste it below and press Save, then press Test.',
    ],
    field: { kind: 'secret', secret: SECRET.key, label: 'GoHighLevel key', placeholder: 'Paste the token (starts with pit-)' },
    test: 'ghl',
  },
  {
    key: 'hook', title: 'A password for messages to Ohvara',
    what: 'A long password that GoHighLevel sends along with every message it sends to Ohvara.',
    why: 'Ohvara only accepts a message that carries this password, so nobody else can send fake leads into the portal.',
    where: 'Made here: press Make one. You paste it into GoHighLevel in steps 4, 5 and 6.',
    how: [
      'Press Make one. A new password fills the box.',
      'Press Copy and keep it somewhere safe for the next three steps (a note on your computer is fine for now).',
      'Press Save. After that Ohvara never shows it again.',
      `In steps 4, 5 and 6, every webhook gets a header named ${SECRET_HEADER} with this password as its value.`,
      'Lost it? Make a new one, save it, and update the header in those webhooks.',
    ],
    field: { kind: 'secret', secret: SECRET.hook, label: 'Password', placeholder: 'Press Make one, or paste your own', make: true },
    test: 'saved',
  },
  {
    key: 'leads', title: 'Send new leads to Ohvara',
    what: 'A webhook in each campaign\'s lead workflow that sends Ohvara every new form lead.',
    why: 'This lets a new lead from your Facebook ads land on the right agent and get their first call within seconds.',
    where: 'GoHighLevel → Automation → Workflows → the lead workflow → + → Custom Webhook',
    how: [
      'Open Automation → Workflows and open the workflow that runs when a Facebook form lead comes in.',
      'Click + under the trigger and pick Custom Webhook.',
      'Method: POST. URL: the address below (Copy).',
      `Headers: add ${SECRET_HEADER} with the password from step 3.`,
      'Body (custom data): ohvara_event = lead_created, agent_id = the agent\'s code (DS-XXXX, the one in the ad link), lead_type = booked_appointment, campaign_id = the Meta campaign ID, consent_text_version, intake_id, and is_test = true when you test. Name, phone and email go with it.',
      'Save and publish. Then send one lead with Meta\'s Lead Ads Testing Tool and press Test here.',
    ],
    copy: [{ label: 'Address', value: HOOK_URL }, { label: 'Header name', value: SECRET_HEADER }, { label: 'ohvara_event', value: 'lead_created' }],
    test: 'leads',
  },
  {
    key: 'campaigns', title: 'Tell Ohvara about each new campaign',
    what: 'A webhook that tells Ohvara the moment you create an agent\'s Meta campaign.',
    why: 'Ohvara ties the campaign to its agent, so spend and leads land on the right person and that agent\'s launch check ticks.',
    where: 'GoHighLevel → Automation → Workflows → the workflow you run after making a campaign → Custom Webhook',
    how: [
      'In the workflow you use when you set up an agent\'s campaign, add a Custom Webhook action.',
      `Method POST, the same address and the same ${SECRET_HEADER} header as step 4.`,
      'Body: ohvara_event = campaign_created, agent_id = the agent\'s code (DS-XXXX), fb_campaign_id = the Meta campaign ID (and campaign_id = GoHighLevel\'s own, if you have it), campaign_name.',
      'Run it once for a real or test campaign, then press Test here.',
    ],
    copy: [{ label: 'Address', value: HOOK_URL }, { label: 'ohvara_event', value: 'campaign_created' }],
    test: 'campaigns',
  },
  {
    key: 'replies', title: 'Send replies and opt-outs to Ohvara',
    what: 'Two small workflows: one when a lead texts back, one when a lead opts out (STOP).',
    why: 'A lead\'s reply shows on their record for the team, and an opt-out stops every text and call to them, everywhere.',
    where: 'GoHighLevel → Automation → Workflows → Create Workflow → trigger Customer Replied (and a second one: Contact DND)',
    how: [
      'Make a workflow with the trigger Customer Replied (channel: SMS).',
      `Add a Custom Webhook: POST, the same address, the ${SECRET_HEADER} header, body ohvara_event = reply and body = {{message.body}}.`,
      'Make a second workflow with the trigger Contact DND (DND turned on for SMS).',
      'Add the same Custom Webhook with ohvara_event = opt_out.',
      'Publish both, text the Deedstone number from your own phone, then press Test here.',
    ],
    copy: [{ label: 'Address', value: HOOK_URL }, { label: 'Reply', value: 'reply' }, { label: 'Opt-out', value: 'opt_out' }],
    test: 'replies',
  },
  {
    key: 'noAnswer', title: 'The "no answer" texts',
    what: 'The GoHighLevel workflow that texts a lead who didn\'t pick up our first call.',
    why: 'When a new lead misses the first call, Ohvara adds them to this workflow: a text right away with the booking link, then next morning, day 3, day 7, and check-ins on day 30, 60 and 90.',
    where: 'GoHighLevel → Automation → Workflows → open the workflow → the ID is in the address bar after /workflow/',
    how: [
      'Build the workflow with the texts above (the wording is on the Lead texts list Brayden sent you). Its trigger can be anything; Ohvara adds people to it.',
      'Publish it.',
      'Open it and copy the ID from the address bar: the part after /workflow/ (letters, numbers and dashes).',
      'Paste it below and press Save.',
    ],
    field: { kind: 'text', column: 'workflow_no_answer', label: 'Workflow ID', placeholder: 'Paste the workflow ID' },
    test: 'saved',
  },
  {
    key: 'reminder', title: 'The appointment reminder texts',
    what: 'The GoHighLevel workflow that confirms a booked call and reminds the lead before it.',
    why: 'When a lead books, Ohvara adds them here: a confirmation right away, then 6:30 PM the evening before, 8:30 AM that morning and 1 hour before, in the lead\'s time zone. Fewer no-shows.',
    where: 'GoHighLevel → Automation → Workflows → open the workflow → the ID is in the address bar after /workflow/',
    how: [
      'Build the reminder workflow with those texts and publish it.',
      'Open it and copy the ID from the address bar: the part after /workflow/.',
      'Paste it below and press Save.',
    ],
    field: { kind: 'text', column: 'workflow_appointment_reminder', label: 'Workflow ID', placeholder: 'Paste the workflow ID' },
    test: 'saved',
  },
  {
    key: 'control', title: 'Let Ohvara start and stop each agent\'s ads',
    what: 'The address of a GoHighLevel workflow (trigger: Inbound Webhook) that turns an agent\'s Meta campaign on or off and sets its daily budget.',
    why: 'Ads only run while the agent has paid and is live. Ohvara tells this workflow to start, stop or change an agent\'s campaign the moment that changes, so nobody spends money on an agent who paused or whose card failed.',
    where: 'GoHighLevel → Automation → Workflows → Create Workflow → Add New Trigger → Inbound Webhook → copy the URL',
    how: [
      'Create a workflow and pick the trigger Inbound Webhook. GoHighLevel shows its address: copy it.',
      'Paste it below and press Save.',
      'In the workflow, use the fields Ohvara sends: agent_code (DS-XXXX), run (true or false) and daily_budget, to turn that agent\'s Meta campaign on or off and set its budget.',
      'Publish it. Ohvara retries on its own if GoHighLevel doesn\'t answer.',
    ],
    field: { kind: 'secret', secret: SECRET.control, label: 'Workflow address', placeholder: `Paste the address (starts with ${CONTROL_PREFIX})` },
    test: 'control',
  },
]

// Is a pasted value the right shape? '' = fine, else what's wrong in plain words.
export function checkValue(step, v) {
  const s = String(v || '').trim()
  if (!s) return 'Paste it first.'
  if (step.key === 'location') return LOCATION_RE.test(s) ? '' : 'That doesn\'t look like a location ID: letters and numbers only, 6 to 64 of them.'
  if (step.key === 'noAnswer' || step.key === 'reminder') return WORKFLOW_RE.test(s) ? '' : 'That doesn\'t look like a workflow ID: letters, numbers and dashes only (the part after /workflow/).'
  if (step.key === 'control') return s.startsWith(CONTROL_PREFIX) ? '' : `That isn't an Inbound Webhook address. It must start with ${CONTROL_PREFIX}`
  if (step.key === 'hook') return s.length >= 24 ? '' : 'Make it at least 24 characters (press Make one).'
  if (step.key === 'key') return s.length >= 20 ? '' : 'That looks too short for a GoHighLevel key.'
  return ''
}

// A new webhook password: 40 letters and numbers from the browser's secure random source.
export function makePassword(rand = n => crypto.getRandomValues(new Uint8Array(n))) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return Array.from(rand(40), b => abc[b % abc.length]).join('')
}

// state: { settings (ghl_settings row or {}), secrets (Set of saved names), heard (admin_ghl_heard() or {}),
//          tested: { [stepKey]: true } (a Test that passed this visit) }
export function doneOf(step, state = {}) {
  const st = state.settings || {}
  const sec = state.secrets || new Set()
  const h = state.heard || {}
  switch (step.key) {
    case 'location': return !!st.location_id
    case 'key': return sec.has(SECRET.key)
    case 'hook': return sec.has(SECRET.hook)
    case 'leads': return Number(h.leads || 0) > 0
    case 'campaigns': return Number(h.campaigns || 0) > 0
    case 'replies': return !!(h.reply_at || h.opt_out_at)
    case 'noAnswer': return !!st.workflow_no_answer
    case 'reminder': return !!st.workflow_appointment_reminder
    case 'control': return sec.has(SECRET.control)
    default: return false
  }
}
export function progressOf(state) {
  const done = CONNECT_STEPS.filter(s => doneOf(s, state)).length
  return { done, total: CONNECT_STEPS.length, next: CONNECT_STEPS.find(s => !doneOf(s, state))?.key || null }
}

const when = iso => { try { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return '' } }
const OFF = ' Ohvara only takes these in once Brayden turns the GoHighLevel connection on, so if you just sent one, tell him and test again after.'
// The plain-words answer for the "has it arrived?" tests (steps 4-6), from admin_ghl_heard().
export function heardAnswer(step, h = {}) {
  if (step.key === 'leads') return Number(h.leads || 0) > 0
    ? { ok: true, message: `Working. The last lead arrived ${when(h.lead_at)}${h.test_lead_at ? ` (last test lead ${when(h.test_lead_at)})` : ''}.` }
    : { ok: false, message: `No lead has arrived yet. Send one with Meta's Lead Ads Testing Tool, wait a minute, then test again.${h.bridge_on ? '' : OFF}` }
  if (step.key === 'campaigns') return Number(h.campaigns || 0) > 0
    ? { ok: true, message: `Working. Ohvara knows ${h.campaigns} campaign${Number(h.campaigns) === 1 ? '' : 's'}; the last one came in ${when(h.campaign_at)}.` }
    : { ok: false, message: `No campaign has come in yet. Run the webhook once, then test again.${h.bridge_on ? '' : OFF}` }
  if (step.key === 'replies') return h.reply_at || h.opt_out_at
    ? { ok: true, message: `Working. ${h.reply_at ? `Last reply ${when(h.reply_at)}. ` : ''}${h.opt_out_at ? `Last opt-out ${when(h.opt_out_at)}.` : 'No opt-out yet (text STOP from a test phone to check it).'}`.trim() }
    : { ok: false, message: `Nothing has come in yet. Text the Deedstone number from your phone, then test again.${h.bridge_on ? '' : ' Opt-outs (STOP) are taken in even now; replies wait until Brayden turns the connection on.'}` }
  return { ok: false, message: '' }
}
