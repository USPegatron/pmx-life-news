import type { NewsItem, Language, TranslatedContent } from "./types";

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
