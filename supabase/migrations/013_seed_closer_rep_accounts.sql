-- ============================================================
-- Migration 013 — Seed additional user accounts
-- jordan22 (closer), nate44 (closer), apex11 (rep)
-- Follows the same pattern as 006_seed_accounts.sql
-- ============================================================

DO $$
BEGIN
  -- jordan22 / closer
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'jordan22@ohvara.internal') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      is_super_admin, created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(), 'authenticated', 'authenticated',
      'jordan22@ohvara.internal',
      crypt('Jordan2026!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Jordan","role":"closer","username":"jordan22"}'::jsonb,
      false, now(), now()
    );
  END IF;

  -- nate44 / closer
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'nate44@ohvara.internal') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      is_super_admin, created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(), 'authenticated', 'authenticated',
      'nate44@ohvara.internal',
      crypt('Nate2026!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Nate","role":"closer","username":"nate44"}'::jsonb,
      false, now(), now()
    );
  END IF;

  -- apex11 / rep
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'apex11@ohvara.internal') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      is_super_admin, created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(), 'authenticated', 'authenticated',
      'apex11@ohvara.internal',
      crypt('Apex2026!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Apex","role":"rep","username":"apex11"}'::jsonb,
      false, now(), now()
    );
  END IF;
END $$;
