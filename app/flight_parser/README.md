# PMX Flight Itinerary Parser & Server

Scans PMX flight-itinerary emails (.msg files) and IMAP mailboxes, parses
flight segments, filters out already-departed (expired) flights, and
maintains the results in:

* `D:\00_OneDrive\...\PMX - Flight Itinerary\report\flights_template.csv`
  — the cumulative CSV (append-only, deduped by `flight_date + flight#`).
* Supabase `flights_to_track` (PMX Life News flight tracker).

PMX policy:
* Track every flight that was offered/proposed in an email, not just the
  final ticketed one.
* Don't maintain flights whose departure date is in the past.
* Same flight number on the same date = one row regardless of passenger.

## Files

| File | Purpose |
|---|---|
| `parse_emails.py` | Core parser for .msg files (Outlook). Two body formats: concise `1.WN3037 11Nov ELPAUS 0635 0905` and table-style Chinese itinerary. |
| `parse_and_upload.py` | One-shot CLI: parse local folder → cumulative CSV → Supabase. |
| `expired_filter.py` | Drop segments whose `flight_date < today`. |
| `mailbox.py` | IMAP connector (stdlib `imaplib`). Fetches flight emails to a local cache. |
| `server.py` | FastAPI server (uvicorn). Endpoints below. |

## Cumulative CSV

Path: `D:\00_OneDrive\...\PMX - Flight Itinerary\report\flights_template.csv`

Columns: `flight_date, dep_airport, arr_airport, airline_code,
flight_number, airline_name, aircraft_type, scheduled_dep, scheduled_arr`

Append-only. Cross-run dedup by `(flight_date, airline_code, flight_number)`.

## Server endpoints

Run with:
```
python -m uvicorn app.flight_parser.server:app --host 127.0.0.1 --port 8765
```
or via `start.bat` → "flight parser server".

| Method | Path | Purpose |
|---|---|---|
| GET  | `/healthz` | Liveness |
| POST | `/api/scan-folder` | Parse a folder of `.msg` files; filter expired; append cumulative CSV; upload Supabase. |
| POST | `/api/scan-mailbox` | Search IMAP mailbox for `subject_contains`, fetch new messages, parse, upload. |
| POST | `/api/backfill` | Convenience: scan mailbox from the last 180 days (6 months). For one-time initial scan. |
| POST | `/api/daily-check` | Convenience: scan mailbox from the last 7 days. For daily schedule. |
| GET  | `/api/flights` | List tracked flights from Supabase. Optional filters: `from_date`, `to_date`, `status`. |
| POST | `/api/run-schedule` | Combined run: scan default folder + unseen mailbox. Mirrors the daily task. |

## CLI usage

Parse + upload everything in the default .msg folder:
```
python app\flight_parser\parse_and_upload.py
```
With options:
```
python app\flight_parser\parse_and_upload.py --src "<other folder>" --include-expired
```

Parse-only (write to a custom CSV):
```
python app\flight_parser\parse_emails.py --out my.csv --append --dedup
```

## IMAP configuration

Add to `app/crawler/.env`:
```
MAILBOX_HOST=outlook.office365.com
MAILBOX_PORT=993
MAILBOX_USER=you@pegatroncorp.com
MAILBOX_PASSWORD=<app password>
MAILBOX_FOLDER=INBOX
```

(Use an Exchange/Office 365 app password — not the account password.)

## Schedule

One-time: `POST /api/backfill` (scans last 180 days).
Daily:    `POST /api/daily-check` (scans last 7 days).
Wire both via Windows Task Scheduler calling `curl -X POST http://127.0.0.1:8765/api/backfill` etc., or use a wrapper `.bat` file. The server itself does not run a cron loop — keep `start.bat` running on a 24x7 machine.
