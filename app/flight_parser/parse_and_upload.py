"""One-shot pipeline: parse PMX itinerary emails, write CSV, append to the
desktop template, and upload to the Life News flight tracker (Supabase).

Steps:
  1. Run the body parser -> intermediate CSV in report/.
  2. Copy the new rows to C:\\Users\\Jacky2_Wang\\Desktop\\flights_template.csv
     (appended; original rows are preserved). Back up the template first.
  3. Upload the same rows to Supabase flights_to_track via REST + service_role
     key. The schema upsert key is
        (flight_date, dep_airport, arr_airport, airline_code, flight_number)
     so already-existing rows get refreshed, never duplicated. The import API
     accepts 3/5/7-column rows; we send 7 (no airline_name / aircraft_type —
     those columns are NOT settable via CSV per the API contract and will be
     filled by flight_enricher + backfill_airline).

Usage:
    python app/flight_parser/parse_and_upload.py
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
from datetime import datetime
from pathlib import Path

# UTF-8 stdout for Windows console
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore
except Exception:
    pass

import requests  # noqa: E402

PROJECT_ROOT = Path(
    r"D:\00_OneDrive\OneDrive - PEGATRON CORPORATION"
    r"\00_PEGAAi\Project\PMX - Life News"
)
DEFAULT_SRC = Path(
    r"D:\00_OneDrive\OneDrive - PEGATRON CORPORATION"
    r"\00_PEGAAi\Project\PMX - Flight Itinerary\data\flight itinerary"
)
CUMULATIVE_CSV = Path(
    r"D:\00_OneDrive\OneDrive - PEGATRON CORPORATION"
    r"\00_PEGAAi\Project\PMX - Flight Itinerary\report\flights_template.csv"
)
TEMPLATE_PATH = Path(r"C:\Users\Jacky2_Wang\Desktop\flights_template.csv")
TEMPLATE_BACKUP = TEMPLATE_PATH.with_suffix(
    TEMPLATE_PATH.suffix + f".bak_{datetime.now():%Y%m%d_%H%M%S}"
)

# Re-use the parser we already wrote.
sys.path.insert(0, str(PROJECT_ROOT / "app" / "flight_parser"))
import parse_emails  # type: ignore  # noqa: E402
import iata_tz        # type: ignore  # noqa: E402


def build_upload_csv(in_csv: Path, out_csv: Path) -> int:
    """Reshape the 9-col CSV into the 7-col format the import endpoint accepts.

    Columns: flight_date(YYYY-MM-DD), dep, arr, code, num, scheduled_dep, scheduled_arr
    - scheduled_dep/arr: filled with ISO 8601 + offset when the source CSV
      has HH:MM (or full ISO) — derived from `flight_date + HH:MM +
      airport IANA TZ`. Falls back to empty if we can't resolve the airport
      timezone (then flight_enricher / backfill_scheduled.py can fill later
      via web lookup).
    - flight_date is converted from M/D/YYYY to ISO YYYY-MM-DD.
    """
    with in_csv.open("r", encoding="utf-8") as fin, \
         out_csv.open("w", encoding="utf-8", newline="") as fout:
        r = csv.DictReader(fin)
        w = csv.writer(fout)
        w.writerow(["flight_date", "dep_airport", "arr_airport",
                    "airline_code", "flight_number",
                    "scheduled_dep", "scheduled_arr"])
        n = 0
        from datetime import datetime, timedelta
        try:
            from zoneinfo import ZoneInfo
        except ImportError:
            ZoneInfo = None  # type: ignore

        def _to_iso(date_str: str, time_str: str, airport: str) -> str:
            if not time_str:
                return ""
            # Already ISO?
            import re as _re
            if _re.match(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}", time_str):
                return time_str
            m = _re.match(r"^(\d{1,2}):(\d{2})(?:\+(\d+))?$", time_str.strip())
            if not m:
                return ""
            hh, mi = int(m.group(1)), int(m.group(2))
            plus = int(m.group(3) or 0)
            md = _re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", date_str.strip())
            if not md:
                return ""
            mo, d, y = int(md.group(1)), int(md.group(2)), int(md.group(3))
            tz_name = iata_tz.tz_for(airport)
            if not tz_name or ZoneInfo is None:
                return ""
            try:
                tz = ZoneInfo(tz_name)
            except Exception:
                return ""
            dt = datetime(y, mo, d, hh, mi, tzinfo=tz) + timedelta(days=plus)
            return dt.isoformat()

        for row in r:
            md = row["flight_date"]
            try:
                mo, d, y = md.split("/")
                iso = f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
            except ValueError:
                continue
            dep_iso = _to_iso(md, row.get("scheduled_dep", ""), row.get("dep_airport", ""))
            arr_iso = _to_iso(md, row.get("scheduled_arr", ""), row.get("arr_airport", ""))
            w.writerow([iso,
                        row["dep_airport"].upper(),
                        row["arr_airport"].upper(),
                        row["airline_code"].upper(),
                        row["flight_number"],
                        dep_iso,
                        arr_iso])
            n += 1
    return n


def append_to_template(csv_rows_csv: Path, template: Path) -> int:
    """Append rows from csv_rows_csv to the desktop template (keep existing).

    Returns number of rows appended. Backs up the template first to
    TEMPLATE_BACKUP (same folder, .bak_<ts> suffix) so we can restore if
    anything goes wrong.
    """
    if not template.exists():
        print(f"  ! template missing: {template}", file=sys.stderr)
        return 0
    # Backup
    backup = Path(str(template) + f".bak_{datetime.now():%Y%m%d_%H%M%S}")
    backup.write_bytes(template.read_bytes())
    print(f"  backup: {backup.name} ({backup.stat().st_size} bytes)")

    appended = 0
    with csv_rows_csv.open("r", encoding="utf-8") as fin, \
         template.open("a", encoding="utf-8", newline="") as fout:
        r = csv.DictReader(fin)
        w = csv.writer(fout)
        for row in r:
            w.writerow([row["flight_date"], row["dep_airport"],
                        row["arr_airport"], row["airline_code"],
                        row["flight_number"], row["airline_name"],
                        row["aircraft_type"], row["scheduled_dep"],
                        row["scheduled_arr"]])
            appended += 1
    return appended


def upload_to_supabase(upload_csv: Path, env_path: Path) -> dict:
    """POST the upload CSV to Supabase flights_to_track via service_role key.

    Uses Supabase's `/rest/v1/flights_to_track?on_conflict=...` upsert endpoint
    directly (bypasses the Vercel /api/flights/import server route, but with
    identical semantics: status='scheduled', updated_by='import').

    Reads `scheduled_dep` and `scheduled_arr` from the upload CSV — those
    columns are filled with full ISO 8601 + offset by `build_upload_csv`
    (HH:MM + flight_date + airport IANA TZ). Falls back to None when empty.

    Returns the parsed JSON response.
    """
    # Read .env
    env = {}
    for ln in env_path.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        if "=" in ln:
            k, v = ln.split("=", 1)
            env[k.strip()] = v.strip()
    url = env["SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    ca = env.get("REQUESTS_CA_BUNDLE")  # optional PEM for proxy

    rows: list[dict] = []
    with upload_csv.open("r", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            rows.append({
                "flight_date":   row["flight_date"],
                "dep_airport":   row["dep_airport"].upper(),
                "arr_airport":   row["arr_airport"].upper(),
                "airline_code":  row["airline_code"].upper(),
                "flight_number": row["flight_number"].upper(),
                "scheduled_dep": row.get("scheduled_dep") or None,
                "scheduled_arr": row.get("scheduled_arr") or None,
                "status":        "scheduled",
                "updated_by":    "import",
            })

    if not rows:
        return {"upserted": 0, "skipped": 0, "flights": []}

    endpoint = (
        f"{url}/rest/v1/flights_to_track"
        "?on_conflict=flight_date,dep_airport,arr_airport,airline_code,flight_number"
    )
    resp = requests.post(
        endpoint,
        params={"select": "id,flight_date,airline_code,flight_number,dep_airport,arr_airport"},
        headers={
            "apikey":        key,
            "Authorization": f"Bearer {key}",
            "Content-Type":  "application/json",
            "Prefer":        "resolution=merge-duplicates,return=representation",
        },
        json=rows,
        verify=ca if ca else True,
        timeout=30,
    )
    if not resp.ok:
        print(f"  ! HTTP {resp.status_code}: {resp.text[:500]}", file=sys.stderr)
        return {"error": resp.text, "status": resp.status_code}
    data = resp.json()
    return {"upserted": len(data), "flights": data}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    ap.add_argument("--cumulative", type=Path, default=CUMULATIVE_CSV,
                    help="Cumulative CSV (default: PMX Flight Itinerary/report/flights_template.csv)")
    ap.add_argument("--report-dir", type=Path,
                    default=PROJECT_ROOT / "report")
    ap.add_argument("--env", type=Path,
                    default=PROJECT_ROOT / "app" / "crawler" / ".env")
    ap.add_argument("--template", type=Path, default=TEMPLATE_PATH,
                    help="Legacy desktop template")
    ap.add_argument("--skip-append", action="store_true",
                    help="Don't append to the cumulative CSV (default: do append)")
    ap.add_argument("--skip-legacy", action="store_true",
                    help="Don't append to the legacy desktop template")
    ap.add_argument("--skip-upload", action="store_true",
                    help="Don't upload to Supabase")
    ap.add_argument("--overwrite", action="store_true",
                    help="Overwrite the cumulative CSV instead of appending")
    ap.add_argument("--include-expired", action="store_true",
                    help="Include flights whose departure date is already past "
                         "(default: skip — PMX policy is to not maintain expired flights)")
    args = ap.parse_args(argv)

    args.report_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    # ---- Step 1: parse emails ----
    staging_csv = args.report_dir / f"flight_itinerary_staging_{ts}.csv"
    upload_csv = args.report_dir / f"flight_itinerary_upload_{ts}.csv"

    raw_metas: list = []
    for p in sorted(args.src.glob("*.msg")):
        meta = parse_emails.parse_email(p)
        if meta is None:
            continue
        print(f"  [parse] {p.name}: {len(meta.segments)} seg(s)")
        raw_metas.append(meta)

    # Filter expired unless explicitly opted in
    if not args.include_expired:
        import expired_filter
        from datetime import date as _date
        kept_metas: list = []
        expired_total = 0
        for m in raw_metas:
            kept, expired = expired_filter.filter_expired(m.segments,
                                                          today=_date.today())
            expired_total += len(expired)
            m.segments = kept
            kept_metas.append(m)
        metas = kept_metas
        print(f"[filter] skipped {expired_total} expired segments (departed before today)")
    else:
        metas = raw_metas

    n_rows = parse_emails.write_csv(metas, staging_csv)
    print(f"\n[1] wrote {n_rows} rows to staging -> {staging_csv}")

    # ---- Step 2: append to the cumulative CSV (with cross-file dedup) ----
    if args.skip_append:
        print("[2] SKIP cumulative CSV append")
    else:
        n_app = parse_emails.write_csv(
            metas, args.cumulative,
            append=not args.overwrite, dedup=True,
        )
        action = "appended (new only)" if not args.overwrite else "overwrote"
        print(f"[2] {action}: {n_app} new rows -> {args.cumulative}")

    # ---- Step 3: shape a temporary upload CSV ----
    n_up = build_upload_csv(staging_csv, upload_csv)
    print(f"[3] shaped {n_up} rows for upload -> {upload_csv}")

    # ---- Step 4: legacy desktop template ----
    if args.skip_legacy:
        print("[4] SKIP legacy desktop template")
    else:
        n_app = append_to_template(staging_csv, args.template)
        print(f"[4] appended {n_app} rows to legacy {args.template}")

    # ---- Step 5: upload to Supabase ----
    if args.skip_upload:
        print("[5] SKIP upload")
    else:
        if not args.env.exists():
            print(f"[5] SKIP upload -- env not found: {args.env}", file=sys.stderr)
        else:
            res = upload_to_supabase(upload_csv, args.env)
            if "error" in res:
                print(f"[5] upload FAILED: {res.get('status')} {res['error'][:120]}")
            else:
                print(f"[5] uploaded {res['upserted']} flights (existing rows upserted)")
                for f in res.get("flights", [])[:5]:
                    print(f"     - {f.get('flight_date')} {f.get('airline_code')}{f.get('flight_number')} {f.get('dep_airport')}->{f.get('arr_airport')}")
                if len(res.get("flights", [])) > 5:
                    print(f"     ... and {len(res['flights'])-5} more")

    # NOTE: PMX policy is CSV = cumulative log (keep expired rows for history).
    # Only Supabase / Life News tracks non-expired flights. Do NOT purge CSV.

    print("\nDone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
