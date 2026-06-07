-- ============================================================
-- Migration 006 — Seed accounts
-- Creates brayden11 (admin) and rep_sarah (rep) directly in
-- auth.users using bcrypt-hashed passwords. The handle_new_user
-- trigger fires on each INSERT and auto-creates the profiles row.
-- Wrapped in existence checks so re-running is safe.
-- ============================================================

DO $$
BEGIN
  -- brayden11 / admin
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'brayden11@ohvara.internal') THEN
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      created_at,
      updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'brayden11@ohvara.internal',
      crypt('Ohvara2026!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Brayden","role":"admin","username":"brayden11"}'::jsonb,
      false,
      now(),
      now()
    );
  END IF;

  -- rep_sarah / rep
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'rep_sarah@ohvara.internal') THEN
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      created_at,
      updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'rep_sarah@ohvara.internal',
      crypt('Sarah2026!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Sarah","role":"rep","username":"rep_sarah"}'::jsonb,
      false,
      now(),
      now()
    );
  END IF;
END $$;
