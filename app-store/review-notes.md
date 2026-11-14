# App Review notes (P928 text, P953 answer to Guideline 2.1, P998 refresh for build 1.1 (7))

Apple's API has no field for these, so they are pasted into App Store Connect → the app →
App Review Information → Notes (limit 4000 characters; the text below the line is under that).
The same text is sent as the reply to Apple's message, with the screen recording attached.
They carry over from one version to the next; paste again only when this file changes.
Sign-in logins are NOT in git: admin portal → Settings → Review → Reset the logins, then paste
both into App Review Information → Sign-in. A reset changes the passwords everywhere, including
the ones Google Play has, so don't reset while Apple or Google is reviewing.

---

PURPOSE AND AUDIENCE
Ohvara is the work app for licensed life insurance agents who use Ohvara's lead and client-servicing service, and for the Ohvara team members (VAs) who work those agents' clients. It is only useful to someone with an Ohvara account, so we are requesting Unlisted App Distribution (Guideline 3.2). The app has no sign-up: agents create their account on our website, and team members join by invitation from Ohvara. Agents see their leads, clients, calendar and messages with our team. VAs see their day, calendar, schedule and messages, and can make calls from the app.

SIGN IN
Two demo accounts are in the Sign-in fields: an Agent and a VA. They hold sample data only; nothing they do reaches real people, calls, texts, emails or payments. New leads come only from real callers, so the demo Agent's Leads list is empty; its sample clients are under Account → Clients.

WHERE EVERYTHING IS
Agent app, bottom bar (icons; swipe to move between them): Home, Leads, Calendar, Messages, and the agent's initials, which opens Account. Account holds the plan, Lead spend (opens Billing), Clients, Activity, Settings, Help and Sign out. Delete account is at the bottom of Settings → Account (type DELETE to confirm).
VA app, bottom bar: Today, Calendar, Schedule, Messages, Me. Me holds Hours and pay, Settings, Help and Sign out. Delete account is at the bottom of Me → Settings → Account.
Account deletion also works on the website. It cancels the agent's plan, removes their login, name, phone, photo and device tokens, and keeps only anonymised tax and billing records we must retain.

SCREEN RECORDING
Attached to our reply: recorded on a real iPhone running this build, from app launch through sign-in, each tab, Clients, Billing, Settings, sign out, and deleting a throwaway test account.

LIVE-CALL ALERT (Time Sensitive notifications)
When a caller who asked for insurance help is on the line, our team checks whether the agent can take a live transfer. The agent gets one notification with Yes / No buttons and about 30 seconds to answer, so it is marked Time Sensitive to get through Focus. We use it only for this live-call check, never for marketing or reminders. The demo accounts don't receive live calls. Agents set when live calls can reach them in Settings → Calls and calendar → Call hours.

NO PURCHASES IN THE APP
Billing is read-only in the app: the lead spend can't be changed there, and plans and cards are managed on our website through Stripe. The app sells nothing and uses no in-app purchase.

EXTERNAL SERVICES AND WHAT EACH DOES
- Supabase: accounts, sign-in and the app's data.
- Stripe: agent billing on the website, and payouts to VAs (Stripe Connect). No payments inside the app.
- Twilio and GoHighLevel: phone calls and text messages with leads and clients. VAs' calls use the microphone only during a call they start.
- Retell: the AI voice assistant for calls with leads.
- Anthropic (Claude): checks call recordings for our team.
- Apple Push Notification service, and Firebase on Android: notifications.
- Resend: account and notification emails.
- Capgo: delivers small updates to the app's own web content.
- Vercel: hosts the website and the app's web content.

REGIONAL DIFFERENCES
None in the app. It is for the United States only and is the same everywhere.

REGULATED INDUSTRY
Life insurance is regulated by each state. Every agent using the app holds their own state insurance licence (we collect their NPN and licence details when they join). Ohvara is a lead and servicing platform: it does not sell insurance, take premiums or handle policy payments, and the app takes no payments of any kind.

Privacy policy: https://ohvara.com/privacy · Support: https://ohvara.com/support
