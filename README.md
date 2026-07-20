# its-god-yo

Content-pipeline scripts for **It's God, Yo!** — a daily-verse service that renders
Scripture as short, casual text-message-style slang in multiple languages.

Backend lives in Supabase (project ref **`bkwtlfkhfbfyzgnozixw`**):
- `kjv_verses` — English source (KJV, public domain), 31,102 verses
- `rv1909_verses` — Spanish source (Reina-Valera 1909 / "Antigua", public domain), 31,084 verses
- `daily_slots` — one row per calendar date; holds the selected verse reference and the
  generated English + Spanish outputs (dual-AI agreement pattern)
- Edge Functions: `generate-daily-verse` (single-slot EN/ES generation), `generate-monthly-batch`, review/session functions

## scripts/

One-time data loaders for the Spanish Bible source table (`rv1909_verses`). The load has
already been run; these are committed for provenance and reproducibility.

- **`parse-rv1909.py`** — parses `spa-rv1909.usfx.xml` (USFX XML from
  [seven1m/open-bibles](https://github.com/seven1m/open-bibles), `spa-rv1909.usfx.xml`,
  sha256 `233b4d6a87f833ac809d0e68dcf9ba83c709d612e914a357a4f5473782b703a3`) into `verses.json`.
  Maps OSIS book codes to the **same English book identifiers used by `kjv_verses`**
  (e.g. `"Genesis"`, `"1 Chronicles"`, `"Song of Solomon"`) — deliberately, so the content
  pipeline can pick a verse reference once and look it up in both language tables by the same
  book/chapter/verse key. Produces 31,084 verses across 66 books.
- **`load-rv1909.py`** — bulk-inserts `verses.json` into `public.rv1909_verses` via PostgREST.
  Fetches the `service_role` key from the logged-in Supabase CLI at runtime
  (`supabase projects api-keys --project-ref <ref> -o json`) — no secret is hardcoded.

### Running

```bash
python3 -m venv venv && ./venv/bin/pip install lxml requests
curl -sSL -o spa-rv1909.usfx.xml \
  https://raw.githubusercontent.com/seven1m/open-bibles/master/spa-rv1909.usfx.xml
./venv/bin/python scripts/parse-rv1909.py   # -> verses.json + integrity report
./venv/bin/python scripts/load-rv1909.py    # -> bulk insert (requires `supabase login`)
```

Eligibility filtering (`eligible_for_daily`) is applied afterward from
`verse_exclusion_ranges` — the same rules as `kjv_verses`, since book identifiers match.

> **License note:** only the Reina-Valera **1909** ("Antigua") is public domain. Do not
> substitute RV1960 or later revisions — those remain copyright-enforced.
