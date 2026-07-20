import json, subprocess, sys, requests

REF = "bkwtlfkhfbfyzgnozixw"
BASE = f"https://{REF}.supabase.co"

# Fetch service_role key via the logged-in Supabase CLI; never print it.
raw = subprocess.check_output(
    ["supabase", "projects", "api-keys", "--project-ref", REF, "-o", "json"],
    text=True,
)
keys = json.loads(raw)
service_key = next(k["api_key"] for k in keys if k.get("name") == "service_role")

headers = {
    "apikey": service_key,
    "Authorization": f"Bearer {service_key}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

with open("verses.json", encoding="utf-8") as f:
    verses = json.load(f)
print(f"Loaded {len(verses)} verses from JSON")

url = f"{BASE}/rest/v1/rv1909_verses"
BATCH = 1000
inserted = 0
for i in range(0, len(verses), BATCH):
    chunk = verses[i:i + BATCH]
    r = requests.post(url, headers=headers, data=json.dumps(chunk))
    if r.status_code not in (200, 201, 204):
        print(f"FAIL batch @ {i}: HTTP {r.status_code} {r.text[:300]}")
        sys.exit(1)
    inserted += len(chunk)
    print(f"  inserted {inserted}/{len(verses)}", flush=True)

print("DONE inserted:", inserted)
