import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * POST /api/flights/import
 *   body { text: "..." }   -- one flight per line, CSV columns:
 *     flight_date,dep_airport,arr_airport,airline_code,flight_number[,scheduled_dep][,scheduled_arr]
 *   - scheduled_dep / scheduled_arr are optional ISO strings (e.g. 2026-11-18T08:30:00Z or 2026-11-18 08:30)
 *   - duplicates upsert on (flight_date, dep, arr, airline, flight#)
 */
function parseLine(line: string) {
  const parts = line.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 5) return null;
  const [
    flight_date,
    dep_airport,
    arr_airport,
    airline_code,
    flight_number,
    scheduled_dep,
    scheduled_arr,
  ] = parts;
  if (
    !flight_date ||
    !dep_airport ||
    !arr_airport ||
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

  return {
    flight_date: isoDate,
    dep_airport: dep_airport.toUpperCase(),
    arr_airport: arr_airport.toUpperCase(),
    airline_code: airline_code.toUpperCase(),
    flight_number: flight_number.toUpperCase(),
    scheduled_dep: scheduled_dep ? new Date(scheduled_dep).toISOString() : null,
    scheduled_arr: scheduled_arr ? new Date(scheduled_arr).toISOString() : null,
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
      { error: "no valid rows", skipped, hint: "每行格式: flight_date(YYYY-MM-DD),dep_airport,arr_airport,airline_code,flight_number" },
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
