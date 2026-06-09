"""Seed 10 realistic test leads for apex11."""
import json, urllib.request, urllib.error

SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqZXh0aXRtYnB0b2FvbGFjb2NzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDgwMTUwMywiZXhwIjoyMDk2Mzc3NTAzfQ.j0-nvzNhwP6OtVZ6Sqto165MFrXJc53MHETj6Z7jybw"
URL    = "https://jjextitmbptoaolacocs.supabase.co"
APEX   = "67bdea10-62d0-44c6-81b0-a321ca9ea52e"
JORDAN = "2d7e4b45-08ed-42c3-84d5-7fcf6744ddd5"
TODAY  = "2026-06-08"

LEADS = [
    {
        "source": "indeed",
        "business_name": "Texas Road Kings Towing",
        "contact_name": "Marcus Webb",
        "phone": "(214) 832-4901",
        "city": "Dallas", "state": "TX",
        "niche": "tow truck",
        "status": "Booked",
        "assigned_rep_id": APEX,
        "job_title": "dispatcher",
        "monthly_labor_cost": 3200,
        "batch_date": TODAY,
        "notes": "Hiring dispatcher — 3 trucks on road, owner answering calls himself. Missed 6 calls last week.",
        "pain_points": "Owner manually dispatches all calls while driving. Losing jobs when he cannot answer. Wants someone to handle inbound and coordinate drivers.",
    },
    {
        "source": "indeed",
        "business_name": "DFW Hotshot Express",
        "contact_name": "Randy Castillo",
        "phone": "(817) 555-0193",
        "city": "Fort Worth", "state": "TX",
        "niche": "hotshot trucking",
        "status": "Interested",
        "assigned_rep_id": APEX,
        "job_title": "dispatcher",
        "monthly_labor_cost": 2800,
        "batch_date": TODAY,
        "notes": "Posted for dispatcher on Indeed, 4 trucks. GM said they lose freight loads when no one watches the board.",
        "pain_points": "Freight sitting on load boards unclaimed because no one monitoring full time. Dispatcher position turned over 3 times in 12 months.",
    },
    {
        "source": "indeed",
        "business_name": "Lone Star Comfort HVAC",
        "contact_name": "Debbie Harmon",
        "phone": "(972) 441-8820",
        "city": "Plano", "state": "TX",
        "niche": "HVAC",
        "status": "No Answer",
        "assigned_rep_id": APEX,
        "job_title": "receptionist",
        "monthly_labor_cost": 3600,
        "batch_date": TODAY,
        "notes": "8 techs in field, office manager doing all scheduling. Summer season surge hitting hard.",
        "pain_points": "One person handling all scheduling and customer service. Calls going to voicemail during peak summer season. Losing install jobs to faster-responding competitors.",
    },
    {
        "source": "indeed",
        "business_name": "Summit Roofing & Restoration",
        "contact_name": "Kevin Pruitt",
        "phone": "(682) 290-5544",
        "city": "Arlington", "state": "TX",
        "niche": "roofing",
        "status": "Voicemail",
        "assigned_rep_id": APEX,
        "job_title": "front desk",
        "monthly_labor_cost": 2400,
        "batch_date": TODAY,
        "notes": "Front desk hire after hail storm season left them understaffed. Owner said follow-up on estimates is killing close rate.",
        "pain_points": "Storm leads going cold because no follow-up within 24 hours. Owner closes maybe 30% of estimates. Wants automated follow-up and someone answering the phones.",
    },
    {
        "source": "indeed",
        "business_name": "Capital City Electric",
        "contact_name": "Lisa Nguyen",
        "phone": "(512) 703-9271",
        "city": "Austin", "state": "TX",
        "niche": "electrical",
        "status": "Contacted",
        "assigned_rep_id": APEX,
        "job_title": "office manager",
        "monthly_labor_cost": 4200,
        "batch_date": TODAY,
        "notes": "Commercial and residential electrical, 12 technicians. Dispatch bottleneck costing booked jobs.",
        "pain_points": "Dispatch scheduling taking 45+ minutes per job due to manual back-and-forth. Service call backlog is 5 days. Losing customers to competitors with faster scheduling.",
    },
    {
        "source": "indeed",
        "business_name": "Big D Towing & Recovery",
        "contact_name": "Antonio Rivera",
        "phone": "(214) 903-6617",
        "city": "Dallas", "state": "TX",
        "niche": "tow truck",
        "status": "New",
        "assigned_rep_id": APEX,
        "job_title": "dispatcher",
        "monthly_labor_cost": 3800,
        "batch_date": TODAY,
        "notes": "Fleet of 5 heavy-duty trucks. Accident scene work plus municipal contracts.",
        "pain_points": "Dispatcher position empty for 2 months. Night shift has zero coverage. Municipal contracts at risk if response times keep slipping.",
    },
    {
        "source": "indeed",
        "business_name": "Permian Basin Hotshot Freight",
        "contact_name": "Travis Coleman",
        "phone": "(432) 618-3890",
        "city": "Midland", "state": "TX",
        "niche": "hotshot trucking",
        "status": "New",
        "assigned_rep_id": APEX,
        "job_title": "dispatcher",
        "monthly_labor_cost": 4800,
        "batch_date": TODAY,
        "notes": "Oilfield hotshot operation, 8 trucks. Posting for dispatcher to handle load coordination and driver check-ins.",
        "pain_points": "Load coordination done via group text with drivers. No accountability system. Fuel costs up because routing is inefficient. Owner doing dispatch at 11pm most nights.",
    },
    {
        "source": "indeed",
        "business_name": "North Texas Climate Control",
        "contact_name": "Sandra Flores",
        "phone": "(469) 871-5523",
        "city": "McKinney", "state": "TX",
        "niche": "HVAC",
        "status": "New",
        "assigned_rep_id": APEX,
        "job_title": "receptionist",
        "monthly_labor_cost": 3200,
        "batch_date": TODAY,
        "notes": "4 techs, receptionist left in April. Operating without one for 2 months.",
        "pain_points": "No receptionist for 2 months. Wife covering phones while managing kids at home. Burned out. Missing maintenance agreement renewals.",
    },
    {
        "source": "indeed",
        "business_name": "Gulf Coast Roofing Specialists",
        "contact_name": "Derek Chambers",
        "phone": "(832) 244-7109",
        "city": "Houston", "state": "TX",
        "niche": "roofing",
        "status": "New",
        "assigned_rep_id": APEX,
        "job_title": "front desk",
        "monthly_labor_cost": 2600,
        "batch_date": TODAY,
        "notes": "Residential roofer in Houston, hurricane season prep. Needs front desk for customer communication.",
        "pain_points": "Hurricane season starting. Homeowners calling repeatedly after storms, no tracking system. Losing jobs because they forget to call back.",
    },
    {
        "source": "indeed",
        "business_name": "Metro Electrical Services",
        "contact_name": "Brian Kowalski",
        "phone": "(972) 550-8834",
        "city": "Garland", "state": "TX",
        "niche": "electrical",
        "status": "New",
        "assigned_rep_id": APEX,
        "job_title": "receptionist",
        "monthly_labor_cost": 3400,
        "batch_date": TODAY,
        "notes": "Residential electrical, 6 techs. Hiring receptionist to handle inbound and schedule service calls.",
        "pain_points": "Losing same-day service call jobs — no one answers before 9am or after 4pm. Owner estimates 15-20 lost jobs per month.",
    },
]


def post(path, data):
    body = json.dumps(data).encode()
    req  = urllib.request.Request(
        f"{URL}{path}",
        data=body,
        headers={
            "apikey":          SERVICE,
            "Authorization":   f"Bearer {SERVICE}",
            "Content-Type":    "application/json",
            "Prefer":          "return=representation",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


print("=== Inserting 10 leads ===")
inserted = post("/rest/v1/leads", LEADS)
print(f"Inserted {len(inserted)} leads:")
booked_lead_id = None
for r in inserted:
    flag = " <-- BOOKED" if r["status"] == "Booked" else ""
    print(f"  {r['id'][:8]}  {r['business_name']:<40} [{r['status']}]{flag}")
    if r["status"] == "Booked":
        booked_lead_id = r["id"]

print()
print("=== Inserting test appointment (booked lead -> jordan22 closer) ===")
appt = post("/rest/v1/appointments", [{
    "lead_id":     booked_lead_id,
    "rep_id":      APEX,
    "closer_id":   JORDAN,
    "scheduled_at": f"{TODAY}T15:00:00Z",   # 3pm today
    "status":       "scheduled",
    "deal_value":   None,
    "closer_notes": "Rep surfaced strong pain — owner answering dispatch calls while driving. High urgency. Recommend Growth tier at minimum.",
}])
print(f"Appointment ID: {appt[0]['id'][:8]}... | status: {appt[0]['status']} | closer: jordan22 | lead: Texas Road Kings Towing")
