-- Prompt 331: real carrier directory data, transcribed off Brayden's
-- screenshot of Nate's old Liberated Financial "Carriers & Contracts" page.
-- Phone numbers verified pixel-for-pixel. Portal URLs researched separately
-- (see LIVE_STATE Prompt 331 for per-carrier confidence notes) — Baltimore
-- Life has no confident match, left null rather than guessed.
insert into carriers (name, is_core_carrier, portal_name, new_business_phone, agent_service_phone, portal_url) values
  ('Mutual of Omaha',    true,  'Sales Professional Access', '800-693-6083',        '800-775-6000',        'https://login.mutualofomaha.com'),
  ('Transamerica',       true,  'Transamerica Agent Net',    '800-797-2643',        '800-851-7555',        'https://ani.transamerica.com/'),
  ('Fidelity Life',      true,  'eApp / Agent Portal',       '866-947-5147',        '800-369-3990',        'https://fidelitylife.com/login/'),
  ('Corebridge',         true,  'Corebridge Connext',        '800-340-2765',        '800-888-2452',        'https://connext.corebridgefinancial.com/'),
  ('Ethos',              true,  'Ethos Agent Dashboard',     '415-231-0328',        '888-855-8471',        'https://agents.ethoslife.com/login'),
  ('American Amicable',  true,  'WinFlex / Agent Portal',    '800-736-7311',        '254-297-2777',        'https://www.americanamicable.com/v4/AgentLogin.php'),
  ('Baltimore Life',     false, 'Agent Portal',              '800-628-5433',        '800-628-5433',        null),
  ('Aflac',              false, 'Aflac Senior Agent Portal', null,                  '833-504-0336',        'https://www.sellaflacseniorplans.com'),
  ('Chubb',              false, 'Benchmark Administration',  '801-658-9911',        '801-658-9911',        'https://chubb.insuranceadmin.com/login'),
  ('National Life Group',false, 'NLG Agent Portal',          '800-906-3310',        '800-906-3310',        'https://www.nationallife.com/agent/'),
  ('Foresters',          false, 'MyEZBiz',                   '866-466-7166 opt 2',  '866-466-7166 opt 1',  'https://ezbiz.foresters.com/'),
  ('F&G',                false, 'SalesLink',                 '800-445-6758 opt 2',  '800-445-6758',        'https://saleslink.fglife.com/')
on conflict (name) do update set
  is_core_carrier = excluded.is_core_carrier,
  portal_name = excluded.portal_name,
  new_business_phone = excluded.new_business_phone,
  agent_service_phone = excluded.agent_service_phone,
  portal_url = excluded.portal_url;
