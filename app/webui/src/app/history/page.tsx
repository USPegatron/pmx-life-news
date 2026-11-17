"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Flight } from "@/lib/types";
import { getAirlineName, getAircraftName } from "@/lib/utils";

// ---------- Timezone helpers (same as FlightsView) ----------
const AIRPORT_TZ: Record<string, string> = {
  TPE: "Asia/Taipei", TSA: "Asia/Taipei", HKG: "Asia/Hong_Kong",
  NRT: "Asia/Tokyo", ICN: "Asia/Seoul", PVG: "Asia/Shanghai",
  PEK: "Asia/Shanghai", SIN: "Asia/Singapore", BKK: "Asia/Bangkok",
  KUL: "Asia/Kuala_Lumpur", DEL: "Asia/Kolkata", BOM: "Asia/Kolkata",
  MEX: "America/Mexico_City", TIJ: "America/Tijuana", GDL: "America/Mexico_City",
  MTY: "America/Monterrey", CJS: "America/Mexico_City", ELP: "America/Denver",
  LAX: "America/Los_Angeles", SFO: "America/Los_Angeles", SEA: "America/Los_Angeles",
  PHX: "America/Phoenix", LAS: "America/Los_Angeles", DEN: "America/Denver",
  ORD: "America/Chicago", ATL: "America/New_York", DFW: "America/Chicago",
  JFK: "America/New_York", EWR: "America/New_York", IAH: "America/Chicago",
  MIA: "America/New_York",
};

function fmtClock(iso: string | null, airportCode?: string | null): string {
  if (!iso) return "—";
  const tz = (airportCode && AIRPORT_TZ[airportCode.toUpperCase()]) || "UTC";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", minute: "2-digit", timeZone: tz, hour12: false,
    }).format(d);
  } catch {
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
}

function fmtDelay(scheduled: string | null, actual: string | null): string {
  if (!scheduled || !actual) return "";
  const diff = Math.round((new Date(actual).getTime() - new Date(scheduled).getTime()) / 60000);
  if (diff === 0) return "準點";
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const dur = h > 0 ? `${h}Hr${m > 0 ? ` ${m}Min` : ""}` : `${m}Min`;
  return diff > 0 ? `延遲 ${dur}` : `提早 ${dur}`;
}

// ---------- Page ----------
export default function HistoryPage() {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/flights?archived=true&limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setFlights(json.flights || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/#flights"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium
            bg-white border border-border rounded-lg
            text-ink-light hover:text-ink hover:border-ink/30 transition-colors"
        >
          ← 返回
        </Link>
        <h1 className="text-lg font-display font-semibold text-ink">歷史紀錄</h1>
        <span className="text-xs text-ink-light">({flights.length})</span>
      </div>

      {loading && (
        <div className="text-center py-12 text-ink-light text-sm">載入中…</div>
      )}

      {error && (
        <div className="text-center py-12 text-red-600 text-sm">
          載入失敗：{error}
          <button onClick={load} className="ml-3 underline">重試</button>
        </div>
      )}

      {!loading && !error && flights.length === 0 && (
        <div className="text-center py-12 text-ink-light text-sm">
          暫無歷史紀錄
        </div>
      )}

      {/* Flight list */}
      {!loading && !error && flights.length > 0 && (
        <div className="flex flex-col gap-3">
          {flights.map((f) => {
            const ref = `${f.airline_code}${f.flight_number}`;
            const airlineName = f.airline_name || getAirlineName(f.airline_code);
            const aircraftName = f.aircraft_type ? getAircraftName(f.aircraft_type) : null;
            return (
              <div
                key={f.id}
                className="bg-white border border-border rounded-xl p-4 shadow-card"
              >
                {/* Row 1: date + flight ref + airline + aircraft */}
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <span className="text-ink-light tabular-nums">{f.flight_date}</span>
                  <span className="font-semibold text-ink">{ref}</span>
                  {airlineName && (
                    <span className="text-ink-light">/ {airlineName}</span>
                  )}
                  {aircraftName && (
                    <span className="text-ink-light/60">/ {aircraftName}</span>
                  )}
                  {f.status === "cancelled" && (
                    <span className="text-[10px] font-medium text-white bg-red-600 rounded px-1.5 py-0.5">
                      Cancelled
                    </span>
                  )}
                  {f.archived_at && (
                    <span className="ml-auto text-[10px] text-ink-light/50">
                      歸檔 {new Date(f.archived_at).toLocaleDateString("zh-TW")}
                    </span>
                  )}
                </div>
                {/* Row 2: route + times */}
                <div className="grid grid-cols-2 mt-2 text-sm">
                  <div className="text-left">
                    <span className="font-semibold text-ink">{f.dep_airport}</span>
                    <span className="text-ink-light/60 ml-1.5 text-xs">{fmtDate(f.scheduled_dep)}</span>
                    <span className="font-semibold text-ink ml-1.5 tabular-nums">
                      {fmtClock(f.scheduled_dep, f.dep_airport)}
                    </span>
                    {f.actual_dep && (
                      <>
                        <span className="text-ink-light/50 text-xs ml-1.5">→</span>
                        <span className="text-ink tabular-nums ml-1.5">
                          {fmtClock(f.actual_dep, f.dep_airport)}
                        </span>
                        <span className="text-[10px] text-ink-light/60 ml-1">
                          {fmtDelay(f.scheduled_dep, f.actual_dep)}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="text-left">
                    <span className="font-semibold text-ink">{f.arr_airport}</span>
                    <span className="text-ink-light/60 ml-1.5 text-xs">{fmtDate(f.scheduled_arr)}</span>
                    <span className="font-semibold text-ink ml-1.5 tabular-nums">
                      {fmtClock(f.scheduled_arr, f.arr_airport)}
                    </span>
                    {f.actual_arr && (
                      <>
                        <span className="text-ink-light/50 text-xs ml-1.5">→</span>
                        <span className="text-ink tabular-nums ml-1.5">
                          {fmtClock(f.actual_arr, f.arr_airport)}
                        </span>
                        <span className="text-[10px] text-ink-light/60 ml-1">
                          {fmtDelay(f.scheduled_arr, f.actual_arr)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {/* Notes */}
                {f.notes && (
                  <p className="mt-2 text-xs text-ink-light/70">{f.notes}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
