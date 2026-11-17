import type { Flight, NewsItem, Language, TranslatedContent } from "./types";

/**
 * Get translated content for a news item based on language
 * Falls back to English if translation is missing
 */
export function getTranslatedContent(
  item: NewsItem,
  lang: Language
): TranslatedContent {
  const fallbackTitle = item.title_en;
  const fallbackSummary = item.summary_en || "";

  if (lang === "zh") {
    return {
      title: item.title_zh || fallbackTitle,
      summary: item.summary_zh || fallbackSummary,
    };
  }

  if (lang === "es") {
    return {
      title: item.title_es || fallbackTitle,
      summary: item.summary_es || fallbackSummary,
    };
  }

  return {
    title: fallbackTitle,
    summary: fallbackSummary,
  };
}

/**
 * Format relative time in the specified language
 */
export function formatRelativeTime(
  dateStr: string | null,
  lang: Language
): string {
  if (!dateStr) return "";

  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  const labels = {
    zh: {
      justNow: "剛剛",
      minute: (n: number) => `${n} 分鐘前`,
      hour: (n: number) => `${n} 小時前`,
      day: (n: number) => `${n} 天前`,
      date: (d: Date) =>
        `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`,
    },
    es: {
      justNow: "ahora mismo",
      minute: (n: number) => `hace ${n} min`,
      hour: (n: number) => `hace ${n} h`,
      day: (n: number) => `hace ${n} d`,
      date: (d: Date) =>
        `${d.getDate()} ${d.toLocaleDateString("es-ES", { month: "short" })} ${d.getFullYear()}`,
    },
    en: {
      justNow: "just now",
      minute: (n: number) => `${n}m ago`,
      hour: (n: number) => `${n}h ago`,
      day: (n: number) => `${n}d ago`,
      date: (d: Date) =>
        d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    },
  };

  const label = labels[lang];

  if (diffMins < 1) return label.justNow;
  if (diffMins < 60) return label.minute(diffMins);
  if (diffHours < 24) return label.hour(diffHours);
  if (diffDays < 7) return label.day(diffDays);

  return label.date(date);
}

/**
 * Format date for aria-label (full readable date)
 */
export function formatFullDate(dateStr: string | null, lang: Language): string {
  if (!dateStr) return "";

  const date = new Date(dateStr);
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };

  const locale = lang === "zh" ? "zh-TW" : lang === "es" ? "es-ES" : "en-US";
  return date.toLocaleDateString(locale, options);
}

/**
 * Fallback landscape photos for items without an image. El Paso / Juárez
 * skylines from Wikimedia Commons (CC-licensed; hotlinkable from browser).
 */
export const FALLBACK_LANDSCAPES: string[] = [
  "https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/El_Paso_skyline.jpg/960px-El_Paso_skyline.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Downtown_El_Paso_Skyline.jpg/960px-Downtown_El_Paso_Skyline.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/El_Paso_Cityscape_%28cropped%29.jpg/960px-El_Paso_Cityscape_%28cropped%29.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bd/El_Paso_Franklin_Mountains_and_Scenic_Drive_aerial.jpg/960px-El_Paso_Franklin_Mountains_and_Scenic_Drive_aerial.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Ciudad_Ju%C3%A1rez%2C_skyline.jpg/960px-Ciudad_Ju%C3%A1rez%2C_skyline.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Ciudad_Ju%C3%A1rez_Skyline_%28Misiones%29.jpg/960px-Ciudad_Ju%C3%A1rez_Skyline_%28Misiones%29.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Ciudad_Ju%C3%A1rez_Skyline_%28Paseo_Triunfo%29.jpg/960px-Ciudad_Ju%C3%A1rez_Skyline_%28Paseo_Triunfo%29.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Skyline_Ju%C3%A1rez-El_Paso.jpg/960px-Skyline_Ju%C3%A1rez-El_Paso.jpg",
];

/** Stable pseudo-random pick of a fallback landscape for a given seed. */
export function getFallbackLandscape(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_LANDSCAPES[h % FALLBACK_LANDSCAPES.length];
}

/**
 * Get localized UI strings
 */
export function getUIStrings(lang: Language) {
  return {
    // Header
    hubName:
      lang === "zh"
        ? "邊境與天空"
        : lang === "es"
        ? "Frontera y Vuelo"
        : "Border & Flight",
    hubSubtitle:
      lang === "zh"
        ? "埃爾帕索 / 華雷斯 × 全球航空"
        : lang === "es"
        ? "El Paso / Juárez × Aviación Global"
        : "El Paso / Juárez × Global Aviation",

    // Language toggle
    langZh: "中文",
    langEn: "EN",
    langEs: "ES",

    // Filters
    searchPlaceholder:
      lang === "zh"
        ? "搜尋標題或摘要..."
        : lang === "es"
        ? "Buscar en títulos o resúmenes..."
        : "Search titles or summaries...",

    topicAll:
      lang === "zh" ? "全部" : lang === "es" ? "Todos" : "All Topics",
    topicBorder:
      lang === "zh"
        ? "邊境事務"
        : lang === "es"
        ? "Frontera"
        : "El Paso–Juárez",
    topicAviation:
      lang === "zh" ? "航空" : lang === "es" ? "Aviación" : "Aviation",

    time24h: lang === "zh" ? "24 小時" : lang === "es" ? "24 h" : "24 hours",
    time7d: lang === "zh" ? "7 天" : lang === "es" ? "7 d" : "7 days",
    timeAll: lang === "zh" ? "全部" : lang === "es" ? "Todo" : "All time",

    // Empty state
    emptyTitle:
      lang === "zh"
        ? "暫無新聞"
        : lang === "es"
        ? "Sin noticias aún"
        : "No news yet",
    emptyDescription:
      lang === "zh"
        ? "爬蟲每小時執行一次，請稍後再來查看。"
        : lang === "es"
        ? "El rastreador se ejecuta cada hora. Vuelve pronto."
        : "The crawler runs hourly. Check back soon.",

    // Error state
    errorTitle:
      lang === "zh"
        ? "載入失敗"
        : lang === "es"
        ? "Error al cargar"
        : "Failed to load",
    errorDescription:
      lang === "zh"
        ? "無法取得新聞，請重試。"
        : lang === "es"
        ? "No se pudieron cargar las noticias. Intente de nuevo."
        : "Unable to fetch news. Please try again.",
    retryButton:
      lang === "zh" ? "重試" : lang === "es" ? "Reintentar" : "Retry",

    // Card
    readMore:
      lang === "zh"
        ? "閱讀原文"
        : lang === "es"
        ? "Leer original"
        : "Read original",

    // Overlay — original-text section header
    originalLabel: lang === "zh" ? "原文" : "Original",

    // Refresh
    refreshing:
      lang === "zh" ? "重新整理中..." : lang === "es" ? "Actualizando..." : "Refreshing...",
    lastUpdated:
      lang === "zh"
        ? "最後更新："
        : lang === "es"
        ? "Actualizado:"
        : "Updated:",
    never:
      lang === "zh" ? "從未" : lang === "es" ? "nunca" : "never",
    refreshLabel:
      lang === "zh" ? "重新整理" : lang === "es" ? "Actualizar" : "Refresh",

    // Loading
    loading:
      lang === "zh" ? "載入中..." : lang === "es" ? "Cargando..." : "Loading...",

    // Cycling button labels (accessibility)
    languageLabel:
      lang === "zh" ? "語言" : lang === "es" ? "Idioma" : "Language",
    topicFilterLabel:
      lang === "zh" ? "主題" : lang === "es" ? "Tema" : "Topic",
    timeFilterLabel:
      lang === "zh" ? "時間" : lang === "es" ? "Tiempo" : "Time",
    tapToChange:
      lang === "zh" ? "輕觸切換" : lang === "es" ? "toque para cambiar" : "tap to change",

    // Fallback image (news item has no photo of its own)
    notNewsPhotoLabel:
      lang === "zh"
        ? "非新聞照片"
        : lang === "es"
        ? "No es foto de la noticia"
        : "Not a news photo",

    // -------- Flight tracker --------
    flightHubTitle:
      lang === "zh"
        ? "航班追蹤"
        : lang === "es"
        ? "Seguimiento de Vuelos"
        : "Flight Tracker",
    flightHubSubtitle:
      lang === "zh"
        ? "PMX 公司出差航班狀態"
        : lang === "es"
        ? "Estado de vuelos de viaje de empresa PMX"
        : "PMX company trip flight status",

    flightImportTitle:
      lang === "zh"
        ? "匯入航班清單"
        : lang === "es"
        ? "Importar lista de vuelos"
        : "Import flight list",
    flightImportHint:
      lang === "zh"
        ? "每行一筆：flight_date(YYYY-MM-DD),dep_airport,arr_airport,airline_code,flight_number[,scheduled_dep][,scheduled_arr]"
        : lang === "es"
        ? "Una línea por vuelo: flight_date(YYYY-MM-DD),dep_airport,arr_airport,airline_code,flight_number[,scheduled_dep][,scheduled_arr]"
        : "One flight per line: flight_date(YYYY-MM-DD),dep_airport,arr_airport,airline_code,flight_number[,scheduled_dep][,scheduled_arr]",
    flightImportButton:
      lang === "zh" ? "上傳" : lang === "es" ? "Subir" : "Upload",
    flightImportToggle:
      lang === "zh"
        ? "匯入航班清單"
        : lang === "es"
        ? "Importar lista"
        : "Import flight list",
    flightImportSuccess: (n: number) =>
      lang === "zh"
        ? `已匯入 ${n} 筆`
        : lang === "es"
        ? `Se importaron ${n} vuelos`
        : `Imported ${n} flights`,
    flightImportFailed:
      lang === "zh"
        ? "匯入失敗"
        : lang === "es"
        ? "Error al importar"
        : "Import failed",
    flightTemplateButton:
      lang === "zh"
        ? "下載 Excel 範本"
        : lang === "es"
        ? "Descargar plantilla Excel"
        : "Download Excel template",
    flightTemplateFilename: "flights_template.csv",
    flightUploadButton:
      lang === "zh"
        ? "上傳檔案"
        : lang === "es"
        ? "Subir archivo"
        : "Upload file",

    flightUpdateButton:
      lang === "zh" ? "更新" : lang === "es" ? "Actualizar" : "Update",
    flightSaveButton:
      lang === "zh" ? "儲存" : lang === "es" ? "Guardar" : "Save",
    flightCancelButton:
      lang === "zh" ? "取消" : lang === "es" ? "Cancelar" : "Cancel",
    flightCloseButton:
      lang === "zh" ? "關閉" : lang === "es" ? "Cerrar" : "Close",
    flightUpdateModalTitle: (flightRef: string) =>
      lang === "zh"
        ? `更新航班 — ${flightRef}`
        : lang === "es"
        ? `Actualizar vuelo — ${flightRef}`
        : `Update flight — ${flightRef}`,

    flightStatusScheduled:
      lang === "zh" ? "已排定" : lang === "es" ? "Programado" : "Scheduled",
    flightStatusDeparted:
      lang === "zh" ? "已出發" : lang === "es" ? "Salió" : "Departed",
    flightStatusArrived:
      lang === "zh" ? "已抵達" : lang === "es" ? "Llegó" : "Arrived",
    flightStatusCancelled:
      lang === "zh" ? "已取消" : lang === "es" ? "Cancelado" : "Cancelled",
    flightStatusLabel:
      lang === "zh" ? "狀態" : lang === "es" ? "Estado" : "Status",
    flightUpdatedByLabel:
      lang === "zh" ? "更新者" : lang === "es" ? "Actualizado por" : "Updated by",
    flightNotesLabel:
      lang === "zh" ? "備註" : lang === "es" ? "Notas" : "Notes",
    flightUpdatedByHuman: lang === "zh" ? "人工" : lang === "es" ? "Humano" : "Human",
    flightUpdatedByAi: lang === "zh" ? "AI" : lang === "es" ? "IA" : "AI",
    flightUpdatedByImport:
      lang === "zh" ? "匯入" : lang === "es" ? "Importar" : "Import",

    flightEmptyTitle:
      lang === "zh"
        ? "目前沒有追蹤的航班"
        : lang === "es"
        ? "Sin vuelos rastreados"
        : "No tracked flights",
    flightEmptyHint:
      lang === "zh"
        ? "請使用「匯入航班清單」加入行程。"
        : lang === "es"
        ? "Usa «Importar lista» para añadir vuelos."
        : "Use \"Import flight list\" to add flights.",

    flightFilterToday:
      lang === "zh" ? "今日" : lang === "es" ? "Hoy" : "Today",
    flightFilter7d:
      lang === "zh"
        ? "未來 7 日"
        : lang === "es"
        ? "Próximos 7 días"
        : "Next 7 days",
    flightFilterAll:
      lang === "zh" ? "全部" : lang === "es" ? "Todos" : "All",

    flightTimeScheduled:
      lang === "zh" ? "預定" : lang === "es" ? "Programado" : "Scheduled",
    flightTimeActual:
      lang === "zh" ? "實際" : lang === "es" ? "Real" : "Actual",

    flightLabelDeparture:
      lang === "zh" ? "出發" : lang === "es" ? "Salida" : "Departure",
    flightLabelArrival:
      lang === "zh" ? "抵達" : lang === "es" ? "Llegada" : "Arrival",

    flightRefresh:
      lang === "zh" ? "重新整理" : lang === "es" ? "Actualizar" : "Refresh",

    flightDelayOnTime:
      lang === "zh" ? "已準時" : lang === "es" ? "A tiempo" : "On time",
    flightDelayEarly: (n: number) =>
      lang === "zh"
        ? `提早 ${n} 分鐘`
        : lang === "es"
        ? `Adelantado ${n} min`
        : `${n} min early`,
    flightDelayLate: (n: number) =>
      lang === "zh"
        ? `延誤 ${n} 分鐘`
        : lang === "es"
        ? `Retrasado ${n} min`
        : `${n} min late`,
    flightDelayMinutes: (n: number) =>
      lang === "zh"
        ? `${n} 分鐘`
        : lang === "es"
        ? `${n} min`
        : `${n} min`,

    flightPresetOnTime:
      lang === "zh"
        ? "已準時 (+0)"
        : lang === "es"
        ? "A tiempo (+0)"
        : "On time (+0)",
    flightPresetDelay20:
      lang === "zh"
        ? "延誤 20 分鐘"
        : lang === "es"
        ? "Retraso 20 min"
        : "Delay 20 min",
    flightPresetDelay60:
      lang === "zh"
        ? "延誤 60 分鐘"
        : lang === "es"
        ? "Retraso 60 min"
        : "Delay 60 min",
    flightPresetCancelled:
      lang === "zh" ? "已取消" : lang === "es" ? "Cancelado" : "Cancelled",

    flightSavingLabel:
      lang === "zh" ? "儲存中…" : lang === "es" ? "Guardando…" : "Saving…",
    flightUpdatedToast:
      lang === "zh"
        ? "已更新"
        : lang === "es"
        ? "Actualizado"
        : "Updated",
    flightLoadError:
      lang === "zh"
        ? "無法載入航班"
        : lang === "es"
        ? "No se pudieron cargar los vuelos"
        : "Unable to load flights",
    flightFlight: (ref: string) =>
      lang === "zh" ? `航班 ${ref}` : lang === "es" ? `Vuelo ${ref}` : `Flight ${ref}`,

    // -------- Tab switcher --------
    tabNews:
      lang === "zh" ? "新聞" : lang === "es" ? "Noticias" : "News",
    tabFlights:
      lang === "zh" ? "航班追蹤" : lang === "es" ? "Vuelos" : "Flights",

    // -------- Flight columns / archive (added 2026-11) --------
    flightPendingDeparture:
      lang === "zh" ? "待出發" : lang === "es" ? "Pendientes" : "Pending",
    flightInTransit:
      lang === "zh" ? "已出發" : lang === "es" ? "En tránsito" : "In transit",
    flightArchiveToggle:
      lang === "zh"
        ? "標記為已備份"
        : lang === "es"
        ? "Marcar como archivado"
        : "Mark as archived",
    flightEmptyDepartures:
      lang === "zh"
        ? "目前沒有待出發的航班"
        : lang === "es"
        ? "No hay salidas pendientes"
        : "No pending departures",
    flightEmptyArrivals:
      lang === "zh"
        ? "目前沒有已出發的航班"
        : lang === "es"
        ? "No hay vuelos en tránsito"
        : "No in-transit flights",
  };
}

/**
 * Detect initial language from navigator
 */
export function detectInitialLanguage(): Language {
  if (typeof window === "undefined") return "en";

  const navLang = navigator.language.toLowerCase();
  if (navLang.startsWith("zh")) return "zh";
  if (navLang.startsWith("es")) return "es";
  return "en";
}

/**
 * Filter news items based on search query, topic, and time
 */
export function filterNewsItems(
  items: NewsItem[],
  searchQuery: string,
  topicFilter: "all" | "border" | "aviation",
  timeFilter: "24h" | "7d" | "all"
): NewsItem[] {
  let filtered = items;

  // Topic filter
  if (topicFilter !== "all") {
    filtered = filtered.filter((item) => item.topic === topicFilter);
  }

  // Time filter
  if (timeFilter !== "all") {
    const now = Date.now();
    const cutoff =
      timeFilter === "24h" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    filtered = filtered.filter((item) => {
      if (!item.published_at) return false;
      const pubTime = new Date(item.published_at).getTime();
      return now - pubTime <= cutoff;
    });
  }

  // Search filter (case-insensitive across all languages)
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter((item) => {
      const searchableText = [
        item.title_en,
        item.title_zh || "",
        item.title_es || "",
        item.summary_en || "",
        item.summary_zh || "",
        item.summary_es || "",
      ]
        .join(" ")
        .toLowerCase();
      return searchableText.includes(query);
    });
  }

  return filtered;
}

/** Traffic-light colour for a flight row (incl. "hollow" for "not yet departed"). */
export type FlightTrafficLight =
  | "hollow"
  | "green"
  | "blue"
  | "yellow"
  | "red"
  | "black";

/**
 * Left-side light = departure status.
 * Rules (first match wins):
 *   - black  : status === "cancelled"
 *   - hollow : not yet departed (status scheduled + no actual_dep)
 *   - blue   : departure_delay_minutes <= -15 (early by ≥15 min)
 *   - red    : departure_delay_minutes >  30  (late ≥30 min)
 *   - yellow : departure_delay_minutes >=  15  (late 15..30 min)
 *   - green  : otherwise (on-time ±15 min, or no departure delay data yet)
 */
export function flightDepLight(flight: Flight): FlightTrafficLight {
  if (flight.status === "cancelled") return "black";
  if (!flight.actual_dep && (flight.status === "scheduled" || flight.status === "cancelled")) {
    if (flight.status === "scheduled") return "hollow";
  }
  const d = flight.departure_delay_minutes;
  if (d === null || d === undefined || Number.isNaN(d)) return "green";
  if (d <= -15) return "blue";
  if (d > 30) return "red";
  if (d >= 15) return "yellow";
  return "green";
}

/**
 * Right-side light = arrival status.
 * Rules (first match wins):
 *   - black  : cancelled and never going to arrive (no actual_arr) → 轉降/取消
 *   - blue   : delay_minutes <= -15 (arrived early by ≥15 min)
 *   - red    : delay_minutes >  30  (arrived late ≥30 min)
 *   - yellow : delay_minutes >=  15  (arrived late 15..30 min)
 *   - green  : otherwise (on-time ±15 min, or no arrival data yet)
 */
export function flightArrLight(flight: Flight): FlightTrafficLight {
  if (flight.status === "cancelled" && !flight.actual_arr) return "black";
  const d = flight.delay_minutes;
  if (d === null || d === undefined || Number.isNaN(d)) return "green";
  if (d <= -15) return "blue";
  if (d > 30) return "red";
  if (d >= 15) return "yellow";
  return "green";
}

/** @deprecated kept for back-compat; callers should use flightArrLight() or flightDepLight(). */
export function flightTrafficLight(flight: Flight): FlightTrafficLight {
  return flightArrLight(flight);
}

/** Map a traffic-light value to the Tailwind background class.
 *  Hollow = empty ring (透明填充); black = 閃爍（animate-pulse）。
 */
export function flightTrafficLightClass(light: FlightTrafficLight): string {
  switch (light) {
    case "hollow":
      return "border-2 border-zinc-400 bg-transparent dark:border-zinc-500";
    case "green":
      return "bg-emerald-500";
    case "blue":
      return "bg-sky-500";
    case "yellow":
      return "bg-amber-500";
    case "red":
      return "bg-rose-500";
    case "black":
      return "bg-zinc-900 animate-pulse";
  }
}
