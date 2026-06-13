"""Seed a realistic UNASSIGNED sample lead pool (Indeed + Google Maps).

Populates My Leads / batch / stats end-to-end with sample data shaped as if
pulled from the two real sources:

  - Indeed   : trades hiring posts (Profile A verticals) — carry job_title,
               monthly_labor_cost and hiring-driven pain_points.
  - Maps (V2): no-website local businesses — carry place_id and "missing
               calls / no online presence" pain_points.

All rows are status='New', assigned_rep_id=NULL, batch_date=NULL, so they sit
in the unassigned pool and flow into rep batches via assign_daily_batches
(00:05 UTC) — they do NOT fight the 150-cap on anyone's existing batch.

Idempotent-ish: every row is tagged in notes with the SENTINEL below, so a
re-run first deletes prior sample rows (by the sentinel) before re-inserting.

The service_role key is read from the environment (never hardcoded). Run:

  SUPABASE_SERVICE_ROLE_KEY=<key> python scripts/seed_sample_leads.py

Optionally override the project URL with SUPABASE_URL. Get the key from the
Supabase Dashboard → Project Settings → API → service_role (secret).
"""
import json, os, urllib.request, urllib.parse

URL = os.environ.get("SUPABASE_URL", "https://jjextitmbptoaolacocs.supabase.co")
SENTINEL = "[sample-pool]"  # tag in notes so the pool is identifiable/removable

SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SERVICE:
    raise SystemExit(
        "Missing SUPABASE_SERVICE_ROLE_KEY. Run:\n"
        "  SUPABASE_SERVICE_ROLE_KEY=<key> python scripts/seed_sample_leads.py"
    )
HEADERS = {
    "apikey": SERVICE,
    "Authorization": f"Bearer {SERVICE}",
    "Content-Type": "application/json",
}

# ── geography: TX core + Western expansion cities (matches scraper rotation) ─
CITIES = [
    ("Dallas", "TX"), ("Fort Worth", "TX"), ("Houston", "TX"), ("Austin", "TX"),
    ("San Antonio", "TX"), ("Plano", "TX"), ("Arlington", "TX"), ("Midland", "TX"),
    ("El Paso", "TX"), ("Lubbock", "TX"),
    ("Phoenix", "AZ"), ("Mesa", "AZ"), ("Tucson", "AZ"),
    ("Denver", "CO"), ("Colorado Springs", "CO"),
    ("Las Vegas", "NV"), ("Albuquerque", "NM"), ("Oklahoma City", "OK"),
    ("Tulsa", "OK"), ("Salt Lake City", "UT"),
]

# ── Indeed verticals: Profile A trades (hiring-driven) ─────────────────────
# (niche, role hired, labor cost band, prefix names, pain template)
INDEED_VERTICALS = [
    ("roofing", "front desk", (2200, 3000),
     ["Summit", "Lone Star", "Apex", "Gulf Coast", "Skyline", "Five Star", "Eagle"],
     ["Roofing", "Roofing & Restoration", "Exteriors", "Roofing Co"],
     "Storm leads going cold — no one follows up on estimates within 24h. Owner closes ~30% and wants the phones covered."),
    ("HVAC", "receptionist", (3000, 4200),
     ["Comfort", "Climate", "Cool Air", "Reliable", "Precision", "All Seasons", "Blue Ribbon"],
     ["HVAC", "Heating & Air", "Climate Control", "Air Conditioning"],
     "Calls hit voicemail during the summer surge. One office manager schedules everything and they lose install jobs to faster competitors."),
    ("electrical", "office manager", (3400, 4600),
     ["Capital City", "Metro", "Bright", "Volt", "Current", "Hill Country", "Patriot"],
     ["Electric", "Electrical", "Electrical Services", "Power & Light"],
     "Dispatch scheduling takes 45+ min per job. 5-day service backlog. Same-day calls lost before 9am / after 4pm."),
    ("landscaping", "office assistant", (2000, 2800),
     ["Green Horizon", "Evergreen", "Lawn Pro", "Desert Bloom", "Oasis", "TerraScape", "Cutting Edge"],
     ["Landscaping", "Lawn Care", "Landscape & Design", "Grounds"],
     "Spring rush — estimate requests pile up faster than the owner can call back. Crews idle while the phone rings out."),
    ("pressure washing", "scheduler", (1800, 2600),
     ["Pristine", "Blast", "Clear View", "Hydro", "Spotless", "Surface Pros", "Aqua"],
     ["Pressure Washing", "Exterior Cleaning", "Power Wash Co", "Soft Wash"],
     "Solo owner-operator can't answer while on a job. Books from a personal cell and forgets to return missed calls."),
    ("concrete", "front desk", (2400, 3200),
     ["Solid Ground", "Cornerstone", "Precision", "Foundation", "Texas", "Granite", "Ironclad"],
     ["Concrete", "Concrete & Paving", "Paving Co", "Flatwork"],
     "Bids requested faster than they're returned. No follow-up system; commercial GCs go with whoever calls back first."),
    ("hotshot trucking", "dispatcher", (2800, 4800),
     ["DFW", "Permian Basin", "Lone Star", "Rapid", "West Texas", "Frontier", "Roadrunner"],
     ["Hotshot Express", "Hotshot Freight", "Expedite", "Logistics"],
     "Freight sits on load boards unclaimed — no full-time board watcher. Owner dispatches at 11pm; the role has turned over 3x."),
    ("tow truck", "dispatcher", (3000, 4000),
     ["Texas Road Kings", "Big D", "24/7", "Rapid Response", "Statewide", "Anchor", "Guardian"],
     ["Towing", "Towing & Recovery", "Wrecker Service", "Recovery"],
     "Night shift has zero phone coverage. Owner dispatches while driving; municipal contracts at risk from slow response times."),
    ("oilfield services", "dispatcher", (3800, 5200),
     ["Permian", "Eagle Ford", "Basin", "Wildcat", "Rig", "Frontier", "Lone Star"],
     ["Oilfield Services", "Well Services", "Field Services", "Energy Services"],
     "Field tickets and crew check-ins run over group text. No accountability; routing inefficient and the owner coordinates after hours."),
    ("transportation", "dispatcher", (2800, 4200),
     ["Metroplex", "Sunbelt", "Crossroads", "Interstate", "Cardinal", "Horizon", "Vanguard"],
     ["Transport", "Trucking", "Freight Lines", "Logistics"],
     "Driver coordination by text, loads slipping through the cracks. Dispatcher seat empty 2 months; the owner is buried in calls."),
]

# ── Vertical 2: Google Maps no-website local businesses ────────────────────
MAPS_VERTICALS = [
    ("auto repair", ["Precision", "Hometown", "A-1", "Trusted", "Main Street", "Gearhead"],
     ["Auto Repair", "Automotive", "Auto & Tire", "Service Center"]),
    ("dental", ["Bright Smile", "Family", "Gentle", "Lakeside", "Cornerstone", "Magnolia"],
     ["Dental", "Dental Care", "Family Dentistry", "Dental Group"]),
    ("salon", ["Luxe", "Mane", "The Loft", "Polished", "Bella", "Studio"],
     ["Salon", "Hair Studio", "Salon & Spa", "Beauty Bar"]),
    ("plumbing", ["Rapid", "Reliable", "Anytime", "Pioneer", "Blue Drop", "Mr."],
     ["Plumbing", "Plumbing Co", "Plumbing & Drain", "Plumbers"]),
    ("restaurant", ["Casa", "The Local", "Smokehouse", "Corner", "Hearth", "Riverside"],
     ["Grill", "Kitchen", "Cantina", "BBQ", "Diner"]),
    ("chiropractic", ["Align", "Wellness", "Active Life", "Spine", "Peak", "Restore"],
     ["Chiropractic", "Chiropractic Center", "Spine & Wellness", "Health Center"]),
]


def _phone(i):
    area = [214, 817, 972, 469, 512, 210, 432, 915, 602, 480, 303, 702, 505, 405, 918, 801]
    return f"({area[i % len(area)]}) {(200 + i) % 900:03d}-{(1000 + i * 37) % 9000 + 1000:04d}"


def build_indeed():
    rows = []
    n = 0
    for niche, role, (lo, hi), prefixes, suffixes, pain in INDEED_VERTICALS:
        for k in range(14):  # 14 per vertical
            city, state = CITIES[(n + k) % len(CITIES)]
            name = f"{prefixes[k % len(prefixes)]} {suffixes[k % len(suffixes)]}"
            if k >= len(prefixes):
                name = f"{name} of {city}"
            rows.append({
                "source": "indeed",
                "business_name": name,
                "contact_name": None,
                "phone": _phone(n),
                "city": city, "state": state,
                "niche": niche,
                "status": "New",
                "assigned_rep_id": None,
                "batch_date": None,
                "job_title": role,
                "monthly_labor_cost": lo + ((n * 137) % (hi - lo)),
                "place_id": None,
                "notes": f"{SENTINEL} Hiring {role} on Indeed. {pain.split('.')[0]}.",
                "pain_points": pain,
            })
            n += 1
    return rows


def build_maps():
    rows = []
    n = 0
    for niche, prefixes, suffixes in MAPS_VERTICALS:
        for k in range(12):  # 12 per vertical
            city, state = CITIES[(n + k + 3) % len(CITIES)]
            name = f"{prefixes[k % len(prefixes)]} {suffixes[k % len(suffixes)]}"
            if k >= len(prefixes):
                name = f"{name} - {city}"
            rows.append({
                "source": "google_maps",
                "business_name": name,
                "contact_name": None,
                "phone": _phone(n + 500),
                "city": city, "state": state,
                "niche": niche,
                "status": "New",
                "assigned_rep_id": None,
                "batch_date": None,
                "job_title": None,
                "monthly_labor_cost": None,
                "place_id": f"SAMPLE_{niche.replace(' ', '_')}_{n:03d}",
                "notes": f"{SENTINEL} Maps listing, NO website. Reviews mention missed calls / voicemail.",
                "pain_points": "No website and no one answering during business hours. "
                               "Customers call competitors when it goes to voicemail. Strong reviews but losing new business to no online presence.",
            })
            n += 1
    return rows


def _req(method, path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    h = dict(HEADERS)
    if method in ("POST", "DELETE"):
        h["Prefer"] = "return=representation"
    req = urllib.request.Request(f"{URL}{path}", data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt else []
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} on {method} {path}:\n{e.read().decode()[:800]}")
        raise


def main():
    # 1. clear any prior sample rows (re-runnable). PostgREST treats * as the
    #    LIKE wildcard and it must stay UNencoded; match the bracket-free token.
    deleted = _req("DELETE", "/rest/v1/leads?notes=ilike.*sample-pool*&select=id")
    print(f"Cleared {len(deleted)} prior sample rows.")

    rows = build_indeed() + build_maps()
    inserted = []
    for i in range(0, len(rows), 100):  # insert in chunks of 100
        inserted += _req("POST", "/rest/v1/leads", rows[i:i + 100])
    indeed = sum(1 for r in inserted if r["source"] == "indeed")
    maps = sum(1 for r in inserted if r["source"] == "google_maps")
    print(f"Inserted {len(inserted)} sample leads: {indeed} Indeed, {maps} Maps (unassigned New pool).")
    by_niche = {}
    for r in inserted:
        by_niche[r["niche"]] = by_niche.get(r["niche"], 0) + 1
    for niche, c in sorted(by_niche.items()):
        print(f"  {niche:<22} {c}")


if __name__ == "__main__":
    main()
