import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const AVIATIONSTACK_KEY = process.env.AVIATIONSTACK_API_KEY || "";

// ---------- Timezone helpers for AviationStack local→UTC conversion ----------

const AIRPORT_TZ: Record<string, string> = {
  ELP: "America/Denver", LAX: "America/Los_Angeles", TPE: "Asia/Taipei",
  PHX: "America/Phoenix", DAL: "America/Chicago", SFO: "America/Los_Angeles",
  SEA: "America/Los_Angeles", LAS: "America/Los_Angeles", DEN: "America/Denver",
  ORD: "America/Chicago", ATL: "America/New_York", DFW: "America/Chicago",
  JFK: "America/New_York", EWR: "America/New_York", IAH: "America/Chicago",
  MIA: "America/New_York", MEX: "America/Mexico_City", TIJ: "America/Tijuana",
  GDL: "America/Mexico_City", NRT: "Asia/Tokyo", ICN: "Asia/Seoul",
  SIN: "Asia/Singapore", HKG: "Asia/Hong_Kong", PVG: "Asia/Shanghai",
  BKK: "Asia/Bangkok", KUL: "Asia/Kuala_Lumpur", DEL: "Asia/Kolkata",
};

/** Compute UTC offset (minutes) for an IANA timezone on a given date. */
function getUtcOffsetMinutes(tz: string, dateStr: string): number {
  try {
    const d = new Date(dateStr + "T12:00:00Z");
    const utcStr = d.toLocaleString("en-US", { timeZone: "UTC" });
    const tzStr = d.toLocaleString("en-US", { timeZone: tz });
    return (new Date(tzStr).getTime() - new Date(utcStr).getTime()) / 60000;
  } catch {
    return 0;
  }
}

/**
 * Convert a local airport time (e.g. "2026-11-17T16:20:00" at ELP) to UTC ISO.
 * AviationStack returns LOCAL time without offset; we must attach the airport's
 * UTC offset so Supabase stores the correct UTC instant.
 */
function localToUtcIso(localTime: string, airportCode: string): string {
  const tz = AIRPORT_TZ[(airportCode || "").toUpperCase()] || "UTC";
  const offsetMin = getUtcOffsetMinutes(tz, localTime.slice(0, 10));
  // localTime has no offset — treat as "the wall clock at the airport"
  // UTC = local - offset (offset is negative for west of UTC, e.g. -420 for MST)
  const d = new Date(localTime + "Z"); // parse as if UTC
  return new Date(d.getTime() - offsetMin * 60000).toISOString();
}

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
  const n = parts.length;
  // Supported: 3, 5, 7, 8, 9 columns
  if (n !== 3 && n !== 5 && n !== 7 && n !== 8 && n !== 9) return null;
  let flight_date: string, dep_airport: string, arr_airport: string;
  let airline_code: string, flight_number: string;
  let airline_name: string | undefined, aircraft_type: string | undefined;
  let scheduled_dep: string | undefined, scheduled_arr: string | undefined;

  if (n === 3) {
    [flight_date, airline_code, flight_number] = parts;
    dep_airport = ""; arr_airport = "";
  } else if (n === 5) {
    [flight_date, dep_airport, arr_airport, airline_code, flight_number] = parts;
  } else if (n === 7) {
    [flight_date, dep_airport, arr_airport, airline_code, flight_number, scheduled_dep, scheduled_arr] = parts;
  } else if (n === 8) {
    [flight_date, dep_airport, arr_airport, airline_code, flight_number, airline_name, aircraft_type, scheduled_dep] = parts;
    scheduled_arr = undefined;
  } else {
    // 9 cols: flight_date, dep, arr, airline, flight#, airline_name, aircraft_type, sched_dep, sched_arr
    [flight_date, dep_airport, arr_airport, airline_code, flight_number, airline_name, aircraft_type, scheduled_dep, scheduled_arr] = parts;
  }
  if (!flight_date || !airline_code || !flight_number) return null;

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
    dep_airport: (dep_airport || "").toUpperCase(),
    arr_airport: (arr_airport || "").toUpperCase(),
    airline_code: airline_code.toUpperCase(),
    flight_number: flight_number.toUpperCase(),
    airline_name: airline_name || null,
    aircraft_type: aircraft_type || null,
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

  // --- AviationStack auto-enrichment ---
  // For flights missing scheduled_dep, query AviationStack to fill in
  // scheduled times + aircraft type + dep/arr airports.
  let enriched = 0;
  const needsEnrich = (data || []).filter(
    (f: any) => !f.scheduled_dep && AVIATIONSTACK_KEY
  );

  if (needsEnrich.length > 0) {
    for (const fl of needsEnrich) {
      try {
        const iata = `${fl.airline_code}${fl.flight_number}`;
        const apiUrl = `https://api.aviationstack.com/v1/flights?access_key=${AVIATIONSTACK_KEY}&airline_code=${fl.airline_code}&flight_number=${fl.flight_number}&date=${fl.flight_date}`;
        const r = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) continue;
        const json = await r.json();
        const items: any[] = json?.data || [];
        // Find the matching flight by IATA code
        const match = items.find(
          (it) => it.flight?.iata?.toUpperCase() === iata.toUpperCase()
        );
        if (!match) continue;

        // Determine airports (prefer API result, fall back to existing)
        const depApt = (match.departure?.iata || fl.dep_airport || "").toUpperCase();
        const arrApt = (match.arrival?.iata || fl.arr_airport || "").toUpperCase();

        const update: Record<string, unknown> = {};
        if (match.departure?.scheduled) update.scheduled_dep = localToUtcIso(match.departure.scheduled, depApt);
        if (match.arrival?.scheduled) update.scheduled_arr = localToUtcIso(match.arrival.scheduled, arrApt);
        if (depApt && !fl.dep_airport) update.dep_airport = depApt;
        if (arrApt && !fl.arr_airport) update.arr_airport = arrApt;
        if (match.aircraft?.iata) update.aircraft_type = match.aircraft.iata;
        if (match.airline?.name && !fl.airline_name) update.airline_name = match.airline.name;

        if (Object.keys(update).length > 0) {
          await supabase
            .from("flights_to_track")
            .update(update)
            .eq("id", fl.id);
          enriched++;
        }
      } catch {
        // skip on error — don't block the import
      }
    }
  }

  return NextResponse.json({
    upserted: data?.length || 0,
    skipped,
    enriched,
    flights: data,
  });
}
