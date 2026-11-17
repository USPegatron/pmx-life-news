"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { Flight, Language } from "@/lib/types";
import {
  getUIStrings,
  flightDepLight,
  flightTrafficLight,
  flightTrafficLightClass,
  getAirlineName,
  getAircraftName,
  type FlightTrafficLight,
} from "@/lib/utils";

// ---------- Date / time helpers ----------

const REFRESH_INTERVAL_MS = 60 * 1000; // 60s

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" → Date in local midnight (no TZ shift). */
function parseFlightDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function todayISODate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function plusDaysISODate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "HH:mm" in local time for an ISO timestamp (or empty). */
function fmtClock(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** ISO → "YYYY-MM-DDTHH:mm" for <input type="datetime-local">. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" → ISO string (or empty). */
function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function addMinutes(iso: string | null, minutes: number): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + minutes * 60_000).toISOString();
}

// ---------- Types ----------

type Range = "today" | "7d" | "all";

interface UpdateForm {
  status: string;
  scheduled_dep: string; // datetime-local format
  scheduled_arr: string;
  actual_dep: string;
  actual_arr: string;
  airline_name: string;
  aircraft_type: string;
  notes: string;
  updated_by: string;
}

const EMPTY_FORM: UpdateForm = {
  status: "scheduled",
  scheduled_dep: "",
  scheduled_arr: "",
  actual_dep: "",
  actual_arr: "",
  airline_name: "",
  aircraft_type: "",
  notes: "",
  updated_by: "human",
};

// ---------- Component ----------

export function FlightsView({ language }: { language: Language }) {
  const ui = getUIStrings(language);

  // List state
  const [flights, setFlights] = useState<Flight[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("7d");

  // Import state
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState<string | null>(null);

  // Toast / banner
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update modal state
  const [editing, setEditing] = useState<Flight | null>(null);
  const [form, setForm] = useState<UpdateForm>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ----- Fetch -----

  const buildRangeParams = useCallback((): URLSearchParams => {
    const params = new URLSearchParams();
    if (range === "today") {
      params.set("from", todayISODate());
      params.set("to", todayISODate());
    } else if (range === "7d") {
      params.set("from", todayISODate());
      params.set("to", plusDaysISODate(7));
    } else {
      // "all" — wide window so the API still returns everything bounded by limit.
      params.set("from", "2000-01-01");
      params.set("to", "2100-12-31");
    }
    // Default to non-archived — the 1h-post-arrival archival is handled by the
    // daemon on the user's 24/7 machine; the UI just hides already-archived rows.
    params.set("archived", "false");
    params.set("limit", "500");
    return params;
  }, [range]);

  const fetchFlights = useCallback(
    async (refresh = false) => {
      if (refresh) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/flights?${buildRangeParams().toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as { flights?: Flight[] };
        setFlights(Array.isArray(json.flights) ? json.flights : []);
      } catch (err) {
        console.error("Failed to fetch flights:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [buildRangeParams]
  );

  // Initial fetch + whenever range changes
  useEffect(() => {
    fetchFlights(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // 60s auto-refresh
  useEffect(() => {
    const id = setInterval(() => {
      fetchFlights(true);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchFlights]);

  // Cleanup toast timeout on unmount
  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  // ----- Toast helpers -----

  const showToast = useCallback((kind: "success" | "error", text: string) => {
    setToast({ kind, text });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // ----- Handlers -----

  const handleRefresh = () => {
    fetchFlights(true);
  };

  // One-shot full refresh: server runs the check for every tracked flight
  // and reports how many were checked / skipped / archived.
  const handleRefreshAll = async () => {
    if (isRefreshingAll) return;
    setIsRefreshingAll(true);
    try {
      const res = await fetch("/api/flights/check-now", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      const checked = Number(json.checked) || 0;
      const skipped = Number(json.skipped) || 0;
      const archived = Number(json.archived) || 0;
      const errors = Array.isArray(json.errors) ? json.errors.length : 0;
      const errSuffix = errors ? (language === "zh" ? `，錯誤 ${errors}` : language === "es" ? `, errores ${errors}` : `, errors ${errors}`) : "";
      const msg =
        language === "zh"
          ? `已檢查 ${checked} 筆，略過 ${skipped}，已備份 ${archived}${errSuffix}`
          : language === "es"
          ? `Verificados ${checked}, omitidos ${skipped}, archivados ${archived}${errSuffix}`
          : `Checked ${checked}, skipped ${skipped}, archived ${archived}${errSuffix}`;
      showToast("success", msg);
      await fetchFlights(true);
    } catch (err) {
      const m = err instanceof Error ? err.message : "Unknown error";
      showToast("error", m);
    } finally {
      setIsRefreshingAll(false);
    }
  };

  const handleImport = async () => {
    const text = importText.trim();
    if (!text) {
      setImportError(ui.flightImportHint);
      return;
    }
    setIsImporting(true);
    setImportError(null);
    try {
      const res = await fetch("/api/flights/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      const n = Number(json?.upserted) || 0;
      showToast("success", ui.flightImportSuccess(n));
      setImportText("");
      setImportFileName(null);
      setImportOpen(false);
      await fetchFlights(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setImportError(msg);
      showToast("error", `${ui.flightImportFailed}: ${msg}`);
    } finally {
      setIsImporting(false);
    }
  };

  // ----- Import: template download + file upload -----

  const handleDownloadTemplate = () => {
    // Header + 3 example rows. Kept clean (no comment lines) so the server
    // parser can ingest it as-is — the parser drops the header because
    // `flight_date` fails the YYYY-MM-DD regex.
    const csv =
      "flight_date,dep_airport,arr_airport,airline_code,flight_number,airline_name,aircraft_type,scheduled_dep,scheduled_arr\n" +
      "2026-11-20,TPE,LAX,AA,1234,American Airlines,B738,2026-11-20T09:10,2026-11-20T10:20\n" +
      "2026-11-21,ELP,IAH,UA,4521,United Airlines,A320,2026-11-21T07:00,2026-11-21T09:30\n" +
      "2026-11-22,LAX,TPE,AA,1235,American Airlines,B77W,2026-11-22T13:00,2026-11-22T18:30\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = ui.flightTemplateFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so re-selecting the same file still triggers onChange.
    e.target.value = "";
    if (!file) {
      setImportFileName(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setImportText(text);
      setImportFileName(file.name);
      setImportError(null);
    };
    reader.onerror = () => {
      setImportError(ui.flightImportFailed);
    };
    reader.readAsText(file);
  };

  // ----- Modal: pre-fill on open -----

  const openEdit = (f: Flight) => {
    setEditing(f);
    setForm({
      status: f.status,
      scheduled_dep: isoToLocalInput(f.scheduled_dep),
      scheduled_arr: isoToLocalInput(f.scheduled_arr),
      actual_dep: isoToLocalInput(f.actual_dep),
      actual_arr: isoToLocalInput(f.actual_arr),
      airline_name: f.airline_name || "",
      aircraft_type: f.aircraft_type || "",
      notes: f.notes || "",
      updated_by: f.updated_by || "human",
    });
    setSaveError(null);
  };

  const closeEdit = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
  };

  const applyPreset = (kind: "onTime" | "delay20" | "delay60" | "cancel") => {
    const sched = form.scheduled_arr
      ? localInputToIso(form.scheduled_arr)
      : editing?.scheduled_arr ?? null;

    if (kind === "cancel") {
      setForm((f) => ({ ...f, status: "cancelled" }));
      return;
    }
    const delta = kind === "onTime" ? 0 : kind === "delay20" ? 20 : 60;
    const actual = addMinutes(sched, delta);
    setForm((f) => ({
      ...f,
      actual_arr: actual ? isoToLocalInput(actual) : f.actual_arr,
      status: "arrived",
    }));
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setIsSaving(true);
    setSaveError(null);

    const body: Record<string, unknown> = {};
    if (form.status && form.status !== editing.status) body.status = form.status;
    {
      const v = localInputToIso(form.scheduled_dep);
      if (v !== editing.scheduled_dep) body.scheduled_dep = v;
    }
    {
      const v = localInputToIso(form.scheduled_arr);
      if (v !== editing.scheduled_arr) body.scheduled_arr = v;
    }
    {
      const v = localInputToIso(form.actual_dep);
      if (v !== editing.actual_dep) body.actual_dep = v;
    }
    {
      const v = localInputToIso(form.actual_arr);
      if (v !== editing.actual_arr) body.actual_arr = v;
    }
    {
      const v = form.airline_name.trim();
      const cur = editing.airline_name || "";
      if (v !== cur) body.airline_name = v || null;
    }
    {
      const v = form.aircraft_type.trim();
      const cur = editing.aircraft_type || "";
      if (v !== cur) body.aircraft_type = v || null;
    }
    if ((form.notes || "") !== (editing.notes || "")) body.notes = form.notes || "";
    if (form.updated_by && form.updated_by !== editing.updated_by) {
      body.updated_by = form.updated_by;
    }

    if (Object.keys(body).length === 0) {
      // Nothing to update.
      closeEdit();
      return;
    }

    try {
      const res = await fetch(`/api/flights/${editing.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      showToast("success", ui.flightUpdatedToast);
      closeEdit();
      await fetchFlights(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!editing) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/flights/${editing.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      showToast("success", ui.flightUpdatedToast);
      closeEdit();
      await fetchFlights(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsSaving(false);
    }
  };

  // ----- Split flights into two columns (left = pending, right = in-transit) -----

  const { leftFlights, rightFlights } = useMemo(() => {
    const left: Flight[] = [];
    const right: Flight[] = [];
    for (const f of flights) {
      if (f.status === "cancelled") {
        // Cancelled: only go right if the plane somehow landed (actual_arr set).
        if (f.actual_arr) right.push(f);
        else left.push(f);
      } else {
        // Non-cancelled: go right once actual_dep is set (the plane has left).
        if (f.actual_dep) right.push(f);
        else left.push(f);
      }
    }
    left.sort((a, b) => {
      const at = a.scheduled_dep
        ? new Date(a.scheduled_dep).getTime()
        : Number.POSITIVE_INFINITY;
      const bt = b.scheduled_dep
        ? new Date(b.scheduled_dep).getTime()
        : Number.POSITIVE_INFINITY;
      return at - bt;
    });
    right.sort((a, b) => {
      const at = a.scheduled_arr
        ? new Date(a.scheduled_arr).getTime()
        : Number.POSITIVE_INFINITY;
      const bt = b.scheduled_arr
        ? new Date(b.scheduled_arr).getTime()
        : Number.POSITIVE_INFINITY;
      return at - bt;
    });
    return { leftFlights: left, rightFlights: right };
  }, [flights]);

  // ----- Render -----

  return (
    <>
      {/* Top filter row — range pills + refresh + import toggle. Sits below the
          global page header; intentionally non-sticky to avoid z-conflict. */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div
          role="group"
          aria-label="flight range"
          className="inline-flex rounded-lg border border-border bg-white p-0.5"
        >
          {(
            [
              ["today", ui.flightFilterToday],
              ["7d", ui.flightFilter7d],
              ["all", ui.flightFilterAll],
            ] as Array<[Range, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setRange(key)}
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors duration-200 ${
                range === key
                  ? "bg-ink text-paper"
                  : "text-ink-light hover:text-ink"
              }`}
              aria-pressed={range === key}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          aria-label={ui.flightRefresh}
          className="inline-flex items-center justify-center px-2.5 py-1.5 text-sm font-medium
            bg-white border border-border rounded-lg
            text-ink-light hover:text-accent hover:border-accent/50
            transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
            shrink-0"
        >
          <svg
            className={`w-4 h-4 ${isRefreshing ? "spin" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>

        {/* "Refresh all" — triggers POST /api/flights/check-now on the server,
            which iterates every tracked flight and reports a result summary. */}
        <button
          onClick={handleRefreshAll}
          disabled={isRefreshingAll}
          aria-label={ui.flightRefreshAll}
          title={ui.flightRefreshAll}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium
            bg-white border border-border rounded-lg
            text-ink-light hover:text-accent hover:border-accent/50
            transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
            shrink-0"
        >
          <svg
            className={`w-4 h-4 ${isRefreshingAll ? "spin" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <span>{ui.flightRefreshAll}</span>
        </button>

        <button
          onClick={() => {
            setImportOpen((v) => !v);
            setImportError(null);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium
            bg-white border border-border rounded-lg
            text-ink-light hover:text-accent hover:border-accent/50
            transition-all duration-200"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5-5m0 0l5 5m-5-5v12"
            />
          </svg>
          <span>{ui.flightImportToggle}</span>
        </button>
      </div>

      {/* Import panel (collapsed by default) */}
      {importOpen && (
        <div className="mb-6 bg-white border border-border rounded-xl p-4 shadow-card">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h2 className="text-sm font-display font-semibold text-ink">
              {ui.flightImportTitle}
            </h2>
            <button
              onClick={() => setImportOpen(false)}
              className="text-ink-light hover:text-ink p-1 -m-1"
              aria-label={ui.flightCloseButton}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Template download + file upload row */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium
                bg-white border border-border rounded-lg
                text-ink-light hover:text-accent hover:border-accent/50
                transition-colors duration-200"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 14l5 5m0 0l5-5m-5 5V4"
                />
              </svg>
              <span>{ui.flightTemplateButton}</span>
            </button>

            <label
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium
                bg-white border border-border rounded-lg cursor-pointer
                text-ink-light hover:text-accent hover:border-accent/50
                transition-colors duration-200"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5-5m0 0l5 5m-5-5v12"
                />
              </svg>
              <span>{ui.flightUploadButton}</span>
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={handleFileChange}
                aria-label={ui.flightUploadButton}
                className="hidden"
              />
            </label>

            {importFileName && (
              <span
                className="text-xs text-ink-light truncate max-w-[60%]"
                title={importFileName}
              >
                {importFileName}
              </span>
            )}
          </div>

          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={`flight_date,dep_airport,arr_airport,airline_code,flight_number[,airline_name][,aircraft_type][,scheduled_dep][,scheduled_arr]
2026-11-18,TPE,LAX,BR,16,Eva Air,B77W,2026-11-18T09:10,2026-11-18T10:20
2026-11-19,LAX,TPE,BR,17,Eva Air,B77W,2026-11-19T13:00,2026-11-19T18:30`}
            rows={6}
            className="w-full text-xs font-mono p-3 bg-paper border border-border rounded-lg
              text-ink placeholder-ink-light/70
              focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent
              transition-all duration-200 resize-y"
          />
          <p className="text-[11px] text-ink-light mt-2 leading-relaxed">
            {ui.flightImportHint}
          </p>
          {importError && (
            <p className="text-xs text-rose-600 mt-2">{importError}</p>
          )}
          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={() => setImportOpen(false)}
              className="px-3 py-2 text-xs font-medium bg-transparent text-ink-light hover:text-ink rounded-lg transition-colors"
            >
              {ui.flightCancelButton}
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={isImporting || !importText.trim()}
              className="px-4 py-2 text-xs font-medium bg-accent hover:bg-accent-hover text-white rounded-lg
                transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isImporting ? "…" : ui.flightImportButton}
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={`mb-4 px-4 py-2.5 rounded-lg text-sm font-medium border ${
            toast.kind === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-rose-50 text-rose-800 border-rose-200"
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Loading — two-column skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1].map((col) => (
            <div key={col} className="flex flex-col gap-1.5">
              <div className="h-5 w-32 skeleton rounded mb-2" />
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="bg-white border border-border rounded-md px-3 py-1.5 space-y-1.5"
                >
                  {/* Row 1 (skeleton): one light + 4 segments separated by `/` + update button.
                      Mirrors the real row 1 layout (single light, single-line meta). */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-3 w-3 skeleton rounded-full shrink-0" />
                    <div className="flex-1 min-w-0 flex items-center gap-1.5 text-[10px] text-ink-light/40">
                      <div className="h-3 w-12 skeleton rounded shrink-0" />
                      <span className="shrink-0">/</span>
                      <div className="h-3 w-14 skeleton rounded shrink-0" />
                      <span className="shrink-0">/</span>
                      <div className="h-3 w-20 skeleton rounded shrink-0" />
                      <span className="shrink-0">/</span>
                      <div className="h-3 w-10 skeleton rounded opacity-60 flex-1 min-w-0" />
                    </div>
                    <div className="h-3 w-8 skeleton rounded shrink-0" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="h-3 w-24 skeleton rounded" />
                    <div className="h-3 w-24 skeleton rounded" />
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-3">
            <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-lg font-display font-semibold text-ink mb-1">
            {ui.flightLoadError}
          </h2>
          <p className="text-sm text-ink-light mb-4 max-w-md">{error}</p>
          <button
            onClick={handleRefresh}
            className="px-5 py-2 text-sm font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors duration-200"
          >
            {ui.flightRefresh}
          </button>
        </div>
      )}

      {/* Empty (no flights at all) */}
      {!isLoading && !error && flights.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-ink/5 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-ink-light" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15l8.25-8.25 3 3 6.75-6.75M2.25 19.5h19.5a.75.75 0 00.75-.75V4.5a.75.75 0 00-.75-.75H2.25a.75.75 0 00-.75.75v14.25c0 .414.336.75.75.75z" />
            </svg>
          </div>
          <h2 className="text-xl font-display font-semibold text-ink mb-2">
            {ui.flightEmptyTitle}
          </h2>
          <p className="text-ink-light max-w-md">{ui.flightEmptyHint}</p>
        </div>
      )}

      {/* Two-column layout: 待出發 (left) + 已出發 (right). */}
      {!isLoading && !error && flights.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <FlightColumn
            title={ui.flightPendingDeparture}
            count={leftFlights.length}
            flights={leftFlights}
            language={language}
            onUpdate={openEdit}
            emptyText={ui.flightEmptyDepartures}
          />
          <FlightColumn
            title={ui.flightInTransit}
            count={rightFlights.length}
            flights={rightFlights}
            language={language}
            onUpdate={openEdit}
            emptyText={ui.flightEmptyArrivals}
          />
        </div>
      )}

      {/* Update modal */}
      {editing && (
        <UpdateModal
          flightRef={`${editing.airline_code}${editing.flight_number}`}
          light={flightTrafficLight(editing)}
          form={form}
          setForm={setForm}
          onSave={handleSave}
          onArchive={handleArchive}
          onClose={closeEdit}
          onPreset={applyPreset}
          isSaving={isSaving}
          saveError={saveError}
          language={language}
          canArchive={editing.status === "arrived"}
        />
      )}
    </>
  );
}

// ---------- Flight column (left or right) ----------

function FlightColumn({
  title,
  count,
  flights,
  language,
  onUpdate,
  emptyText,
}: {
  title: string;
  count: number;
  flights: Flight[];
  language: Language;
  onUpdate: (f: Flight) => void;
  emptyText: string;
}) {
  return (
    <section>
      <header className="flex items-center gap-2 mb-2">
        <h2 className="text-sm font-display font-semibold text-ink tracking-tight">
          {title}
        </h2>
        <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 text-[11px] font-semibold rounded-full bg-ink/5 text-ink-light tabular-nums">
          {count}
        </span>
      </header>
      {flights.length === 0 ? (
        <div className="text-xs text-ink-light/80 italic py-4 px-3 bg-white border border-border border-dashed rounded-md">
          「{emptyText}」
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {flights.map((f) => (
            <li key={f.id}>
              <CompactFlightCard
                flight={f}
                language={language}
                onUpdate={() => onUpdate(f)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- Compact flight card ----------

function CompactFlightCard({
  flight,
  language,
  onUpdate,
}: {
  flight: Flight;
  language: Language;
  onUpdate: () => void;
}) {
  const ui = getUIStrings(language);
  const depLight: FlightTrafficLight = flightDepLight(flight);
  const depDotClass = flightTrafficLightClass(depLight);
  const ref = `${flight.airline_code}${flight.flight_number}`;
  // Airline display name — DB value preferred, IATA lookup as fallback so the
  // user always sees a real name (e.g. "Southwest Airlines") instead of just
  // the IATA code. Kept as a stable var so the layout below can reference it.
  const airlineDisplayName =
    flight.airline_name?.trim() || getAirlineName(flight.airline_code) || "";

  return (
    <div className="group bg-white border border-border rounded-md px-3 py-1.5 transition-colors duration-200 hover:border-accent/40">
      {/* Row 1: single dep traffic-light dot + meta line (date / flight# / airline [/ aircraft])
          + update button. ONE light per card. The meta line is wrapped in `truncate`
          so the entire `date / ref / airline / aircraft` ellipsizes from the right
          when the column is narrow. Segments are joined with literal ` / ` (one space
          around the slash); the trailing `/ aircraft` segment is omitted entirely when
          `aircraft_type` is null. Date uses font-display (Playfair, normal weight);
          flight# uses font-body + font-semibold (bold); airline + aircraft use font-body
          at normal weight, lighter color. */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Dep traffic-light dot — single status indicator, leftmost. */}
        <span
          className={`shrink-0 inline-flex w-3 h-3 rounded-full ${depDotClass}`}
          aria-hidden="true"
        />
        {/* Meta line — date / flight# / airline [/ aircraft_type]. One line, truncated. */}
        <div className="flex-1 min-w-0 truncate text-sm leading-tight">
          {/* Date — display font, normal weight. Localized via ui.flightDateLabel
              (zh: 2026-11-16 / en: 11/16 / es: 16/11/2026). */}
          <span className="font-display text-ink tabular-nums">
            {ui.flightDateLabel(flight.flight_date)}
          </span>
          <span className="font-body text-ink-light/50"> / </span>
          {/* Flight# — bold so it stays scannable when everything's packed. */}
          <span className="font-body font-semibold text-ink">{ref}</span>
          {airlineDisplayName && (
            <>
              <span className="font-body text-ink-light/50"> / </span>
              <span className="font-body text-ink-light">{airlineDisplayName}</span>
            </>
          )}
          {flight.aircraft_type && (
            <>
              <span className="font-body text-ink-light/50"> / </span>
              <span className="font-body text-ink-light">{getAircraftName(flight.aircraft_type)}</span>
            </>
          )}
        </div>
        {/* Update button — small, opens the existing modal. */}
        <button
          onClick={onUpdate}
          className="shrink-0 inline-flex items-center px-2 py-0.5 text-[10px] font-medium
            bg-paper border border-border rounded
            text-ink-light hover:text-accent hover:border-accent/50
            transition-colors duration-200"
          aria-label={ui.flightUpdateButton}
        >
          {ui.flightUpdateButton}
        </button>
      </div>
      {/* Row 2: dep (left) + arr (right) airport/time. Unchanged from before. */}
      <div className="grid grid-cols-2 gap-3 mt-1">
        <Stop
          iata={flight.dep_airport}
          scheduled={fmtClock(flight.scheduled_dep)}
          actual={flight.actual_dep ? fmtClock(flight.actual_dep) : null}
        />
        <Stop
          iata={flight.arr_airport}
          scheduled={fmtClock(flight.scheduled_arr)}
          actual={flight.actual_arr ? fmtClock(flight.actual_arr) : null}
        />
      </div>
    </div>
  );
}

// ---------- Stop (one side of a flight card) ----------

function Stop({
  iata,
  scheduled,
  actual,
}: {
  iata: string;
  scheduled: string;
  actual: string | null;
}) {
  return (
    <div className="flex items-baseline gap-1.5 min-w-0 truncate">
      <span className="font-display font-semibold text-sm text-ink shrink-0 leading-none">
        {iata}
      </span>
      {actual && scheduled ? (
        <>
          <span className="text-[11px] font-mono text-ink-light leading-none">
            {scheduled}
          </span>
          <span className="text-[10px] text-ink-light/60 leading-none">→</span>
          <span className="text-xs font-mono font-semibold text-ink leading-none">
            {actual}
          </span>
        </>
      ) : actual ? (
        <span className="text-xs font-mono font-semibold text-ink leading-none">
          {actual}
        </span>
      ) : (
        <span className="text-xs font-mono text-ink-light leading-none">
          {scheduled || "—"}
        </span>
      )}
    </div>
  );
}

// ---------- Update modal ----------

function UpdateModal({
  flightRef,
  light,
  form,
  setForm,
  onSave,
  onArchive,
  onClose,
  onPreset,
  isSaving,
  saveError,
  language,
  canArchive,
}: {
  flightRef: string;
  light: FlightTrafficLight;
  form: UpdateForm;
  setForm: React.Dispatch<React.SetStateAction<UpdateForm>>;
  onSave: (e: FormEvent) => void;
  onArchive: () => void;
  onClose: () => void;
  onPreset: (kind: "onTime" | "delay20" | "delay60" | "cancel") => void;
  isSaving: boolean;
  saveError: string | null;
  language: Language;
  canArchive: boolean;
}) {
  const ui = getUIStrings(language);
  const dotClass = flightTrafficLightClass(light);

  // Close on escape + lock body scroll
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ui.flightUpdateModalTitle(flightRef)}
    >
      <div
        className="relative bg-paper w-screen sm:w-[80vw] max-w-full sm:max-w-2xl sm:rounded-2xl sm:shadow-xl sm:my-8 min-h-[100dvh] sm:min-h-0 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-paper/95 backdrop-blur border-b border-border sm:rounded-t-2xl px-4 sm:px-6 py-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span
              className={`mt-1.5 w-3 h-3 rounded-full ${dotClass} ring-2 ring-white shadow-sm shrink-0`}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-display font-semibold text-ink leading-snug">
                {ui.flightUpdateModalTitle(flightRef)}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={ui.flightCloseButton}
            className="flex-shrink-0 p-2 -m-2 rounded-lg text-ink-light hover:text-ink hover:bg-ink/5 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form body */}
        <form
          onSubmit={onSave}
          className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-5"
        >
          {/* Quick presets */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-light mb-2">
              Quick preset
            </label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["onTime", ui.flightPresetOnTime],
                  ["delay20", ui.flightPresetDelay20],
                  ["delay60", ui.flightPresetDelay60],
                  ["cancel", ui.flightPresetCancelled],
                ] as Array<["onTime" | "delay20" | "delay60" | "cancel", string]>
              ).map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => onPreset(key)}
                  className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-white border border-border rounded-lg
                    text-ink hover:text-accent hover:border-accent/50
                    transition-colors duration-200"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Status + Updated by */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-light mb-1.5">
                {ui.flightStatusLabel}
              </label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white border border-border rounded-lg text-ink
                  focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all duration-200"
              >
                <option value="scheduled">{ui.flightStatusScheduled}</option>
                <option value="departed">{ui.flightStatusDeparted}</option>
                <option value="arrived">{ui.flightStatusArrived}</option>
                <option value="cancelled">{ui.flightStatusCancelled}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-light mb-1.5">
                {ui.flightUpdatedByLabel}
              </label>
              <select
                value={form.updated_by}
                onChange={(e) => setForm((f) => ({ ...f, updated_by: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white border border-border rounded-lg text-ink
                  focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all duration-200"
              >
                <option value="human">{ui.flightUpdatedByHuman}</option>
                <option value="ai">{ui.flightUpdatedByAi}</option>
                <option value="import">{ui.flightUpdatedByImport}</option>
              </select>
            </div>
          </div>

          {/* Airline + Aircraft (new fields, optional) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-light mb-1.5">
                {language === "zh"
                  ? "航空公司"
                  : language === "es"
                  ? "Aerolínea"
                  : "Airline name"}
              </label>
              <input
                type="text"
                value={form.airline_name}
                onChange={(e) => setForm((f) => ({ ...f, airline_name: e.target.value }))}
                placeholder={language === "zh" ? "例如：長榮航空" : "e.g. EVA Air"}
                className="w-full px-3 py-2 text-sm bg-white border border-border rounded-lg text-ink
                  focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all duration-200"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-light mb-1.5">
                {language === "zh"
                  ? "機型"
                  : language === "es"
                  ? "Tipo de aeronave"
                  : "Aircraft type"}
              </label>
              <input
                type="text"
                value={form.aircraft_type}
                onChange={(e) => setForm((f) => ({ ...f, aircraft_type: e.target.value }))}
                placeholder="e.g. B77W"
                className="w-full px-3 py-2 text-sm bg-white border border-border rounded-lg text-ink font-mono
                  focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all duration-200"
              />
            </div>
          </div>

          {/* Scheduled / Actual times */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-light mb-1.5">
                {ui.flightTimeScheduled} · {ui.flightLabelDeparture}
              </label>
              <input
                type="datetime-local"
                value={form.scheduled_dep}
                onChange={(e) => setForm((f) => ({ ...f, scheduled_dep: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white border border-border rounded-lg text-ink font-mono
                  focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all duration-200"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-light mb-1.5">
                {ui.flightTimeScheduled} · {ui.flightLabelArrival}
              </label>
              <input
                type="datetime-local"
                value={form.scheduled_arr}
                onChange={(e) => setForm((f) => ({ ...f, scheduled_arr: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white border border-border rounded-lg text-ink font-mono
                  focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all duration-200"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-light mb-1.5">
                {ui.flightTimeActual} · {ui.flightLabelDeparture}
              </label>
              <input
                type="datetime-local"
                value={form.actual_dep}
                onChange={(e) => setForm((f) => ({ ...f, actual_dep: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white border border-border rounded-lg text-ink font-mono
                  focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all duration-200"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-light mb-1.5">
                {ui.flightTimeActual} · {ui.flightLabelArrival}
              </label>
              <input
                type="datetime-local"
                value={form.actual_arr}
                onChange={(e) => setForm((f) => ({ ...f, actual_arr: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white border border-border rounded-lg text-ink font-mono
                  focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all duration-200"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-light mb-1.5">
              {ui.flightNotesLabel}
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 text-sm bg-white border border-border rounded-lg text-ink
                focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all duration-200 resize-y"
            />
          </div>

          {/* Error */}
          {saveError && (
            <p className="text-sm text-rose-600">{saveError}</p>
          )}

          {/* Archive row — only for arrived flights */}
          {canArchive && (
            <div className="pt-2 border-t border-border flex items-center justify-between gap-3">
              <p className="text-xs text-ink-light leading-snug">
                {language === "zh"
                  ? "已備份的航班不再顯示於此頁面（1 小時後將由排程自動備份）。"
                  : language === "es"
                  ? "Los vuelos archivados dejan de mostrarse aquí (se archivan automáticamente 1 h después de la llegada)."
                  : "Archived flights are hidden here (auto-archived 1h after arrival)."}
              </p>
              <button
                type="button"
                onClick={onArchive}
                disabled={isSaving}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                  bg-white border border-border rounded-lg
                  text-ink-light hover:text-accent hover:border-accent/50
                  transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                  />
                </svg>
                <span>{ui.flightArchiveToggle}</span>
              </button>
            </div>
          )}

          {/* Submit row */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-sm font-medium bg-transparent text-ink-light hover:text-ink rounded-lg transition-colors disabled:opacity-50"
            >
              {ui.flightCancelButton}
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 text-sm font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {isSaving && (
                <svg className="w-3.5 h-3.5 spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              <span>{isSaving ? ui.flightSavingLabel : ui.flightSaveButton}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
