// P932 — the carrier playbook, researched Nov 10 2026 from each carrier's own policyholder pages and forms.
// One entry per carrier (keyed by the carrier catalog id, lib/carriers/catalog.js) and per action:
//   cancel · beneficiary · bank (bank account or draft day) · address · name
// method: 'esign'  a signed form is accepted by fax, email or upload, so we send our prefilled e-sign link (P886)
//         'online' the owner can do it in the carrier's own online account
//         'merge'  the owner has to be on the phone with the carrier (we merge them in)
//         'check'  not confirmed: "check on first call"
// esign:  'yes' the carrier says e-signatures are fine · 'no' wet ink (they print, sign, send a photo) · 'unknown'
// Seeded into public.carrier_playbook by migration 262 (scripts/p932-playbook.mjs writes the seed and the vault note).
// Admin and VAs edit entries in the portal; every edit is logged (carrier_playbook_log).
export const PLAYBOOK_CHECKED = '2026-11-10'
export const ACTIONS = ['cancel', 'beneficiary', 'bank', 'address', 'name']

const ID = ['Policy number', 'Date of birth', 'Last 4 of SSN']
const BANK = ['Policy number', 'New bank routing and account number', 'New draft day']
const BEN = ['Policy number', 'New beneficiary: full name, relationship, date of birth']
const NAME = ['Policy number', 'New legal name', 'Marriage certificate or court order']
const ADDR = ['Policy number', 'Date of birth', 'New address']
const check = (have, notes = 'Not published. Check on first call.') => ({ method: 'check', have, notes })

export const PLAYBOOK = [
  {
    key: 'cat-americo', phone: '(816) 641-2850', source: 'https://www.americo.com/policy-holder/',
    send: { fax: '(800) 395-9238', email: 'forms@americo.com' },
    actions: {
      cancel: { method: 'esign', esign: 'yes', form: 'Surrender / cancel form', url: 'https://www.americo.com/SiteCollectionDocuments/SurrenderForm.pdf', via: 'email', to: 'forms@americo.com', have: ['Policy number', 'Owner’s signature'], notes: 'Americo also takes it on their own DocuSign web form.' },
      beneficiary: { method: 'esign', esign: 'no', form: 'Beneficiary change request', url: 'https://www.americo.com/SiteCollectionDocuments/BeneficiaryChange.pdf', via: 'fax', to: '(800) 395-9238', have: [...BEN, 'Share for each'], notes: 'Print, sign and send (wet ink). Only the owner can change it.' },
      bank: { method: 'esign', esign: 'yes', form: 'Bank draft authorization', url: 'https://www.americo.com/SiteCollectionDocuments/BankDraftAuthorization.pdf', via: 'email', to: 'forms@americo.com', have: [...BANK, 'Account holder name'], notes: 'Also on Americo’s DocuSign web form.' },
      address: { method: 'esign', esign: 'yes', form: 'Address change', url: 'https://www.americo.com/SiteCollectionDocuments/AddressChange.pdf', via: 'email', to: 'forms@americo.com', have: ADDR },
      name: { method: 'check', form: 'Name change form', url: 'https://www.americo.com/SiteCollectionDocuments/NameChange.pdf', have: NAME, notes: 'Form exists but isn’t listed on their page. Check on first call.' },
    },
  },
  {
    key: 'cat-mutual-of-omaha', phone: '(800) 775-6000', source: 'https://www.mutualofomaha.com/access/',
    send: { fax: '(402) 997-1906' },
    actions: {
      cancel: check(ID, 'No cancel form published. Check on first call.'),
      beneficiary: { method: 'esign', esign: 'unknown', form: 'Application for change of beneficiary (L4237)', url: 'https://content.mutualofomaha.com/contactforms/sites/content.mutualofomaha.com.contactforms/files/_forms/l4237.pdf', via: 'fax', to: '(402) 997-1906', have: [...BEN, 'Share for each'], notes: 'Also online in Customer Access. A trust or charity needs paper.', confirmed: false },
      bank: { method: 'online', have: ['Customer Access login', 'New bank routing and account number'], notes: 'Owner changes how and when they pay in Customer Access. Not by phone.' },
      address: { method: 'online', have: ['Customer Access login', 'New address'], notes: 'Owner updates it in Customer Access.' },
      name: check(NAME),
    },
  },
  {
    key: 'cat-transamerica', phone: '(800) 851-9777', source: 'https://tlic.transamerica.com/portal/public/tlc/common/contact_us',
    actions: {
      cancel: check(ID, 'No form found; fax numbers conflict. Check on first call.'),
      beneficiary: check(BEN, 'Beneficiary form differs by issuing company. Check on first call.'),
      bank: check(BANK), address: check(ADDR), name: check(NAME),
    },
  },
  {
    key: 'cat-foresters', phone: '(800) 828-1540', source: 'https://www.foresters.com/en/customer-care',
    send: { fax: '(877) 329-4631', email: 'service@foresters.com' },
    actions: {
      cancel: { method: 'esign', esign: 'unknown', form: 'Certificate surrender request', url: 'https://www.foresters.com/-/media/foresters/documents/pdfs/us/customer-care/certificate-surrender-request-form.pdf', via: 'fax', to: '(877) 329-4631', have: ['Certificate number', 'Date of birth', 'Owner’s signature'] },
      beneficiary: { method: 'esign', esign: 'unknown', form: 'Beneficiary change form', url: 'https://www.foresters.com/-/media/foresters/documents/pdfs/us/customer-care/beneficiary-change-form.pdf', via: 'fax', to: '(877) 329-4631', have: ['Certificate number', 'New beneficiary: full name, relationship, date of birth', 'Share for each'] },
      bank: { method: 'esign', esign: 'unknown', form: 'Pre-authorized checking plan (PAC) request', url: 'https://www.foresters.com/-/media/foresters/documents/pdfs/us/customer-care/request-for-pre-authorization-form.pdf', via: 'email', to: 'service@foresters.com', have: ['Certificate number', 'New bank routing and account number', 'New draft day'] },
      address: { method: 'esign', esign: 'unknown', form: 'Certificate change form', url: 'https://www.foresters.com/-/media/foresters/documents/pdfs/us/customer-care/certificate-change-us-non-underwritten.pdf', via: 'fax', to: '(877) 329-4631', have: ['Certificate number', 'Date of birth', 'New address'] },
      name: { method: 'esign', esign: 'unknown', form: 'Name change form', url: 'https://www.foresters.com/-/media/foresters/documents/pdfs/us/customer-care/name-change-form.pdf', via: 'fax', to: '(877) 329-4631', have: ['Certificate number', 'New legal name', 'Marriage certificate or court order'] },
    },
  },
  {
    key: 'cat-globe-life', phone: '(844) 726-4372', source: 'https://home.globelifeinsurance.com/customer-service',
    phoneNote: 'Line depends on the issuing company: American Income (800) 433-3405, Liberty National (800) 516-4466.',
    actions: {
      cancel: { method: 'merge', have: ID, notes: 'No cancel form or fax published. Cancel on a call with the owner.', confirmed: false },
      beneficiary: { method: 'online', have: ['Online account login', 'New beneficiary: full name, relationship, date of birth'], notes: 'Owner changes it in their online account (portal differs by company), or on a call.' },
      bank: check(BANK),
      address: { method: 'online', have: ['Online account login', 'New address'], notes: 'Owner updates contact details online, or on a call.' },
      name: check(NAME),
    },
  },
  {
    key: 'cat-corebridge', phone: '(844) 452-3832', source: 'https://www.corebridgefinancial.com/support',
    send: { fax: '(855) 601-1834' },
    phoneNote: 'Policy-number lookup on their support page shows the right service center (Cleveland or Clinton).',
    actions: {
      cancel: { method: 'check', form: 'Miscellaneous service request (AGLC0107-FLAS)', url: 'https://adminplus.fgsfulfillment.com/View/AIGAG/1/AGLC0107-FLAS', have: ['Policy number', 'Owner’s SSN', 'Owner’s signature'], notes: 'No surrender form listed; they confirm by phone. Check on first call.' },
      beneficiary: { method: 'esign', esign: 'unknown', form: 'Change of beneficiary (AGLC0108-FLAS)', url: 'https://adminplus.fgsfulfillment.com/View/AIGAG/1/AGLC0108-FLAS', via: 'fax', to: '(844) 930-0370', have: [...BEN, 'Owner’s SSN', 'Share for each'], notes: 'An irrevocable beneficiary must agree.' },
      bank: { method: 'esign', esign: 'unknown', form: 'Electronic payment form (AGLC108866-FLAS)', url: 'https://adminplus.fgsfulfillment.com/View/AIGAG/1/AGLC108866-FLAS', via: 'fax', to: '(855) 601-1834', have: [...BANK, 'Checking or savings'] },
      address: { method: 'esign', esign: 'unknown', form: 'Name or address change (AGLC0222-FLAS)', url: 'https://adminplus.fgsfulfillment.com/View/AIGAG/1/AGLC0222-FLAS', via: 'fax', to: '(855) 601-1834', have: ['Policy number', 'Owner’s SSN', 'New address'] },
      name: { method: 'esign', esign: 'unknown', form: 'Name or address change (AGLC0222-FLAS)', url: 'https://adminplus.fgsfulfillment.com/View/AIGAG/1/AGLC0222-FLAS', via: 'fax', to: '(855) 601-1834', have: NAME },
    },
  },
  {
    key: 'cat-aetna', phone: '(800) 264-4000', source: 'https://choicemutual.com/wp-content/uploads/2025/05/Aetna-Policy.pdf',
    phoneNote: 'Number printed on Accendo policies; not on a current Aetna page. Servicing may sit with Landmark Life (800) 416-8377.',
    actions: {
      cancel: check(ID), beneficiary: check(BEN, 'Written request on their form; an irrevocable beneficiary must agree. Check on first call.'),
      bank: check(BANK), address: check(ADDR), name: check(NAME),
    },
  },
  {
    key: 'cat-royal-neighbors-of-america', phone: '(800) 627-4762', source: 'https://www.royalneighbors.org/membership/member-resources/',
    actions: {
      cancel: check(['Certificate number', 'Date of birth', 'Last 4 of SSN']),
      beneficiary: { method: 'merge', form: 'Request for change of beneficiary (1813W)', url: 'https://www.royalneighbors.org/wp-content/uploads/2025/09/Request_Change_Beneficiary_1813W_Rev-4-2013_fillable_R.pdf', have: ['Certificate number', 'New beneficiary: full name, address, relationship, date of birth', 'An adult witness'], notes: 'Form goes by mail with a witness signature. Ask on the call if they’ll take it by fax.' },
      bank: check(BANK),
      address: { method: 'online', have: ['Member login', 'New address'], notes: 'Owner changes it in the member portal.' },
      name: { method: 'merge', form: 'Request for change of name (2299W)', url: 'https://www.royalneighbors.org/wp-content/uploads/2025/09/Request_Change_Name_2299W_Rev_7-2011_fillable_R.pdf', have: NAME, notes: 'Mail only as published. Ask on the call if they’ll take it by fax.' },
    },
  },
  {
    key: 'cat-gerber-life', phone: '(800) 704-2180', source: 'https://www.gerberlife.com/about/life-insurance-questions',
    send: { fax: '(231) 928-3078' },
    actions: {
      cancel: { method: 'merge', have: ID, notes: 'The owner calls (or messages) them; only the owner can cancel.' },
      beneficiary: { method: 'online', have: ['eService login', 'New beneficiary: full name, relationship, date of birth'], notes: 'eService makes the form; it’s printed, signed and mailed.' },
      bank: { method: 'online', have: ['eService login', 'New bank routing and account number', 'New draft day'], notes: 'eService changes the bank and the due date.' },
      address: { method: 'online', have: ['eService login', 'New address'], notes: 'eService → My Policies → Policyholder Details.' },
      name: check(NAME, 'Needs their form plus a legal document. Check on first call.'),
    },
  },
  {
    key: 'cat-liberty-bankers-life', phone: '(800) 604-8002', source: 'https://lbig.com/about-us/contact-us',
    send: { fax: '(888) 525-5002' },
    phoneNote: 'Ordinary Life line. Home Service policies: (800) 972-6615, fax (866) 505-9377.',
    actions: {
      cancel: check(ID),
      beneficiary: { method: 'esign', esign: 'unknown', form: 'Policy change form (LBL HS CHANGE-0809)', url: 'https://www.lbig.com/user/pages/09.Resources/02._download-forms/Life_Service_Form_(Form_LBL_PHS).pdf', via: 'fax', to: '(888) 525-5002', have: [...BEN, 'Insured’s SSN', 'An adult witness'], notes: 'Owner and an adult witness sign.' },
      bank: check(BANK), address: check(ADDR),
      name: { method: 'esign', esign: 'unknown', form: 'Policy change form (LBL HS CHANGE-0809)', url: 'https://www.lbig.com/user/pages/09.Resources/02._download-forms/Life_Service_Form_(Form_LBL_PHS).pdf', via: 'fax', to: '(888) 525-5002', have: [...NAME, 'An adult witness'], notes: 'Legal document needed unless it’s marriage or a spelling fix.' },
    },
  },
  {
    key: 'cat-sbli', phone: '(800) 694-7254', source: 'https://cdn.sbli.com/forms/k-107.pdf',
    send: { email: 'customerservice@sbli.com' },
    actions: {
      cancel: check(['Policy number', 'Date of birth']),
      beneficiary: { method: 'esign', esign: 'unknown', form: 'Beneficiary change form (K-107)', url: 'https://cdn.sbli.com/forms/k-107.pdf', via: 'email', to: 'customerservice@sbli.com', have: BEN, notes: 'An irrevocable beneficiary signs too. Massachusetts needs a witness.' },
      bank: check(BANK, 'Automatic payment plan form K-25B, seen only on a third-party site. Check on first call.'),
      address: { method: 'online', form: 'Name and address change (K-108)', url: 'https://cdn.sbli.com/forms/k-108.pdf', have: ['my.sbli.com login', 'New address'], notes: 'Easiest at my.sbli.com; the form goes by mail only.' },
      name: { method: 'merge', form: 'Name and address change (K-108)', url: 'https://cdn.sbli.com/forms/k-108.pdf', have: NAME, notes: 'Mail only as published; owner signs in old and new name. Ask on the call.' },
    },
  },
  {
    key: 'cat-ethos', phone: '(888) 384-6754', source: 'https://ethos.com/policyholder-resource-page',
    send: { email: 'support@ethoslife.com' },
    phoneNote: 'TruStage-issued Ethos policies: TruStage (855) 591-9026.',
    actions: {
      cancel: { method: 'esign', esign: 'yes', form: 'Surrender form (Ethos sends it on request)', via: 'email', to: 'support@ethoslife.com', have: ['Policy number', 'Date of birth'], notes: 'Ethos emails the form to sign electronically.' },
      beneficiary: { method: 'merge', have: BEN, notes: 'No form: email or call Ethos with the owner.' },
      bank: { method: 'online', have: ['Ethos login', 'New debit or credit card'], notes: 'Ethos takes cards, not bank drafts: Policies → Change payment method.' },
      address: { method: 'merge', have: ADDR, notes: 'No form: email or call Ethos with the owner.' },
      name: check(NAME),
    },
  },
  {
    key: 'cat-lincoln-financial', phone: '(800) 487-1485', source: 'https://www.lincolnfinancial.com/pbl-static/pdf/CS06893-form.pdf',
    send: { fax: '(800) 819-1987', email: 'CustServSupportTeam@LFG.com' },
    actions: {
      cancel: check(ID, 'Surrender form number seen only on third-party sites. Check on first call.'),
      beneficiary: { method: 'esign', esign: 'unknown', form: 'Beneficiary change for life policy (CS06893)', url: 'https://www.lincolnfinancial.com/pbl-static/pdf/CS06893-form.pdf', via: 'fax', to: '(800) 819-1987', have: [...BEN, 'Owner’s SSN'], notes: 'Replaces every beneficiary. Irrevocable needs CS11722.' },
      bank: check(BANK),
      address: { method: 'esign', esign: 'unknown', form: 'Life address change form', url: 'https://www.lincolnfinancial.com/pbl-static/pdf/Life-Address-Change-form---PDF.pdf', via: 'fax', to: '(800) 819-1987', have: ['Policy number', 'Old and new address'] },
      name: { method: 'esign', esign: 'unknown', form: 'Life name change form (CS10233)', url: 'https://www.lincolnfinancial.com/pbl-static/pdf/CS10233-form.pdf', via: 'fax', to: '(800) 819-1987', have: NAME, notes: 'Send both pages or they decline it.' },
    },
  },
  {
    key: 'cat-american-amicable', phone: '(800) 736-7311', source: 'https://www.americanamicable.com/v4/contact-us.php',
    send: { fax: '(254) 297-2105', email: 'cx@aatx.com' },
    actions: {
      cancel: { method: 'esign', esign: 'unknown', form: 'Policy cancellation request (9874)', url: 'https://www.americanamicable.com/internet/webforms/common/9874.pdf', via: 'fax', to: '(254) 297-2105', have: ['Policy number', 'Owner’s SSN and date of birth', 'Refund: check, or bank for direct deposit'] },
      beneficiary: { method: 'esign', esign: 'unknown', form: 'Beneficiary change request (BCR)', url: 'https://www.americanamicable.com/internet/webforms/common/BCR.pdf', via: 'fax', to: '(254) 297-2105', have: [...BEN, 'A witness who isn’t family'], notes: 'Notarized if the new beneficiary isn’t family.' },
      bank: { method: 'esign', esign: 'unknown', form: 'Bank draft authorization (1963)', url: 'https://www.americanamicable.com/internet/webforms/common/1963.pdf', via: 'fax', to: '(254) 297-2756', have: [...BANK, 'Checking or savings'], notes: 'Also online: americanamicable.com bank authorization page.' },
      address: check(ADDR, 'No form published; ask Client Experience (cx@aatx.com). Check on first call.'),
      name: check(NAME),
    },
  },
  {
    key: 'cat-great-western', phone: '(800) 733-5454', source: 'https://www.wellabe.com/faq',
    actions: {
      cancel: check(ID, 'Forms sit behind the Wellabe portal. Check on first call.'),
      beneficiary: check(BEN, 'Forms sit behind the Wellabe portal. Check on first call.'),
      bank: check(BANK, 'Bank draft form is in the Wellabe portal. Check on first call.'),
      address: { method: 'online', have: ['mywellabe.com login', 'New address'], notes: 'Owner updates it in the Wellabe portal.' },
      name: { method: 'merge', have: NAME, notes: 'Their FAQ says call Customer Success for a name change.' },
    },
  },
  {
    key: 'cat-f-g', phone: '(888) 513-8797', source: 'https://www.fglife.com/contact/policyholder-support',
    send: { fax: '(800) 281-5777' },
    actions: {
      cancel: check(ID),
      beneficiary: { method: 'esign', esign: 'unknown', form: 'Change of beneficiary request (ADMIN 5742)', url: 'https://assets.fglife.com/is/content/fglife/ad-reviewed-materials/admin/admin5700s/ADMIN5742%20Change%20of%20Beneficiary%20Request.pdf', via: 'fax', to: '(800) 281-5777', have: BEN, notes: 'Every owner signs; an irrevocable beneficiary consents.' },
      bank: { method: 'check', form: 'Pre-authorized check form (ADMIN5778)', via: 'fax', to: '(800) 281-5777', have: BANK, notes: 'Form named on another F&G form, not read. Check on first call.' },
      address: { method: 'esign', esign: 'unknown', form: 'Change of name or mailing address (ADMIN 5743)', url: 'https://assets.fglife.com/is/content/fglife/ad-reviewed-materials/admin/admin5700s/ADMIN5743%20Change%20of%20Name%20or%20Mailing%20Address.pdf', via: 'fax', to: '(800) 281-5777', have: ['Policy number', 'New address'], notes: 'Done in 3–5 business days.' },
      name: { method: 'esign', esign: 'unknown', form: 'Change of name or mailing address (ADMIN 5743)', url: 'https://assets.fglife.com/is/content/fglife/ad-reviewed-materials/admin/admin5700s/ADMIN5743%20Change%20of%20Name%20or%20Mailing%20Address.pdf', via: 'fax', to: '(800) 281-5777', have: NAME },
    },
  },
]
