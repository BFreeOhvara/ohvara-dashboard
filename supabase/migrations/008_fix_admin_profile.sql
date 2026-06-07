-- ============================================================
-- Migration 008 — Fix admin profile row and RLS select policy
--
-- Ensures brayden11@ohvara.internal has a correct profiles row
-- (upsert so it's safe whether the row is missing or just wrong).
-- Also adds an explicit self-select RLS policy so users can always
-- read their own profile row regardless of admin-check evaluation.
-- ============================================================

-- Upsert the admin profile row
INSERT INTO public.profiles (id, email, full_name, role, username)
SELECT
  id,
  email,
  'Brayden',
  'admin'::user_role,
  'brayden11'
FROM auth.users
WHERE email = 'brayden11@ohvara.internal'
ON CONFLICT (id) DO UPDATE SET
  role      = 'admin'::user_role,
  username  = 'brayden11',
  full_name = 'Brayden';

-- Ensure self-select policy exists (the original profiles_select policy
-- includes this logic but be explicit so it can't be blocked)
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
