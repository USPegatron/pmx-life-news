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
  flightTrafficLight,
  flightTrafficLightClass,
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

/** Locale-friendly long date for a flight_date string. */
function fmtFlightDate(dateStr: string, lang: Language): string {
  const date = parseFlightDate(dateStr);
  const locale = lang === "zh" ? "zh-TW" : lang === "es" ? "es-ES" : "en-US";
  return date.toLocaleDateString(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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
  notes: string;
  updated_by: string;
}

const EMPTY_FORM: UpdateForm = {
  status: "scheduled",
  scheduled_dep: "",
  scheduled_arr: "",
  actual_dep: "",
  actual_arr: "",
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
      "flight_date,dep_airport,arr_airport,airline_code,flight_number\n" +
      "2026-11-20,TPE,LAX,AA,1234\n" +
      "2026-11-21,ELP,IAH,UA,4521\n" +
      "2026-11-22,LAX,TPE,AA,1235\n";
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

  // ----- Group flights by date -----

  const groups = useMemo(() => {
    const map = new Map<string, Flight[]>();
    for (const f of flights) {
      const list = map.get(f.flight_date) ?? [];
      list.push(f);
      map.set(f.flight_date, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => {
        const at = a.scheduled_dep ? new Date(a.scheduled_dep).getTime() : Number.POSITIVE_INFINITY;
        const bt = b.scheduled_dep ? new Date(b.scheduled_dep).getTime() : Number.POSITIVE_INFINITY;
        return at - bt;
      });
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [flights]);

  // ----- Render -----

  const flightRef = editing
    ? `${editing.airline_code}${editing.flight_number}`
    : "";

  return (
    <>
      {/* Header bar */}
      <div className="flex items-start justify-between gap-3 mb-4 sm:mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-display font-semibold text-ink tracking-tight">
            {ui.flightHubTitle}
          </h1>
          <p className="text-sm text-ink-light mt-0.5 font-body">
            {ui.flightHubSubtitle}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          aria-label={ui.flightRefresh}
          className="inline-flex items-center justify-center px-3 py-2 text-sm font-medium
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
      </div>

      {/* Filter pills + import toggle */}
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
                transition-all duration-200"
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
                transition-all duration-200"
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
            placeholder={`flight_date,dep_airport,arr_airport,airline_code,flight_number
2026-11-18,TPE,LAX,BR,16
2026-11-19,LAX,TPE,BR,17`}
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

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col gap-3">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-border overflow-hidden shadow-card"
            >
              <div className="p-4 sm:p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-24 skeleton rounded" />
                  <div className="h-3 w-3 skeleton rounded-full" />
                  <div className="h-3 w-16 skeleton rounded" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="h-12 skeleton rounded-lg" />
                  <div className="h-12 skeleton rounded-lg" />
                </div>
              </div>
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

      {/* Empty */}
      {!isLoading && !error && groups.length === 0 && (
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

      {/* Flight list grouped by date */}
      {!isLoading && !error && groups.length > 0 && (
        <div className="flex flex-col gap-6">
          {groups.map(([date, list], gIdx) => (
            <section key={date} className={gIdx < 4 ? `fade-in fade-in-delay-${Math.min(gIdx + 1, 6)}` : ""}>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-light mb-2 font-display">
                {fmtFlightDate(date, language)}
              </h2>
              <div className="flex flex-col gap-3">
                {list.map((f) => (
                  <FlightCard
                    key={f.id}
                    flight={f}
                    language={language}
                    onUpdate={() => openEdit(f)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Update modal */}
      {editing && (
        <UpdateModal
          flightRef={flightRef}
          light={flightTrafficLight(editing)}
          form={form}
          setForm={setForm}
          onSave={handleSave}
          onClose={closeEdit}
          onPreset={applyPreset}
          isSaving={isSaving}
          saveError={saveError}
          language={language}
        />
      )}
    </>
  );
}

// ---------- Flight card ----------

function FlightCard({
  flight,
  language,
  onUpdate,
}: {
  flight: Flight;
  language: Language;
  onUpdate: () => void;
}) {
  const ui = getUIStrings(language);
  const light: FlightTrafficLight = flightTrafficLight(flight);
  const dotClass = flightTrafficLightClass(light);
  const ref = `${flight.airline_code}${flight.flight_number}`;

  // Status badge
  const statusText =
    flight.status === "departed"
      ? ui.flightStatusDeparted
      : flight.status === "arrived"
      ? ui.flightStatusArrived
      : flight.status === "cancelled"
      ? ui.flightStatusCancelled
      : ui.flightStatusScheduled;

  const statusClass =
    flight.status === "arrived"
      ? "bg-emerald-100 text-emerald-700"
      : flight.status === "departed"
      ? "bg-amber-100 text-amber-700"
      : flight.status === "cancelled"
      ? "bg-ink/10 text-ink-light"
      : "bg-aviation-topic/15 text-aviation-topic";

  const highlightArrival = flight.status === "departed" || flight.status === "arrived";

  // Delay line
  const delayLine = (() => {
    const d = flight.delay_minutes;
    if (d === null || d === undefined) return null;
    if (d === 0) return ui.flightDelayOnTime;
    if (d > 0) return ui.flightDelayLate(d);
    return ui.flightDelayEarly(Math.abs(d));
  })();

  return (
    <div className="relative bg-white rounded-xl border border-border shadow-card hover:shadow-card-hover hover:border-accent/40 transition-all duration-300">
      {/* Traffic-light dot */}
      <span
        className={`absolute top-3 right-3 sm:top-4 sm:right-4 w-3 h-3 rounded-full ${dotClass} ring-2 ring-white shadow-sm`}
        aria-hidden="true"
      />

      {/* Top row: airline + flight# + status */}
      <div className="flex items-center gap-2 px-4 sm:px-5 pt-4 pb-2 pr-12">
        <span className="font-display font-semibold text-ink text-base sm:text-lg tracking-tight">
          {ref}
        </span>
        <span className="text-ink-light text-xs sm:text-sm">·</span>
        <span className={`px-2 py-0.5 text-[10px] sm:text-xs font-semibold rounded-full uppercase tracking-wider ${statusClass}`}>
          {statusText}
        </span>
      </div>

      {/* Two panes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 border-t border-border">
        {/* Departure pane */}
        <FlightPane
          label={ui.flightLabelDeparture}
          iata={flight.dep_airport}
          scheduled={fmtClock(flight.scheduled_dep)}
          scheduledLabel={ui.flightTimeScheduled}
          actual={flight.actual_dep ? fmtClock(flight.actual_dep) : null}
          actualLabel={ui.flightTimeActual}
          highlighted={!highlightArrival}
          emptyActual={ui.flightTimeActual}
        />

        {/* Arrival pane */}
        <FlightPane
          label={ui.flightLabelArrival}
          iata={flight.arr_airport}
          scheduled={fmtClock(flight.scheduled_arr)}
          scheduledLabel={ui.flightTimeScheduled}
          actual={flight.actual_arr ? fmtClock(flight.actual_arr) : null}
          actualLabel={ui.flightTimeActual}
          highlighted={highlightArrival}
          emptyActual={ui.flightTimeActual}
          delayLine={delayLine}
        />
      </div>

      {/* Footer: update button */}
      <div className="flex items-center justify-end px-4 sm:px-5 py-3 border-t border-border">
        {flight.notes && (
          <span className="mr-auto text-xs text-ink-light truncate max-w-[60%] pr-3" title={flight.notes}>
            {flight.notes}
          </span>
        )}
        <button
          onClick={onUpdate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-medium
            bg-paper border border-border rounded-lg
            text-ink-light hover:text-accent hover:border-accent/50
            transition-all duration-200"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
          </svg>
          <span>{ui.flightUpdateButton}</span>
        </button>
      </div>
    </div>
  );
}

// ---------- Flight pane (one side of the card) ----------

function FlightPane({
  label,
  iata,
  scheduled,
  scheduledLabel,
  actual,
  actualLabel,
  emptyActual,
  highlighted,
  delayLine,
}: {
  label: string;
  iata: string;
  scheduled: string;
  scheduledLabel: string;
  actual: string | null;
  actualLabel: string;
  emptyActual: string;
  highlighted: boolean;
  delayLine?: string | null;
}) {
  return (
    <div
      className={`relative p-4 sm:p-5 flex flex-col gap-1.5 ${
        highlighted ? "bg-paper" : "bg-white"
      } sm:border-l sm:border-border first:sm:border-l-0`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] sm:text-xs uppercase tracking-wider font-medium text-ink-light">
          {label}
        </span>
        {delayLine && (
          <span className="text-[11px] sm:text-xs font-medium text-ink-light">
            {delayLine}
          </span>
        )}
      </div>
      <div className="font-display text-2xl sm:text-3xl font-semibold text-ink leading-none tracking-tight">
        {iata}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs sm:text-sm">
        <span className="text-ink-light">
          <span className="opacity-60 mr-1">{scheduledLabel}</span>
          <span className="font-mono text-ink">{scheduled || "—"}</span>
        </span>
        {actual && (
          <span className="text-ink">
            <span className="opacity-60 mr-1 text-ink-light">{actualLabel}</span>
            <span className="font-mono">{actual}</span>
          </span>
        )}
        {!actual && (
          <span className="text-ink-light/60 text-xs">
            <span className="opacity-60 mr-1">{emptyActual}</span>—
          </span>
        )}
      </div>
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
  onClose,
  onPreset,
  isSaving,
  saveError,
  language,
}: {
  flightRef: string;
  light: FlightTrafficLight;
  form: UpdateForm;
  setForm: React.Dispatch<React.SetStateAction<UpdateForm>>;
  onSave: (e: FormEvent) => void;
  onClose: () => void;
  onPreset: (kind: "onTime" | "delay20" | "delay60" | "cancel") => void;
  isSaving: boolean;
  saveError: string | null;
  language: Language;
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
