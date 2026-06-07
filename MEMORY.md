# Ohvara Dashboard — Project Memory

## Project Overview
- **Stack:** Vite + React 18 + React Router v6 + TanStack React Query + Tailwind CSS
- **Backend:** Supabase (PostgreSQL + GoTrue auth + Edge Functions + RLS)
- **Auth:** username@ohvara.internal internal email format
- **Deployment:** GitHub (BFreeOhvara/ohvara-dashboard) → Vercel auto-deploy on master push
- **Live URL:** https://ohvara-dashboard.vercel.app

## Supabase Project
- **Project ref:** `jjextitmbptoaolacocs`
- **Region:** East US (Ohio)
- **Supabase URL:** `https://jjextitmbptoaolacocs.supabase.co`

## Active Accounts
| Username | Password | Role | Full Name |
|----------|----------|------|-----------|
| brayden11 | Ohvara2026! | admin | Brayden |
| nate44 | Nate2026! | closer | Nate |
| jordan22 | Jordan2026! | closer | Jordan |
| apex11 | Apex2026! | rep | Test Rep |

## Edge Functions Deployed
1. `admin-create-user` — creates auth user + profile (admin JWT required)
2. `admin-toggle-user` — toggles is_active (admin JWT required)
3. `admin-delete-user` — permanently deletes user from auth (admin JWT required)
4. `generate-ai-script` — Claude API: script / briefing / pitch_anchor / stack_analysis modes
5. `assign-closer` — round-robin closer assignment
6. `assign-daily-batch` — daily lead batch assignment to reps
7. `process-reminders` — fires due SMS reminders
8. `schedule-reminders` — schedules 24h/1h/10min SMS reminders
9. `trigger-re-engagement` — starts re-engagement sequences

## Database Tables
- `profiles` — extends auth.users, has: id, role, full_name, email, username, is_active, last_login_at, created_at
- `leads` — lead records with: assigned_rep_id, assigned_closer_id, niche, monthly_labor_cost, etc.
- `calls` — call records per rep
- `appointments` — booked appointments with outcome tracking
- `reminder_log` — SMS reminder scheduling/tracking
- `re_engagement_log` — re-engagement sequence tracking
- `batch_assignments` — audit log for daily batch runs
- `closer_rotation` — round-robin state

## Known Issues / Technical Debt
- `app.supabase_url` DB setting not set (permission denied via Management API)
  → pg_cron background jobs (process-reminders, assign-daily-batch, trigger-re-engagement) won't fire
  → Workaround: trigger Edge Functions manually or set up external cron (e.g. Vercel Cron)
- TWILIO_STUB_MODE = true — no real SMS/calls, button works but doesn't dial
  → To go live: add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER as Supabase secrets

## RLS Policies (current)
- `profiles`: SELECT allows `auth.uid() IS NOT NULL` (any logged-in user sees all profiles)
  — needed for RepAnalytics and PastDeals joins
- `profiles`: UPDATE allows own profile only (`auth.uid() = id`)
- `leads`: SELECT allows assigned_rep_id OR assigned_closer_id OR admin
- `appointments`: SELECT allows closer_id OR rep_id OR admin

## Security Definer Functions
- `is_admin()` — checks if current user has admin role (avoids RLS recursion)

## Session Log

### 2026-06-07 | Initial Setup + Account Creation
- Created 3 user accounts (nate44/jordan22/apex11)
- Fixed RLS infinite recursion (42P17) via migration 009
- Deployed all 8 Edge Functions
- Seeded test data: 150 leads for apex11, 3 appointments, 3 past deals, 25 calls

### 2026-06-07 | Bug Fixes
- Fixed Badge 'active'/'inactive' missing styles
- Fixed assigned_closer_id on seeded appointment leads
- Added JWT admin validation to admin-create-user and admin-toggle-user
- Migration 010: profiles RLS team visibility

### 2026-06-07 | Full Feature Build
- Task 1: Login management system (search/filter/delete/deactivate with confirmation modal)
- Task 2: Closer stack recommendation engine (AI-generated, auto-loads on card expand)
- Task 3: Edge Function security (admin JWT guard on all admin functions)
- Task 4: UI overhaul — Plus Jakarta Sans, new color tokens, pill badges, accent glow buttons

### 2026-06-07 | Full Overhaul Session
**Task:** Design system compliance + scraper infrastructure
**Stack touched:** index.css, all ui/ components, all page files, new scripts/
**Design violations fixed:** font-bold→medium (51), radius > 10px (36), shadows (8), gradients (2)
**What broke:** CSS variable opacity modifiers /N don't work with hex vars — fixed by using literal hex
**Lesson:** CSS custom properties holding hex values cannot use Tailwind /N opacity modifier; use literal hex or define opacity variants in CSS
**Status:** Complete
