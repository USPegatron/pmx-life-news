import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * POST /api/flights/import
 *   body { text: "..." }   -- one flight per line, CSV columns:
 *     3 cols (minimum) : flight_date,airline_code,flight_number
 *     5 cols           : + dep_airport,arr_airport
 *     7 cols           : + scheduled_dep,scheduled_arr
 *   - dep_airport / arr_airport / scheduled_dep / scheduled_arr are all OPTIONAL.
 *   - scheduled_dep / scheduled_arr are optional ISO 8601 strings (e.g.
 *     2026-11-17T08:30:00Z or 2026-11-17 08:30). Invalid dates → null.
 *   - airline_name / aircraft_type are NOT settable via CSV — use the in-app
 *     "Update" modal after import, or use OpenCode/local server to enrich.
 *   - duplicates upsert on (flight_date, dep, arr, airline, flight#)
 */
function parseLine(line: string) {
  // No `.filter(Boolean)` here — empty trailing fields must still count toward
  // the column count, otherwise rows with blank optionals collapse wrongly.
  const parts = line.split(",").map((s) => s.trim());
  if (parts.length !== 3 && parts.length !== 5 && parts.length !== 7) return null;
  const [
    flight_date,
    dep_or_empty,
    arr_or_empty,
    airline_code,
    flight_number,
    scheduled_dep,
    scheduled_arr,
  ] = parts;
  if (
    !flight_date ||
    !airline_code ||
    !flight_number
  ) {
    return null;
  }

  // Accept YYYY-MM-DD (ISO) or M/D/YYYY (US) — normalise to ISO.
  const isoDate = (() => {
    const s = flight_date.trim();
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
      const [y, m, d] = s.split("-");
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const [, mo, d, y] = m;
      return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    return null;
  })();
  if (!isoDate) return null;

  // Parse optional ISO 8601 datetime. Invalid input → null (never throw —
  // `new Date("garbage").toISOString()` raises RangeError otherwise).
  const parseOptionalIso = (raw: string | undefined): string | null => {
    if (!raw) return null;
    try {
      return new Date(raw).toISOString();
    } catch {
      return null;
    }
  };

  return {
    flight_date: isoDate,
    dep_airport: (dep_or_empty || "").toUpperCase(),
    arr_airport: (arr_or_empty || "").toUpperCase(),
    airline_code: airline_code.toUpperCase(),
    flight_number: flight_number.toUpperCase(),
    scheduled_dep: parseOptionalIso(scheduled_dep),
    scheduled_arr: parseOptionalIso(scheduled_arr),
    status: "scheduled" as const,
    updated_by: "import",
  };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const text: string = (body?.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "no text provided" }, { status: 400 });
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "server not configured" }, { status: 500 });
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const flights = lines
    .map(parseLine)
    .filter((f): f is NonNullable<typeof f> => !!f);

  const skipped = lines.length - flights.length;
  if (!flights.length) {
    return NextResponse.json(
      {
        error: "no valid rows",
        skipped,
        hint: "每行 3/5/7 欄皆可。必填: flight_date(YYYY-MM-DD),airline_code,flight_number。可選: dep_airport,arr_airport,scheduled_dep,scheduled_arr。",
      },
      { status: 400 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey
  );

  const { data, error } = await supabase
    .from("flights_to_track")
    .upsert(flights, {
      onConflict: "flight_date,dep_airport,arr_airport,airline_code,flight_number",
      ignoreDuplicates: false,
    })
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ upserted: data?.length || 0, skipped, flights: data });
}
