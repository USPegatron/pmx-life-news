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

/** IATA airline code -> full airline name. Used as fallback when DB airline_name is null. */
export const AIRLINE_NAMES: Record<string, string> = {
  AA: "American Airlines", AC: "Air Canada", AF: "Air France", AM: "Aeromexico",
  AR: "Aerolineas Argentinas", AS: "Alaska Airlines", AY: "Finnair",
  BA: "British Airways", BR: "EVA Air", CA: "Air China",
  CI: "China Airlines", CM: "Copa Airlines", CX: "Cathay Pacific",
  DL: "Delta Air Lines", EI: "Aer Lingus", EK: "Emirates",
  ET: "Ethiopian Airlines", F9: "Frontier Airlines", FI: "Icelandair",
  GA: "Garuda Indonesia", HA: "Hawaiian Airlines", IB: "Iberia",
  JL: "Japan Airlines", KLM: "KLM", KE: "Korean Air",
  LA: "LATAM Airlines", LH: "Lufthansa", LO: "LOT Polish Airlines",
  MU: "China Eastern", NH: "All Nippon Airways", NK: "Spirit Airlines",
  NZ: "Air New Zealand", OA: "Olympic Air", OS: "Austrian Airlines",
  OZ: "Asiana Airlines", PR: "Philippine Airlines", QF: "Qantas",
  QR: "Qatar Airways", SA: "South African Airways", SK: "SAS",
  SN: "Brussels Airlines", SQ: "Singapore Airlines", SU: "Aeroflot",
  SV: "Saudia", SW: "SkyWest", TG: "Thai Airways",
  TK: "Turkish Airlines", UA: "United Airlines", UL: "SriLankan Airlines",
  US: "US Airways", VA: "Virgin Australia", VS: "Virgin Atlantic",
  VN: "Vietnam Airlines", WN: "Southwest Airlines", XE: "JSX",
  Y4: "Volaris", YW: "Air Creebec", ZI: "Aigle Azur",
  // Add more as needed; ~80 common airlines is enough for a prototype.
};

/** Return the full airline name for an IATA code; falls back to the code itself if unknown. */
export function getAirlineName(code: string | null | undefined): string {
  if (!code) return "";
  return AIRLINE_NAMES[code.trim().toUpperCase()] || code.trim().toUpperCase();
}

/** ICAO aircraft typecode -> full aircraft model. Source: wikipedia + OpenSky docs. */
export const AIRCRAFT_NAMES: Record<string, string> = {
  // Airbus narrow-body
  A318: "Airbus A318", A319: "Airbus A319", A320: "Airbus A320",
  A20N: "Airbus A320neo", A321: "Airbus A321", A21N: "Airbus A321neo",
  // Airbus wide-body
  A330: "Airbus A330-300", A332: "Airbus A330-200", A333: "Airbus A330-300",
  A337: "Airbus A330-700L", A339: "Airbus A330-900neo",
  A340: "Airbus A340", A342: "Airbus A340-200", A343: "Airbus A340-300", A345: "Airbus A340-500", A346: "Airbus A340-600",
  A350: "Airbus A350", A358: "Airbus A350-1000", A359: "Airbus A350-900",
  A380: "Airbus A380", A388: "Airbus A380-800",
  // Boeing narrow-body
  B701: "Boeing 707-120", B703: "Boeing 707-300", B712: "Boeing 717-200",
  B721: "Boeing 727-100", B722: "Boeing 727-200", B732: "Boeing 737-200",
  B733: "Boeing 737-300", B734: "Boeing 737-400", B735: "Boeing 737-500",
  B736: "Boeing 737-600", B737: "Boeing 737-700", B738: "Boeing 737-800",
  B739: "Boeing 737-900", B38M: "Boeing 737 MAX 8", B39M: "Boeing 737 MAX 9",
  B752: "Boeing 757-200", B753: "Boeing 757-300",
  // Boeing wide-body
  B762: "Boeing 767-200", B763: "Boeing 767-300", B764: "Boeing 767-400ER",
  B772: "Boeing 777-200", B773: "Boeing 777-300", B77L: "Boeing 777-200LR",
  B77W: "Boeing 777-300ER", B778: "Boeing 777-8", B779: "Boeing 777-9",
  B788: "Boeing 787-8", B789: "Boeing 787-9", B78X: "Boeing 787-10",
  B744: "Boeing 747-400", B748: "Boeing 747-8",
  // Boeing narrow + special
  // Embraer
  E170: "Embraer E170", E175: "Embraer E175", E190: "Embraer E190", E195: "Embraer E195",
  // Bombardier regional jets
  CRJ1: "Bombardier CRJ-100", CRJ2: "Bombardier CRJ-200",
  CRJ7: "Bombardier CRJ-700", CRJ9: "Bombardier CRJ-900",
  // ATR turboprops
  AT45: "ATR 42-500", AT46: "ATR 42-600", AT72: "ATR 72-200", AT75: "ATR 72-500", AT76: "ATR 72-600",
  // Misc
  DH8D: "De Havilland Dash 8 Q400",
};

/** Return the full aircraft model name for an ICAO typecode; falls back to the typecode if unknown. */
export function getAircraftName(typecode: string | null | undefined): string {
  if (!typecode) return "";
  const k = typecode.trim().toUpperCase();
  return AIRCRAFT_NAMES[k] || k;
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

    flightDateLabel: (dateStr: string) => {
      // Expecting "YYYY-MM-DD"; fall back gracefully if shape is off.
      if (!dateStr) return "";
      const parts = dateStr.split("-");
      if (parts.length !== 3) return dateStr;
      const [y, m, d] = parts;
      if (lang === "zh") return `${y}-${m}-${d}`; // 2026-11-16
      if (lang === "es") return `${d}/${m}/${y}`; // 16/11/2026
      return `${Number(m)}/${Number(d)}`; // 11/16 (M/D)
    },
    flightRefreshAll:
      lang === "zh" ? "更新全部" : lang === "es" ? "Actualizar todo" : "Refresh all",

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
  | "yellow"
  | "red"
  | "black";

/**
 * Shared delay → light logic (identical for departure and arrival):
 *   - delay ≤ 15 min (including early/negative) → green
 *   - 15 < delay ≤ 30 min late → yellow
 *   - delay > 30 min late → red (flashing)
 */
function delayToLight(delayMinutes: number): FlightTrafficLight {
  if (delayMinutes <= 15) return "green"; // on-time or early
  if (delayMinutes <= 30) return "yellow";
  return "red";
}

/**
 * Departure light (left column — before takeoff):
 *   - hollow : not yet departed
 *   - green/yellow/red : scheduled vs actual/expected departure delay
 *   - black  : cancelled
 */
export function flightDepLight(flight: Flight): FlightTrafficLight {
  if (flight.status === "cancelled") return "black";
  // Not yet departed (no actual_dep confirmed) → hollow
  if (!flight.actual_dep) return "hollow";
  // Departed: compute delay vs scheduled
  if (flight.actual_dep && flight.scheduled_dep) {
    const d = (new Date(flight.actual_dep).getTime() - new Date(flight.scheduled_dep).getTime()) / 60_000;
    return delayToLight(d);
  }
  return "green"; // departed but no scheduled to compare
}

/**
 * Arrival light (right column — after takeoff):
 *   - green/yellow/red : scheduled vs actual/expected arrival delay
 *   - black  : cancelled and won't arrive (diverted/转降)
 */
export function flightArrLight(flight: Flight): FlightTrafficLight {
  if (flight.status === "cancelled" && !flight.actual_arr) return "black";
  // Compute arrival delay (actual vs scheduled; 0 if no actual yet)
  if (flight.actual_arr && flight.scheduled_arr) {
    const d = (new Date(flight.actual_arr).getTime() - new Date(flight.scheduled_arr).getTime()) / 60_000;
    return delayToLight(d);
  }
  return "green"; // no actual yet → assume on-time
}

/** @deprecated kept for back-compat; callers should use flightArrLight() or flightDepLight(). */
export function flightTrafficLight(flight: Flight): FlightTrafficLight {
  return flightArrLight(flight);
}

/** Map a traffic-light value to the Tailwind background class.
 *  Hollow = empty ring; red & black = 閃爍 (animate-pulse).
 */
export function flightTrafficLightClass(light: FlightTrafficLight): string {
  switch (light) {
    case "hollow":
      return "border-2 border-zinc-400 bg-transparent dark:border-zinc-500";
    case "green":
      return "bg-emerald-500";
    case "yellow":
      return "bg-amber-500";
    case "red":
      return "bg-rose-500 animate-pulse";
    case "black":
      return "bg-zinc-900 animate-pulse";
  }
}
