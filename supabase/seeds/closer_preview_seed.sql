-- Closer preview seed — populates Revenue Tracker + Notification Bell for Nate's closer dashboard.
-- Run once in Supabase SQL editor (project jjextitmbptoaolacocs).
-- Safe to re-run: notifications are delete+re-insert, appointments are additive.

DO $$
DECLARE
  closer_id    uuid;
  lead_id_arr  uuid[];
  appt_id_arr  uuid[];
  new_lead_id  uuid;
  new_appt_id  uuid;
  existing_count int;
  i            int;

  -- Deal values and business names for 12 sample deals
  deal_vals  numeric[] := ARRAY[1199,899,1499,2199,999,1799,1399,2399,799,1099,1599,1999];
  biz_names  text[]    := ARRAY[
    'NorthStar Heating & Air','TowMaster Pro','Ridgeview Plumbing',
    'BlueWave HVAC','PeakLine Electric','Summit Roofing Co.',
    'Coastal Auto Repair','Ironwood Landscaping','RedRock Pest Control',
    'Clearview Windows','Horizon Restoration','LakeSide Flooring'
  ];
  phones     text[]    := ARRAY[
    '(512) 555-0101','(512) 555-0202','(737) 555-0303',
    '(512) 555-0404','(737) 555-0505','(512) 555-0606',
    '(737) 555-0707','(512) 555-0808','(737) 555-0909',
    '(512) 555-1010','(737) 555-1111','(512) 555-1212'
  ];
  -- Days ago for each deal (spread across ~8 months)
  days_ago   int[]     := ARRAY[215,200,180,155,140,115,90,75,55,35,20,5];

BEGIN
  -- 1. Find Nate's closer profile
  SELECT id INTO closer_id FROM profiles WHERE role = 'closer' LIMIT 1;
  IF closer_id IS NULL THEN
    RAISE EXCEPTION 'No closer profile found — create Nate''s account first.';
  END IF;
  RAISE NOTICE 'Seeding for closer_id: %', closer_id;

  -- 2. Gather up to 12 existing lead IDs
  SELECT ARRAY(SELECT id FROM leads ORDER BY created_at LIMIT 12) INTO lead_id_arr;
  existing_count := COALESCE(array_length(lead_id_arr, 1), 0);

  -- Create stub leads for any missing slots
  FOR i IN (existing_count + 1)..12 LOOP
    INSERT INTO leads (business_name, phone, niche, city, status)
    VALUES (biz_names[i], phones[i], 'Home Services', 'Austin', 'Appointment Booked')
    RETURNING id INTO new_lead_id;
    lead_id_arr := array_append(lead_id_arr, new_lead_id);
  END LOOP;

  -- 3. Insert 12 closed appointments spread across the last 8 months
  appt_id_arr := ARRAY[]::uuid[];
  FOR i IN 1..12 LOOP
    INSERT INTO appointments (lead_id, closer_id, rep_id, scheduled_at, status, outcome, deal_value, updated_at)
    VALUES (
      lead_id_arr[i],
      closer_id,
      closer_id,
      now() - (days_ago[i] || ' days')::interval,
      'completed',
      'closed',
      deal_vals[i],
      now() - (days_ago[i] || ' days')::interval
    )
    RETURNING id INTO new_appt_id;
    appt_id_arr := array_append(appt_id_arr, new_appt_id);
  END LOOP;

  -- 4. Insert commission_payouts (10% of deal value)
  FOR i IN 1..12 LOOP
    INSERT INTO commission_payouts (rep_profile_id, appointment_id, amount_cents, deal_value_cents, status)
    VALUES (
      closer_id,
      appt_id_arr[i],
      (deal_vals[i] * 0.10 * 100)::int,
      (deal_vals[i] * 100)::int,
      'paid'
    );
  END LOOP;

  -- 5. Seed one notification per type (clear preview ones first so re-run is clean)
  DELETE FROM notifications
  WHERE profile_id = closer_id
    AND type IN ('appointment_booked', 'appointment_reminder_5min', 'call_graded');

  INSERT INTO notifications (profile_id, type, message, data, read) VALUES
    (closer_id, 'appointment_booked',
     'New appointment booked — NorthStar Heating & Air',
     '{"business_name":"NorthStar Heating & Air"}'::jsonb, false),
    (closer_id, 'appointment_reminder_5min',
     'Your appointment with TowMaster Pro starts in 5 minutes',
     '{"business_name":"TowMaster Pro"}'::jsonb, false),
    (closer_id, 'call_graded',
     'Your call recording has been graded — review your score',
     '{}'::jsonb, false);

  RAISE NOTICE 'Done. Deals inserted: 12, Payouts inserted: 12, Notifications: 3';
END $$;
