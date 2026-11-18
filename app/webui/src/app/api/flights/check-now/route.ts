import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

// ---------- OpenSky (free, unlimited) ----------

const AIRPORT_COORDS: Record<string, [number, number]> = {
  ELP: [31.8067, -106.3776], CJS: [31.6361, -106.4286],
  LAX: [33.9425, -118.4081], SFO: [37.6213, -122.379], SEA: [47.4502, -122.3088],
  PHX: [33.4373, -112.0078], LAS: [36.084, -115.1537],
  DEN: [39.8561, -104.6737], ABQ: [35.0401, -106.6091], SLC: [40.7899, -111.9791],
  ORD: [41.9742, -87.9073], DFW: [32.8998, -97.0403], IAH: [29.9844, -95.3414], MSP: [44.8848, -93.2223],
  ATL: [33.6407, -84.4277], JFK: [40.6413, -73.7781], EWR: [40.6895, -74.1745], MIA: [25.7959, -80.287],
  DAL: [32.8471, -96.8519], AUS: [29.9809, -95.2173], HOU: [29.9844, -95.3414],
  BNA: [36.1267, -86.6748], TUL: [34.7294, -96.9135],
  MEX: [19.4361, -99.0719], TIJ: [32.541, -116.97], GDL: [20.5218, -103.3111], MTY: [25.7785, -100.1075],
  TPE: [25.0777, 121.2328], TSA: [25.0797, 121.2342],
  HKG: [22.308, 113.9185], NRT: [35.772, 140.3929], ICN: [37.4602, 126.4407],
  PVG: [31.1443, 121.8083], PEK: [40.0801, 116.5846],
  SIN: [1.3644, 103.9915], BKK: [13.69, 100.7501], KUL: [2.7456, 101.7099],
  DEL: [28.5562, 77.1], BOM: [19.0896, 72.8656],
};

type StateVector = { icao24: string; callsign: string; onGround: boolean };

async function fetchStatesBbox(lamin: number, lomin: number, lamax: number, lomax: number): Promise<StateVector[]> {
  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`OpenSky HTTP ${r.status}`);
  const data = await r.json();
  return (data?.states || []).map((s: unknown[]) => ({
    icao24: String(s[0] ?? ""),
    callsign: String(s[1] ?? "").trim(),
    onGround: Boolean(s[8]),
  }));
}

// ---------- AviationStack (100 req/month, manual only) ----------

const AIRPORT_TZ: Record<string, string> = {
  TPE: "Asia/Taipei", TSA: "Asia/Taipei",
  LAX: "America/Los_Angeles", SFO: "America/Los_Angeles", SEA: "America/Los_Angeles", LAS: "America/Los_Angeles",
  ELP: "America/Denver", DEN: "America/Denver", ABQ: "America/Denver", SLC: "America/Denver", CJS: "America/Denver",
  PHX: "America/Phoenix",
  ORD: "America/Chicago", DFW: "America/Chicago", IAH: "America/Chicago", MSP: "America/Chicago",
  DAL: "America/Chicago", AUS: "America/Chicago", HOU: "America/Chicago", BNA: "America/Chicago", TUL: "America/Chicago",
  ATL: "America/New_York", JFK: "America/New_York", EWR: "America/New_York", MIA: "America/New_York",
  MEX: "America/Mexico_City", TIJ: "America/Tijuana", GDL: "America/Mexico_City", MTY: "America/Monterrey",
  NRT: "Asia/Tokyo", ICN: "Asia/Seoul", PVG: "Asia/Shanghai", PEK: "Asia/Shanghai",
  SIN: "Asia/Singapore", BKK: "Asia/Bangkok", KUL: "Asia/Kuala_Lumpur",
  DEL: "Asia/Kolkata", BOM: "Asia/Kolkata", HKG: "Asia/Hong_Kong", MNL: "Asia/Manila",
};

function localToUtc(localIso: string, airportCode: string): string {
  const m = localIso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?([+-])(\d{2}):?(\d{2})?$/);
  if (m) {
    const [, y, mo, da, h, mi, , sign, oh, om] = m;
    const offsetMin = (parseInt(oh, 10) * 60 + parseInt(om ?? "0", 10)) * (sign === "-" ? -1 : 1);
    const utcDate = new Date(Date.UTC(+y, +mo - 1, +da, +h, +mi, +(m[6] ?? "0")) - offsetMin * 60000);
    return utcDate.toISOString();
  }
  const parsed = new Date(localIso);
  return Number.isNaN(parsed.getTime()) ? localIso : parsed.toISOString();
}

async function queryAviationStack(
  apiKey: string, airlineCode: string, flightNumber: string, date: string,
): Promise<{ depActual: string | null; arrActual: string | null; arrEstimated: string | null } | null> {
  const url = `https://api.aviationstack.com/v1/flights?access_key=${apiKey}&airline_code=${encodeURIComponent(
    airlineCode,
  )}&flight_number=${encodeURIComponent(flightNumber)}&date=${date}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) return null;
  const data = await r.json();
  const flights = data?.data as any[];
  if (!flights || flights.length === 0) return null;
  const ident = `${airlineCode}${flightNumber}`;
  const match = flights.find((f) => f?.flight?.iata === ident) || flights[0];
  if (!match) return null;
  return {
    depActual: match?.departure?.actual ?? null,
    arrActual: match?.arrival?.actual ?? null,
    arrEstimated: match?.arrival?.estimated ?? null,
  };
}

// ---------- Common ----------

type Flight = {
  id: string;
  flight_date: string;
  airline_code: string;
  flight_number: string;
  dep_airport: string;
  arr_airport: string;
  status: string | null;
  scheduled_dep: string | null;
  scheduled_arr: string | null;
  actual_dep: string | null;
  actual_arr: string | null;
  last_checked_at: string | null;
};

async function runCheck(maxFlights: number, useAviationStack: boolean) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ ok: false, error: "server not configured" }, { status: 500 });
  }
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);
  const avKey = useAviationStack ? process.env.AVIATIONSTACK_API_KEY : null;

  const stats = { checked: 0, updated: 0, archived: 0, apiCalls: 0, errors: 0 };
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  // 1. Auto-archive: arrived > 1hr ago
  const archiveCutoff = new Date(nowMs - 3600_000).toISOString();
  const { data: arrCandidates } = await supabase
    .from("flights_to_track")
    .select("id")
    .eq("status", "arrived")
    .lt("actual_arr", archiveCutoff)
    .is("archived_at", null)
    .limit(100);
  if (arrCandidates && arrCandidates.length > 0) {
    await supabase.from("flights_to_track").update({ archived_at: nowIso })
      .in("id", arrCandidates.map((c: { id: string }) => c.id));
    stats.archived = arrCandidates.length;
  }

  // 2. Fetch active flights
  const { data: flights, error: listErr } = await supabase
    .from("flights_to_track")
    .select("id,flight_date,airline_code,flight_number,dep_airport,arr_airport,status,scheduled_dep,scheduled_arr,actual_dep,actual_arr,last_checked_at")
    .is("archived_at", null)
    .in("status", ["scheduled", "departed"])
    .order("flight_date", { ascending: true })
    .limit(maxFlights);
  if (listErr) return NextResponse.json({ ok: false, error: listErr.message }, { status: 500 });

  for (const flight of (flights || []) as Flight[]) {
    stats.checked++;
    if (flight.actual_dep && flight.actual_arr) continue;

    // Rate limit: 15 min
    if (flight.last_checked_at) {
      const lastMs = new Date(flight.last_checked_at).getTime();
      if (!Number.isNaN(lastMs) && nowMs - lastMs < 15 * 60_000) continue;
    }

    const update: Record<string, unknown> = { last_checked_at: nowIso, updated_by: "ai" };

    if (avKey) {
      // ---- AviationStack path (manual "更新全部" button) ----
      try {
        const result = await queryAviationStack(avKey, flight.airline_code, flight.flight_number, flight.flight_date);
        stats.apiCalls++;
        if (result) {
          if (result.depActual && flight.dep_airport && !flight.actual_dep) {
            update.actual_dep = localToUtc(result.depActual, flight.dep_airport);
            update.status = "departed";
          }
          if (result.arrActual && flight.arr_airport && !flight.actual_arr) {
            update.actual_arr = localToUtc(result.arrActual, flight.arr_airport);
            update.status = "arrived";
          } else if (result.arrEstimated && flight.arr_airport && !flight.actual_arr) {
            // Use estimated as pre-arrival estimate
            update.actual_arr = localToUtc(result.arrEstimated, flight.arr_airport);
          }
        }
      } catch {
        stats.errors++;
      }
    } else {
      // ---- OpenSky path (free, cron) ----
      const dep = flight.dep_airport?.toUpperCase();
      const arr = flight.arr_airport?.toUpperCase();
      if (!dep || !arr || !AIRPORT_COORDS[dep] || !AIRPORT_COORDS[arr]) {
        // Can't check via OpenSky; just mark last_checked_at
        await supabase.from("flights_to_track").update(update).eq("id", flight.id);
        continue;
      }

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
      } catch {
        stats.errors++;
        await supabase.from("flights_to_track").update(update).eq("id", flight.id);
        continue;
      }

      const ident = `${flight.airline_code}${flight.flight_number}`;
      const csRe = new RegExp(`\\b${ident}\\b`, "i");
      const matched = [...depStates, ...arrStates].filter((a) => a.callsign && csRe.test(a.callsign));
      const depAirborne = matched.filter((a) => depStates.includes(a) && !a.onGround);
      const arrGround = matched.filter((a) => arrStates.includes(a) && a.onGround);

      if (arrGround.length > 0 && !flight.actual_arr) {
        update.actual_arr = nowIso;
        update.status = "arrived";
      } else if (depAirborne.length > 0 && !flight.actual_dep) {
        update.actual_dep = nowIso;
        update.status = "departed";
      }
    }

    const { error: upErr } = await supabase.from("flights_to_track").update(update).eq("id", flight.id);
    if (upErr) stats.errors++;
    else stats.updated++;
  }

  return NextResponse.json({ ok: true, ...stats });
}

// GET = cron (OpenSky only, free)
export async function GET() {
  return runCheck(10, false);
}

// POST = manual "更新全部" button (AviationStack, uses API quota)
export async function POST(req: Request) {
  let maxFlights = 10;
  try {
    const body = (await req.json().catch(() => ({}))) as { max?: number; maxFlights?: number };
    const requested = body.max ?? body.maxFlights;
    if (typeof requested === "number" && requested > 0 && requested <= 50) {
      maxFlights = Math.floor(requested);
    }
  } catch { /* ignore */ }
  return runCheck(maxFlights, true);
}
