"use client";

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { supabase } from "@/lib/supabase";
import type { NewsItem, Language, TopicFilter, TimeFilter } from "@/lib/types";
import {
  getTranslatedContent,
  formatRelativeTime,
  formatFullDate,
  getUIStrings,
  detectInitialLanguage,
  filterNewsItems,
  getFallbackLandscape,
} from "@/lib/utils";

const REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes
const FETCH_LIMIT = 300;

// Columns for the list (content_* fetched lazily on demand via the API).
const LIST_COLUMNS =
  "id,url_hash,url,topic,source,language_original,title_en,title_zh,title_es,summary_en,summary_zh,summary_es,image_url,image_urls,published_at,fetched_at,created_at";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const SCALE_STEP = 0.2;
const PAN_FACTOR = 0.6; // fraction of (scale-1)*viewport that the image can travel

export default function Home() {
  // State
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [selected, setSelected] = useState<NewsItem | null>(null);

  // Filters
  const [language, setLanguage] = useState<Language>("en");
  const [searchQuery, setSearchQuery] = useState("");
  const [topicFilter, setTopicFilter] = useState<TopicFilter>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");

  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const ui = getUIStrings(language);

  // Fetch news from Supabase
  const fetchNews = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from("news_items")
        .select(LIST_COLUMNS)
        .order("published_at", { ascending: false })
        .limit(FETCH_LIMIT);

      if (fetchError) throw fetchError;

      setNewsItems((data as NewsItem[]) || []);
      setLastFetched(new Date());
    } catch (err) {
      console.error("Failed to fetch news:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  // Auto-refresh every 10 minutes
  useEffect(() => {
    refreshTimeoutRef.current = setTimeout(() => {
      fetchNews(true);
    }, REFRESH_INTERVAL);

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [fetchNews]);

  // Load language preference from localStorage
  useEffect(() => {
    const savedLang = localStorage.getItem("border-flight-lang") as Language | null;
    if (savedLang && ["zh", "en", "es"].includes(savedLang)) {
      setLanguage(savedLang);
    } else {
      setLanguage(detectInitialLanguage());
    }
  }, []);

  // Save language preference
  useEffect(() => {
    localStorage.setItem("border-flight-lang", language);
  }, [language]);

  // Filter news items
  const filteredItems = filterNewsItems(
    newsItems,
    searchQuery,
    topicFilter,
    timeFilter
  );

  // Manual refresh handler
  const handleRefresh = () => {
    fetchNews(true);
  };

  // Cycling handlers for merged toggle buttons
  const cycleLanguage = () => {
    const order: Language[] = ["zh", "en", "es"];
    const idx = order.indexOf(language);
    setLanguage(order[(idx + 1) % order.length]);
  };

  const cycleTopic = () => {
    const order: TopicFilter[] = ["all", "border", "aviation"];
    const idx = order.indexOf(topicFilter);
    setTopicFilter(order[(idx + 1) % order.length]);
  };

  const cycleTime = () => {
    const order: TimeFilter[] = ["24h", "7d", "all"];
    const idx = order.indexOf(timeFilter);
    setTimeFilter(order[(idx + 1) % order.length]);
  };

  // Get current label for each cycling button
  const getCurrentLanguageLabel = () => {
    if (language === "zh") return ui.langZh;
    if (language === "es") return ui.langEs;
    return ui.langEn;
  };

  const getCurrentTopicLabel = () => {
    if (topicFilter === "all") return ui.topicAll;
    if (topicFilter === "border") return ui.topicBorder;
    return ui.topicAviation;
  };

  const getCurrentTimeLabel = () => {
    if (timeFilter === "24h") return ui.time24h;
    if (timeFilter === "7d") return ui.time7d;
    return ui.timeAll;
  };

  return (
    <main className="min-h-screen">
      {/* Sticky Control Bar - Fixed at top, exactly 2 rows on mobile */}
      <header className="sticky top-0 z-50 bg-paper/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          {/* Row 1: Cycling controls + Refresh (mobile: 4 compact buttons side-by-side) */}
          <div className="flex items-center gap-2">
            {/* Language cycling button */}
            <button
              onClick={cycleLanguage}
              className="flex-1 sm:flex-none sm:min-w-[96px] flex flex-col items-center justify-center gap-1 px-2 py-2 text-xs sm:text-sm font-medium
                bg-white border border-border rounded-lg text-ink
                hover:border-accent/50 hover:text-accent
                transition-all duration-200 touch-target"
              aria-label={`${ui.languageLabel}: ${getCurrentLanguageLabel()} — ${ui.tapToChange}`}
            >
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.6 9h16.8M3.6 15h16.8" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3c2.5 2.4 4 5.7 4 9s-1.5 6.6-4 9c-2.5-2.4-4-5.7-4-9s1.5-6.6 4-9z" />
              </svg>
              <span>{getCurrentLanguageLabel()}</span>
            </button>

            {/* Topic cycling button */}
            <button
              onClick={cycleTopic}
              className="flex-1 sm:flex-none sm:min-w-[96px] flex flex-col items-center justify-center gap-1 px-2 py-2 text-xs sm:text-sm font-medium
                bg-white border border-border rounded-lg text-ink
                hover:border-accent/50 hover:text-accent
                transition-all duration-200 touch-target"
              aria-label={`${ui.topicFilterLabel}: ${getCurrentTopicLabel()} — ${ui.tapToChange}`}
            >
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.83z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01" />
              </svg>
              <span>{getCurrentTopicLabel()}</span>
            </button>

            {/* Time cycling button */}
            <button
              onClick={cycleTime}
              className="flex-1 sm:flex-none sm:min-w-[96px] flex flex-col items-center justify-center gap-1 px-2 py-2 text-xs sm:text-sm font-medium
                bg-white border border-border rounded-lg text-ink
                hover:border-accent/50 hover:text-accent
                transition-all duration-200 touch-target"
              aria-label={`${ui.timeFilterLabel}: ${getCurrentTimeLabel()} — ${ui.tapToChange}`}
            >
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{getCurrentTimeLabel()}</span>
            </button>

            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex-shrink-0 inline-flex items-center justify-center px-3 py-2.5 text-sm font-medium
                bg-white border border-border rounded-lg
                text-ink-light hover:text-accent hover:border-accent/50
                transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
                touch-target no-print"
              aria-label={`${ui.refreshLabel}${lastFetched && !isRefreshing ? ` (${formatRelativeTime(lastFetched.toISOString(), language)})` : ""}`}
            >
              <svg
                className={`w-4 h-4 ${isRefreshing ? "spin" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
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

          {/* Row 2: Full-width search input */}
          <div className="mt-2 w-full no-print">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-light"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={ui.searchPlaceholder}
                className="w-full pl-10 pr-4 py-2.5 text-sm bg-white border border-border rounded-lg
                  text-ink placeholder-ink-light
                  focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent
                  transition-all duration-200"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Hub Title Bar (scrolls away) */}
      <div className="bg-paper border-b border-border no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl sm:text-3xl font-display font-semibold text-ink tracking-tight">
            {ui.hubName}
          </h1>
          <p className="text-sm text-ink-light mt-0.5 font-body">
            {ui.hubSubtitle}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Loading state — row-shaped skeletons */}
        {isLoading && (
          <div className="flex flex-col gap-4">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="flex w-full bg-white rounded-xl border border-border overflow-hidden shadow-card"
              >
                <div className="w-24 sm:w-60 shrink-0 aspect-[16/10] skeleton" />
                <div className="flex-1 p-4 sm:p-5 space-y-3 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-20 skeleton rounded" />
                    <div className="h-3 w-3 skeleton rounded-full" />
                    <div className="h-3 w-16 skeleton rounded" />
                  </div>
                  <div className="h-5 w-3/4 skeleton rounded" />
                  <div className="h-4 w-full skeleton rounded" />
                  <div className="h-4 w-1/2 skeleton rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error state */}
        {!isLoading && error && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <svg
                className="w-8 h-8 text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-display font-semibold text-ink mb-2">
              {ui.errorTitle}
            </h2>
            <p className="text-ink-light mb-6 max-w-md">{ui.errorDescription}</p>
            <button
              onClick={handleRefresh}
              className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg
                transition-colors duration-200 shadow-sm hover:shadow"
            >
              {ui.retryButton}
            </button>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && filteredItems.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-ink/5 flex items-center justify-center mb-4">
              <svg
                className="w-8 h-8 text-ink-light"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-9-3h10"
                />
              </svg>
            </div>
            <h2 className="text-xl font-display font-semibold text-ink mb-2">
              {ui.emptyTitle}
            </h2>
            <p className="text-ink-light max-w-md">{ui.emptyDescription}</p>
          </div>
        )}

        {/* News list — single column, one news per row */}
        {!isLoading && !error && filteredItems.length > 0 && (
          <div className="flex flex-col gap-4">
            {filteredItems.map((item, index) => (
              <NewsRow
                key={item.id}
                item={item}
                language={language}
                delay={index < 6 ? (index + 1) : 0}
                onOpen={() => setSelected(item)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-border mt-12 no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-sm text-ink-light">
            {ui.hubName} — {ui.hubSubtitle}
          </p>
        </div>
      </footer>

      {/* Reading overlay */}
      {selected && (
        <ArticleOverlay
          item={selected}
          language={language}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
}

// ---------- News Row (single column, horizontal flex) ----------
function NewsRow({
  item,
  language,
  delay = 0,
  onOpen,
}: {
  item: NewsItem;
  language: Language;
  delay?: number;
  onOpen: () => void;
}) {
  const content = getTranslatedContent(item, language);
  const ui = getUIStrings(language);
  const relativeTime = formatRelativeTime(item.published_at, language);
  const fullDate = formatFullDate(item.published_at, language);
  const isBorder = item.topic === "border";

  const [imageError, setImageError] = useState(false);

  // Thumbnail source: prefer item.image_url; when the item has neither
  // image_url nor image_urls, show a local El Paso / Juárez landscape so the
  // row still has a picture (labeled "not a news photo" via the badge below).
  const hasOwnImageUrl = !!item.image_url;
  const hasImageUrls = (item.image_urls?.length ?? 0) > 0;
  const showFallback = !hasOwnImageUrl && !hasImageUrls;
  const thumbnailSrc = hasOwnImageUrl
    ? item.image_url
    : showFallback
    ? getFallbackLandscape(item.id)
    : null;

  const animationClass = delay > 0 ? `fade-in fade-in-delay-${Math.min(delay, 6)}` : "";

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={content.title}
      className={`
        group flex w-full text-left bg-white rounded-xl border border-border overflow-hidden
        shadow-card hover:shadow-card-hover hover:border-accent/40
        focus:outline-none focus:ring-2 focus:ring-accent/30
        transition-all duration-300 cursor-pointer
        ${animationClass}
      `}
    >
      {/* Thumbnail (left) */}
      <div className="w-24 sm:w-60 shrink-0 relative aspect-[16/10] bg-ink/5">
        {thumbnailSrc && !imageError ? (
          <img
            src={thumbnailSrc}
            alt=""
            loading="lazy"
            onError={() => setImageError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div
            className={`w-full h-full flex items-center justify-center ${
              isBorder ? "gradient-placeholder-border" : "gradient-placeholder-aviation"
            }`}
          >
            <svg
              className="w-8 h-8 sm:w-12 sm:h-12 text-white/60"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {isBorder ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M3 12h18M3 6h18M3 18h18"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                />
              )}
            </svg>
          </div>
        )}

        {/* "Not a news photo" badge — only when showing a fallback landscape */}
        {showFallback && !imageError && (
          <span className="absolute top-2 right-2 sm:top-3 sm:right-3 px-2 py-0.5 text-[10px] sm:text-xs font-medium rounded bg-black/60 text-white pointer-events-none">
            {ui.notNewsPhotoLabel}
          </span>
        )}

        {/* Topic badge */}
        <div className="absolute top-2 left-2 sm:top-3 sm:left-3">
          <span
            className={`
              px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs font-semibold rounded-full uppercase tracking-wider
              ${isBorder
                ? "bg-border-topic/90 text-white"
                : "bg-aviation-topic/90 text-white"
              }
              backdrop-blur-sm
            `}
          >
            {isBorder ? "Border" : "Aviation"}
          </span>
        </div>
      </div>

      {/* Content (right) */}
      <div className="flex-1 min-w-0 p-3 sm:p-5 flex flex-col justify-center">
        {/* Source + time */}
        <div className="flex items-center gap-2 mb-1.5 sm:mb-2 text-xs">
          {item.source && (
            <span className="font-medium text-ink-light uppercase tracking-wide truncate">
              {item.source}
            </span>
          )}
          {relativeTime && (
            <>
              <span className="w-1 h-1 rounded-full bg-border shrink-0" />
              <time
                dateTime={item.published_at || undefined}
                className="text-ink-light shrink-0"
                title={fullDate}
              >
                {relativeTime}
              </time>
            </>
          )}
        </div>

        {/* Title (translated) — wraps freely, no line-clamp */}
        <h2 className="text-base sm:text-xl font-display font-semibold text-ink leading-snug mb-1.5 sm:mb-2 group-hover:text-accent transition-colors duration-200">
          {content.title}
        </h2>

        {/* Summary — line-clamp-2 */}
        {content.summary && (
          <p className="hidden sm:block text-sm text-ink-light leading-relaxed line-clamp-2 mb-2">
            {content.summary}
          </p>
        )}

        {/* Open original link */}
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs sm:text-sm font-medium text-accent hover:text-accent-hover transition-colors duration-200 w-fit"
        >
          <span>{ui.readMore}</span>
          <span aria-hidden="true">→</span>
        </a>
      </div>
    </div>
  );
}

// ---------- Overlay data + article overlay ----------
type OverlayData = {
  content?: string;
  original?: string;
  translated?: boolean;
  cached?: boolean;
  note?: string;
};

// Full-article reading overlay with on-demand translation, image carousel, lightbox.
function ArticleOverlay({
  item,
  language,
  onClose,
}: {
  item: NewsItem;
  language: Language;
  onClose: () => void;
}) {
  const content = getTranslatedContent(item, language);
  const ui = getUIStrings(language);
  const [data, setData] = useState<OverlayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Localized labels for the overlay
  const labels =
    language === "zh"
      ? { loading: "翻譯中…", failed: "翻譯失敗", link: "開啟原文連結", zoomIn: "放大", zoomOut: "縮小", reset: "重置", close: "關閉", viewImage: "檢視圖片" }
      : language === "es"
      ? { loading: "Traduciendo…", failed: "Error de traducción", link: "Abrir original", zoomIn: "Acercar", zoomOut: "Alejar", reset: "Restablecer", close: "Cerrar", viewImage: "Ver imagen" }
      : { loading: "Translating…", failed: "Translation failed", link: "Open original", zoomIn: "Zoom in", zoomOut: "Zoom out", reset: "Reset", close: "Close", viewImage: "View image" };

  // Resolve image list: prefer the full list; fall back to single image_url;
  // if neither exists, show a local El Paso / Juárez landscape so the carousel
  // still has something to display — labeled "not a news photo" via the badge.
  const realImageList: string[] = (() => {
    if (Array.isArray(item.image_urls) && item.image_urls.length > 0) {
      return item.image_urls;
    }
    if (item.image_url) return [item.image_url];
    return [];
  })();
  const isFallbackImage = realImageList.length === 0;
  const imageList: string[] = isFallbackImage
    ? [getFallbackLandscape(item.id)]
    : realImageList;

  const isBorder = item.topic === "border";

  // Fetch full-text translation for the current language
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setData(null);

    fetch(`/api/translate?id=${encodeURIComponent(item.id)}&lang=${language}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (!cancelled) setData(j);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item.id, language]);

  // Close on Escape — lightbox first, then overlay
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (lightboxSrc) {
          setLightboxSrc(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, lightboxSrc]);

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const translatedText = data?.content ?? "";
  const originalText = item.content_original ?? "";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={content.title}
    >
      {/* Full-screen sheet on mobile, centered dialog on desktop (~80% screen) */}
      <div
        className="relative bg-paper w-screen sm:w-[80vw] max-w-full sm:max-w-3xl sm:rounded-2xl sm:shadow-xl sm:my-8 min-h-[100dvh] sm:min-h-0 sm:max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header bar */}
        <div className="sticky top-0 z-10 bg-paper/95 backdrop-blur border-b border-border sm:rounded-t-2xl px-4 sm:px-6 py-4 flex-shrink-0">
          <div className="flex items-start gap-3 sm:gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                {item.source && (
                  <span className="text-xs font-medium text-ink-light uppercase tracking-wide truncate">
                    {item.source}
                  </span>
                )}
                {formatRelativeTime(item.published_at, language) && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-border shrink-0" />
                    <span className="text-xs text-ink-light shrink-0">
                      {formatRelativeTime(item.published_at, language)}
                    </span>
                  </>
                )}
                <span
                  className={`ml-1 px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase tracking-wider text-white shrink-0 ${
                    isBorder ? "bg-border-topic/90" : "bg-aviation-topic/90"
                  }`}
                >
                  {isBorder ? "Border" : "Aviation"}
                </span>
              </div>
              <h2 className="text-lg sm:text-xl font-display font-semibold text-ink leading-snug">
                {content.title}
              </h2>
            </div>
            {/* Open original (external) — sticky header */}
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:inline-flex flex-shrink-0 items-center gap-1 px-3 py-2 text-xs font-medium text-accent hover:text-accent-hover border border-accent/30 hover:border-accent/60 rounded-lg transition-colors"
                aria-label={labels.link}
              >
                {labels.link}
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
            <button
              onClick={onClose}
              aria-label={labels.close}
              className="flex-shrink-0 p-2 -m-2 rounded-lg text-ink-light hover:text-ink hover:bg-ink/5 transition-colors touch-target"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Image carousel (~35vh desktop / ~30vh mobile). Always rendered —
            when the item has no real images, the carousel uses a local El Paso
            / Juárez landscape and surfaces the "not a news photo" badge. */}
        <ImageCarousel
          images={imageList}
          altFallback={content.title}
          viewImageLabel={labels.viewImage}
          notNewsPhotoLabel={isFallbackImage ? ui.notNewsPhotoLabel : undefined}
          onImageTap={(src) => setLightboxSrc(src)}
        />

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
          {/* Title (translated, large) */}
          <h1 className="text-xl sm:text-2xl font-display font-semibold text-ink leading-tight mb-3">
            {content.title}
          </h1>

          {/* Source + relative time */}
          <div className="flex items-center gap-2 mb-5 text-sm">
            {item.source && (
              <span className="font-medium text-ink-light uppercase tracking-wide">
                {item.source}
              </span>
            )}
            {formatRelativeTime(item.published_at, language) && (
              <>
                <span className="w-1 h-1 rounded-full bg-border" />
                <time
                  dateTime={item.published_at || undefined}
                  className="text-ink-light"
                >
                  {formatRelativeTime(item.published_at, language)}
                </time>
              </>
            )}
          </div>

          {/* Translated full text */}
          {err ? (
            <p className="text-sm text-red-500 mb-6">
              {labels.failed}：{err}
            </p>
          ) : loading ? (
            <div className="space-y-3 mb-6">
              <div className="flex items-center gap-2 text-sm text-ink-light mb-1">
                <svg className="w-4 h-4 spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                {labels.loading}
              </div>
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-4 skeleton rounded" style={{ width: `${100 - (i % 3) * 12}%` }} />
              ))}
            </div>
          ) : translatedText ? (
            <div className="whitespace-pre-line text-[15px] sm:text-base leading-relaxed text-ink mb-6">
              {translatedText}
            </div>
          ) : (
            <p className="text-sm text-ink-light mb-6">{content.summary || "—"}</p>
          )}

          {/* 原文 section header */}
          <div className="flex items-center gap-3 mt-8 mb-3">
            <h3 className="text-xs sm:text-sm font-semibold tracking-wider uppercase text-ink-light">
              {ui.originalLabel}
            </h3>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Original full text (always content_original) */}
          {originalText ? (
            <div className="whitespace-pre-line text-[15px] sm:text-base leading-relaxed text-ink-light">
              {originalText}
            </div>
          ) : (
            <p className="text-sm text-ink-light">—</p>
          )}

          {/* External original link (footer) */}
          {item.url && (
            <div className="mt-8 pt-4 border-t border-border">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover transition-colors duration-200"
              >
                {labels.link}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Lightbox — fullscreen zoom + pan */}
      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc}
          altFallback={content.title}
          onClose={() => setLightboxSrc(null)}
          labels={{ zoomIn: labels.zoomIn, zoomOut: labels.zoomOut, reset: labels.reset, close: labels.close }}
        />
      )}
    </div>
  );
}

// ---------- Image carousel (horizontal scroll snap) ----------
function ImageCarousel({
  images,
  altFallback,
  viewImageLabel,
  notNewsPhotoLabel,
  onImageTap,
}: {
  images: string[];
  altFallback: string;
  viewImageLabel: string;
  onImageTap: (src: string) => void;
  /** When set, shows a "not a news photo" badge — used for fallback images. */
  notNewsPhotoLabel?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [broken, setBroken] = useState<Set<number>>(() => new Set());

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== activeIdx) setActiveIdx(idx);
  };

  const markBroken = (i: number) => {
    setBroken((prev) => {
      if (prev.has(i)) return prev;
      const next = new Set(prev);
      next.add(i);
      return next;
    });
  };

  return (
    <div className="relative bg-black/5 flex-shrink-0">
      {notNewsPhotoLabel && (
        <span className="absolute top-2 right-2 sm:top-3 sm:right-3 z-10 px-2 py-0.5 text-[10px] sm:text-xs font-medium rounded bg-black/60 text-white pointer-events-none">
          {notNewsPhotoLabel}
        </span>
      )}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex overflow-x-auto snap-x snap-mandatory h-[30vh] sm:h-[35vh] w-full"
        aria-label="Article images"
        role="region"
      >
        {images.map((src, i) => {
          const isBroken = broken.has(i);
          return (
            <button
              key={`${src}-${i}`}
              type="button"
              onClick={() => !isBroken && onImageTap(src)}
              className="snap-center shrink-0 w-full h-full flex items-center justify-center bg-black/5 relative focus:outline-none focus:ring-2 focus:ring-accent/40"
              aria-label={`${viewImageLabel} (${i + 1}/${images.length})`}
            >
              {isBroken ? (
                <span className="text-sm text-ink-light">—</span>
              ) : (
                <img
                  src={src}
                  alt={`${altFallback} — image ${i + 1}`}
                  loading="lazy"
                  draggable={false}
                  onError={() => markBroken(i)}
                  className="max-w-full max-h-full object-contain select-none pointer-events-none"
                />
              )}
            </button>
          );
        })}
      </div>
      {images.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 py-2">
          {images.map((_, i) => (
            <span
              key={i}
              className={`block rounded-full transition-all duration-200 ${
                i === activeIdx ? "w-4 h-1.5 bg-accent" : "w-1.5 h-1.5 bg-ink/20"
              }`}
              aria-hidden="true"
            />
          ))}
          <span className="sr-only">
            {activeIdx + 1} / {images.length}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------- Image lightbox (zoom + pan) ----------
function ImageLightbox({
  src,
  altFallback,
  onClose,
  labels,
}: {
  src: string;
  altFallback: string;
  onClose: () => void;
  labels: { zoomIn: string; zoomOut: string; reset: string; close: string };
}) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  // Gesture state — kept in a ref to avoid re-render storms during gestures.
  const gestureRef = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    pinchStartDist: number | null;
    pinchBaseScale: number;
    panStart: { x: number; y: number; tx: number; ty: number } | null;
  }>({
    pointers: new Map(),
    pinchStartDist: null,
    pinchBaseScale: 1,
    panStart: null,
  });

  // Double-click / double-tap tracking
  const lastClickRef = useRef<number>(0);

  // Clamp helpers
  const clampScale = useCallback((s: number) => {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
  }, []);

  const clampPan = useCallback((nextTx: number, nextTy: number, s: number) => {
    if (s <= 1) return { tx: 0, ty: 0 };
    const maxX = (s - 1) * PAN_FACTOR * window.innerWidth;
    const maxY = (s - 1) * PAN_FACTOR * window.innerHeight;
    return {
      tx: Math.min(maxX, Math.max(-maxX, nextTx)),
      ty: Math.min(maxY, Math.max(-maxY, nextTy)),
    };
  }, []);

  const reset = useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, []);

  // Reset transform whenever the image src changes
  useEffect(() => {
    reset();
  }, [src, reset]);

  // ----- Pointer handlers (mouse + touch unified) -----
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Only react to primary mouse button or touch/pen
    if (e.pointerType === "mouse" && e.button !== 0) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const g = gestureRef.current;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (g.pointers.size === 2) {
      // Begin pinch — capture initial distance and base scale
      const pts = Array.from(g.pointers.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      g.pinchStartDist = Math.hypot(dx, dy);
      g.pinchBaseScale = scale;
      g.panStart = null;
    } else if (g.pointers.size === 1 && scale > 1) {
      // Begin pan (only meaningful when zoomed in)
      g.panStart = { x: e.clientX, y: e.clientY, tx, ty };
      g.pinchStartDist = null;
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (g.pointers.size === 2 && g.pinchStartDist) {
      const pts = Array.from(g.pointers.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0) {
        const next = clampScale((g.pinchBaseScale * dist) / g.pinchStartDist);
        setScale(next);
        // If zoom drops back to 1, center the image
        if (next <= 1) {
          setTx(0);
          setTy(0);
        } else {
          const clamped = clampPan(tx, ty, next);
          setTx(clamped.tx);
          setTy(clamped.ty);
        }
      }
    } else if (g.pointers.size === 1 && g.panStart && scale > 1) {
      const nextTx = g.panStart.tx + (e.clientX - g.panStart.x);
      const nextTy = g.panStart.ty + (e.clientY - g.panStart.y);
      const clamped = clampPan(nextTx, nextTy, scale);
      setTx(clamped.tx);
      setTy(clamped.ty);
    }
  };

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    g.pointers.delete(e.pointerId);
    if (g.pointers.size < 2) {
      g.pinchStartDist = null;
    }
    if (g.pointers.size === 0) {
      g.panStart = null;
    } else if (g.pointers.size === 1) {
      // Switched from pinch to single pointer — start pan if zoomed
      const remaining = Array.from(g.pointers.entries())[0];
      if (remaining && scale > 1) {
        g.panStart = { x: remaining[1].x, y: remaining[1].y, tx, ty };
      }
    }
  };

  // ----- Wheel zoom (mouse) -----
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (!e.cancelable) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = e.deltaY < 0 ? 1 : -1;
    setScale((s) => {
      const next = clampScale(s + dir * SCALE_STEP);
      if (next <= 1) {
        setTx(0);
        setTy(0);
      }
      return next;
    });
  };

  // ----- Zoom buttons -----
  const zoomIn = () => setScale((s) => clampScale(s + SCALE_STEP * 2));
  const zoomOut = () => {
    setScale((s) => {
      const next = clampScale(s - SCALE_STEP * 2);
      if (next <= 1) {
        setTx(0);
        setTy(0);
      }
      return next;
    });
  };

  // ----- Click / double-click (mouse + touch) -----
  const onImageClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastClickRef.current < 300) {
      reset();
      lastClickRef.current = 0;
    } else {
      lastClickRef.current = now;
    }
  };

  const onImageDoubleClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    reset();
  };

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      {/* Image stage — captures gestures */}
      <div
        className="relative w-full h-full flex items-center justify-center overflow-hidden touch-none"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onWheel={onWheel}
      >
        <img
          src={src}
          alt={altFallback}
          draggable={false}
          onClick={onImageClick}
          onDoubleClick={onImageDoubleClick}
          className="max-w-[95vw] max-h-[90vh] object-contain select-none"
          style={{
            transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
            cursor: scale > 1 ? "grab" : "zoom-in",
            touchAction: "none",
          }}
        />
      </div>

      {/* Top-right controls */}
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4 flex flex-col gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label={labels.close}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors backdrop-blur-sm"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Bottom controls — zoom + reset */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-2 bg-black/50 rounded-full backdrop-blur-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={zoomOut}
          aria-label={labels.zoomOut}
          className="w-9 h-9 flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-colors text-lg font-medium"
        >
          −
        </button>
        <button
          onClick={reset}
          aria-label={labels.reset}
          className="px-3 h-9 flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-colors text-xs font-medium uppercase tracking-wider"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          onClick={zoomIn}
          aria-label={labels.zoomIn}
          className="w-9 h-9 flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-colors text-lg font-medium"
        >
          +
        </button>
      </div>
    </div>
  );
}
