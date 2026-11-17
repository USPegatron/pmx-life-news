import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 10; // Vercel Hobby ceiling

// Common PMX-relevant airports (lat, lon). Mirrors app/flight_tracker/opensky_provider.py
const AIRPORT_COORDS: Record<string, [number, number]> = {
  ELP: [31.8067, -106.3776],
  CJS: [31.6361, -106.4286],
  LAX: [33.9425, -118.4081],
  PHX: [33.4373, -112.0078],
  LAS: [36.084, -115.1537],
  DEN: [39.8561, -104.6737],
  ORD: [41.9742, -87.9073],
  ATL: [33.6407, -84.4277],
  DFW: [32.8998, -97.0403],
  SFO: [37.6213, -122.379],
  SEA: [47.4502, -122.3088],
  JFK: [40.6413, -73.7781],
  EWR: [40.6895, -74.1745],
  IAH: [29.9844, -95.3414],
  MIA: [25.7959, -80.287],
  MEX: [19.4361, -99.0719],
  TIJ: [32.541, -116.97],
  GDL: [20.5218, -103.3111],
  MTY: [25.7785, -100.1075],
  TPE: [25.0777, 121.2328],
  TSA: [25.0797, 121.2342],
  HKG: [22.308, 113.9185],
  NRT: [35.772, 140.3929],
  ICN: [37.4602, 126.4407],
  PVG: [31.1443, 121.8083],
  PEK: [40.0801, 116.5846],
  SIN: [1.3644, 103.9915],
  BKK: [13.69, 100.7501],
  KUL: [2.7456, 101.7099],
  DEL: [28.5562, 77.1],
  BOM: [19.0896, 72.8656],
};

type Flight = {
  id: string;
  airline_code: string;
  flight_number: string;
  dep_airport: string;
  arr_airport: string;
  aircraft_type: string | null;
};

type StateVector = { icao24: string; callsign: string; onGround: boolean };

async function fetchStatesBbox(
  lamin: number,
  lomin: number,
  lamax: number,
  lomax: number,
): Promise<StateVector[]> {
  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`OpenSky HTTP ${r.status}`);
  const data = await r.json();
  return (data?.states || []).map((s: unknown[]) => ({
    icao24: String(s[0] ?? ""),
    callsign: String(s[1] ?? "").trim(),
    onGround: Boolean(s[8]),
  }));
}

async function fetchAircraftTypecode(icao24: string): Promise<string | null> {
  try {
    const r = await fetch(`https://opensky-network.org/api/metadata/aircraft/icao24/${icao24}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return typeof data?.typecode === "string" ? data.typecode : null;
  } catch {
    return null;
  }
}

function inferStatus(
  dep: StateVector[],
  arr: StateVector[],
  matchedDepAirborne: StateVector[],
  matchedArrGround: StateVector[],
): "scheduled" | "departed" | "arrived" {
  if (matchedArrGround.length > 0 && matchedDepAirborne.length === 0) return "arrived";
  if (matchedDepAirborne.length > 0) return "departed";
  return "scheduled";
}

export async function POST(req: Request) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ ok: false, error: "server not configured" }, { status: 500 });
  }
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);

  // Optional: allow caller to cap how many flights to process this call.
  // Default is small to stay under Vercel Hobby's 10s function limit;
  // callers can pass higher `max` (up to 50) on Pro plans.
  let maxFlights = 2;
  try {
    const body = (await req.json().catch(() => ({}))) as { max?: number };
    if (typeof body.max === "number" && body.max > 0 && body.max <= 50) {
      maxFlights = Math.floor(body.max);
    }
  } catch {
    /* ignore */
  }

  const stats = { checked: 0, updated: 0, archived: 0, errors: 0 };
  const nowIso = new Date().toISOString();

  // 1. Auto-archive flights that arrived > 1 hour ago
  const archiveCutoff = new Date(Date.now() - 3600 * 1000).toISOString();
  const { data: arrCandidates } = await supabase
    .from("flights_to_track")
    .select("id")
    .eq("status", "arrived")
    .lt("actual_arr", archiveCutoff)
    .is("archived_at", null)
    .limit(100);
  if (arrCandidates && arrCandidates.length > 0) {
    await supabase
      .from("flights_to_track")
      .update({ archived_at: nowIso })
      .in(
        "id",
        arrCandidates.map((c: { id: string }) => c.id),
      );
    stats.archived = arrCandidates.length;
  }

  // 2. Fetch non-archived flights that need status check
  const horizon = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: flights, error: listErr } = await supabase
    .from("flights_to_track")
    .select(
      "id,airline_code,flight_number,dep_airport,arr_airport,aircraft_type,scheduled_dep,scheduled_arr,actual_dep,actual_arr",
    )
    .is("archived_at", null)
    .in("status", ["scheduled", "departed"])
    .lte("flight_date", horizon)
    .order("flight_date", { ascending: true })
    .limit(maxFlights);
  if (listErr) {
    return NextResponse.json({ ok: false, error: listErr.message }, { status: 500 });
  }

  // 3. For each flight: query OpenSky for dep + arr bbox, callsign match
  for (const flight of (flights || []) as Flight[]) {
    stats.checked++;
    const dep = flight.dep_airport?.toUpperCase();
    const arr = flight.arr_airport?.toUpperCase();
    if (!dep || !arr || !AIRPORT_COORDS[dep] || !AIRPORT_COORDS[arr]) continue;

    const deg = 0.4;
    const [depLat, depLon] = AIRPORT_COORDS[dep];
    const [arrLat, arrLon] = AIRPORT_COORDS[arr];

    let depStates: StateVector[] = [];
    let arrStates: StateVector[] = [];
    try {
      [depStates, arrStates] = await Promise.all([
        fetchStatesBbox(depLat - deg, depLon - deg, depLat + deg, depLon + deg),
        fetchStatesBbox(arrLat - deg, arrLon - deg, arrLat + deg, arrLon + deg),
      ]);
    } catch (e) {
      stats.errors++;
      // Still stamp last_checked_at so we don't hammer this one next time
      await supabase
        .from("flights_to_track")
        .update({
          last_checked_at: nowIso,
          notes: `OpenSky fetch error: ${String(e).slice(0, 180)}`,
          updated_by: "ai",
        })
        .eq("id", flight.id);
      continue;
    }

    const ident = `${flight.airline_code}${flight.flight_number}`;
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const csRe = new RegExp(`\\b(?:${esc(flight.airline_code)}${esc(flight.flight_number)}|${esc(ident)})\\b`, "i");
    const matched = [...depStates, ...arrStates].filter((a) => a.callsign && csRe.test(a.callsign));
    const matchedDepAirborne = matched.filter((a) => depStates.includes(a) && !a.onGround);
    const matchedArrGround = matched.filter((a) => arrStates.includes(a) && a.onGround);

    const status = inferStatus(depStates, arrStates, matchedDepAirborne, matchedArrGround);

    // Try to populate aircraft_type (ICAO typecode like B738) for the first matched aircraft.
    let aircraft_type = flight.aircraft_type;
    if (!aircraft_type && matched.length > 0) {
      aircraft_type = await fetchAircraftTypecode(matched[0].icao24);
    }

    const update: Record<string, unknown> = {
      last_checked_at: nowIso,
      updated_by: "ai",
    };
    if (status !== "scheduled") update.status = status;
    if (aircraft_type && aircraft_type !== flight.aircraft_type) update.aircraft_type = aircraft_type;

    const { error: upErr } = await supabase
      .from("flights_to_track")
      .update(update)
      .eq("id", flight.id);
    if (upErr) {
      stats.errors++;
    } else {
      stats.updated++;
    }
  }

  return NextResponse.json({ ok: true, ...stats });
}
