-- ============================================================
-- Migration 007 — Fix seed account identities
--
-- Migration 006 inserted rows into auth.users but GoTrue also
-- requires a matching row in auth.identities to authenticate.
-- Without it the user exists but credentials are rejected.
--
-- This migration inserts the missing identity records for
-- brayden11 and rep_sarah using their existing auth.users IDs.
-- Idempotent — ON CONFLICT DO NOTHING on both tables.
-- ============================================================

DO $$
DECLARE
  v_brayden_id uuid;
  v_sarah_id   uuid;
BEGIN

  -- ── brayden11 ────────────────────────────────────────────
  SELECT id INTO v_brayden_id
  FROM auth.users
  WHERE email = 'brayden11@ohvara.internal';

  -- If 006 didn't fully run on this env, create the user too
  IF v_brayden_id IS NULL THEN
    v_brayden_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      is_super_admin, created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_brayden_id,
      'authenticated', 'authenticated',
      'brayden11@ohvara.internal',
      crypt('Ohvara2026!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Brayden","role":"admin","username":"brayden11"}'::jsonb,
      false, now(), now()
    );
  END IF;

  INSERT INTO auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    v_brayden_id::text,
    v_brayden_id,
    jsonb_build_object(
      'sub',   v_brayden_id::text,
      'email', 'brayden11@ohvara.internal'
    ),
    'email',
    now(), now(), now()
  )
  ON CONFLICT (provider, provider_id) DO NOTHING;

  -- ── rep_sarah ─────────────────────────────────────────────
  SELECT id INTO v_sarah_id
  FROM auth.users
  WHERE email = 'rep_sarah@ohvara.internal';

  IF v_sarah_id IS NULL THEN
    v_sarah_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      is_super_admin, created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_sarah_id,
      'authenticated', 'authenticated',
      'rep_sarah@ohvara.internal',
      crypt('Sarah2026!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Sarah","role":"rep","username":"rep_sarah"}'::jsonb,
      false, now(), now()
    );
  END IF;

  INSERT INTO auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    v_sarah_id::text,
    v_sarah_id,
    jsonb_build_object(
      'sub',   v_sarah_id::text,
      'email', 'rep_sarah@ohvara.internal'
    ),
    'email',
    now(), now(), now()
  )
  ON CONFLICT (provider, provider_id) DO NOTHING;

END $$;
