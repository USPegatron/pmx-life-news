"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import type { NewsItem, Language, TopicFilter, TimeFilter } from "@/lib/types";
import {
  getTranslatedContent,
  formatRelativeTime,
  formatFullDate,
  getUIStrings,
  detectInitialLanguage,
  filterNewsItems,
} from "@/lib/utils";

const REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes
const FETCH_LIMIT = 300;

// Columns for the list (content_* fetched lazily on demand via the API).
const LIST_COLUMNS =
  "id,url_hash,url,topic,source,language_original,title_en,title_zh,title_es,summary_en,summary_zh,summary_es,image_url,published_at,fetched_at,created_at";

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

  // Language toggle handler
  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
  };

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-paper/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-4 sm:py-5 gap-4">
            {/* Hub name */}
            <div className="flex-shrink-0">
              <h1 className="text-2xl sm:text-3xl font-display font-semibold text-ink tracking-tight">
                {ui.hubName}
              </h1>
              <p className="text-sm text-ink-light mt-0.5 font-body">
                {ui.hubSubtitle}
              </p>
            </div>

            {/* Controls row */}
            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
              {/* Language toggle */}
              <div className="flex items-center bg-ink/5 rounded-lg p-1" role="group" aria-label="Language selection">
                {(["zh", "en", "es"] as Language[]).map((lang, idx) => (
                  <button
                    key={lang}
                    onClick={() => handleLanguageChange(lang)}
                    className={`
                      px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200
                      ${language === lang
                        ? "bg-white text-ink shadow-sm"
                        : "text-ink-light hover:text-ink"
                      }
                      ${idx === 0 ? "rounded-l-md" : ""}
                      ${idx === 2 ? "rounded-r-md" : ""}
                    `}
                    aria-pressed={language === lang}
                  >
                    {lang === "zh" ? ui.langZh : lang === "es" ? ui.langEs : ui.langEn}
                  </button>
                ))}
              </div>

              {/* Refresh button */}
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className={`
                  flex items-center gap-2 px-3 py-1.5 text-sm font-medium
                  rounded-lg border border-border bg-white
                  text-ink-light hover:text-accent hover:border-accent/50
                  transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
                  no-print
                `}
                aria-label={ui.refreshing}
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
                <span className="hidden sm:inline">{isRefreshing ? ui.refreshing : ui.lastUpdated}</span>
                {lastFetched && !isRefreshing && (
                  <span className="text-xs text-ink-light">
                    {formatRelativeTime(lastFetched.toISOString(), language)}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Filters bar */}
          <div className="flex flex-wrap items-center gap-3 pb-4 no-print">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
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
                  className="w-full pl-10 pr-4 py-2 text-sm bg-white border border-border rounded-lg
                    text-ink placeholder-ink-light
                    focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent
                    transition-all duration-200"
                />
              </div>
            </div>

            {/* Topic filter */}
            <div className="flex items-center gap-1 bg-ink/5 rounded-lg p-1">
              {[
                { value: "all", label: ui.topicAll },
                { value: "border", label: ui.topicBorder },
                { value: "aviation", label: ui.topicAviation },
              ].map((topic) => (
                <button
                  key={topic.value}
                  onClick={() => setTopicFilter(topic.value as TopicFilter)}
                  className={`
                    px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200
                    ${topicFilter === topic.value
                      ? "bg-white text-ink shadow-sm"
                      : "text-ink-light hover:text-ink"
                    }
                  `}
                >
                  {topic.label}
                </button>
              ))}
            </div>

            {/* Time filter */}
            <div className="flex items-center gap-1 bg-ink/5 rounded-lg p-1">
              {[
                { value: "24h", label: ui.time24h },
                { value: "7d", label: ui.time7d },
                { value: "all", label: ui.timeAll },
              ].map((time) => (
                <button
                  key={time.value}
                  onClick={() => setTimeFilter(time.value as TimeFilter)}
                  className={`
                    px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200
                    ${timeFilter === time.value
                      ? "bg-white text-ink shadow-sm"
                      : "text-ink-light hover:text-ink"
                    }
                  `}
                >
                  {time.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Loading state */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="bg-white rounded-xl border border-border overflow-hidden shadow-card"
              >
                <div className="aspect-video skeleton" />
                <div className="p-5 space-y-3">
                  <div className="h-4 w-20 skeleton rounded" />
                  <div className="h-6 w-3/4 skeleton rounded" />
                  <div className="h-4 w-full skeleton rounded" />
                  <div className="h-4 w-2/3 skeleton rounded" />
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

        {/* News grid */}
        {!isLoading && !error && filteredItems.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {filteredItems.map((item, index) => (
              <NewsCard
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

// News Card Component
function NewsCard({
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

  const animationClass = delay > 0 ? `fade-in fade-in-delay-${Math.min(delay, 6)}` : "";

  return (
    <article
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`
        group cursor-pointer bg-white rounded-xl border border-border overflow-hidden
        shadow-card hover:shadow-card-hover focus:outline-none focus:ring-2 focus:ring-accent/30
        transition-all duration-300
        ${animationClass}
      `}
    >
      {/* Image */}
      <div className="aspect-video relative overflow-hidden bg-ink/5">
        {item.image_url && !imageError ? (
          <img
            src={item.image_url}
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
              className="w-12 h-12 text-white/60"
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

        {/* Topic badge overlay */}
        <div className="absolute top-3 left-3">
          <span
            className={`
              px-2.5 py-1 text-xs font-semibold rounded-full uppercase tracking-wider
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

      {/* Content */}
      <div className="p-5">
        {/* Source and time */}
        <div className="flex items-center gap-2 mb-3">
          {item.source && (
            <span className="text-xs font-medium text-ink-light uppercase tracking-wide">
              {item.source}
            </span>
          )}
          {relativeTime && (
            <>
              <span className="w-1 h-1 rounded-full bg-border" />
              <time
                dateTime={item.published_at || undefined}
                className="text-xs text-ink-light"
                title={fullDate}
              >
                {relativeTime}
              </time>
            </>
          )}
        </div>

        {/* Title */}
        <h2 className="text-lg font-display font-semibold text-ink leading-snug mb-2 line-clamp-2 group-hover:text-accent transition-colors duration-200">
          {content.title}
        </h2>

        {/* Summary */}
        {content.summary && (
          <p className="text-sm text-ink-light leading-relaxed line-clamp-3 mb-4">
            {content.summary}
          </p>
        )}

        {/* Read more link (external original) */}
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover transition-colors duration-200"
        >
          {ui.readMore}
          <svg
            className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-200"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M14 5l7 7m0 0l-7 7m7-7H3"
            />
          </svg>
        </a>
      </div>
    </article>
  );
}

type OverlayData = {
  content?: string;
  original?: string;
  translated?: boolean;
  cached?: boolean;
  note?: string;
};

// Full-article reading overlay with on-demand translation
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
  const [data, setData] = useState<OverlayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);

  const labels =
    language === "zh"
      ? { translated: "譯文", original: "原文", loading: "翻譯中…", failed: "翻譯失敗", link: "開啟原文連結" }
      : language === "es"
      ? { translated: "Traducción", original: "Original", loading: "Traduciendo…", failed: "Error de traducción", link: "Abrir original" }
      : { translated: "Translated", original: "Original", loading: "Translating…", failed: "Translation failed", link: "Open original" };

  // Fetch full-text translation for the current language
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setData(null);
    setShowOriginal(false);

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

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const shownText = showOriginal
    ? data?.original ?? ""
    : data?.content ?? "";
  const isBorder = item.topic === "border";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 backdrop-blur-sm p-4 sm:p-8 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative bg-paper w-full max-w-3xl rounded-2xl shadow-xl my-4 sm:my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-paper/95 backdrop-blur border-b border-border rounded-t-2xl px-5 sm:px-6 py-4">
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                {item.source && (
                  <span className="text-xs font-medium text-ink-light uppercase tracking-wide">
                    {item.source}
                  </span>
                )}
                <span className="w-1 h-1 rounded-full bg-border" />
                <span className="text-xs text-ink-light">
                  {formatRelativeTime(item.published_at, language)}
                </span>
                <span
                  className={`ml-1 px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase tracking-wider text-white ${
                    isBorder ? "bg-border-topic/90" : "bg-aviation-topic/90"
                  }`}
                >
                  {isBorder ? "Border" : "Aviation"}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-display font-semibold text-ink leading-snug">
                {content.title}
              </h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex-shrink-0 p-2 -m-2 rounded-lg text-ink-light hover:text-ink hover:bg-ink/5 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 sm:px-6 py-5">
          {/* Translated / Original toggle */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center bg-ink/5 rounded-lg p-1">
              <button
                onClick={() => setShowOriginal(false)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                  !showOriginal ? "bg-white text-ink shadow-sm" : "text-ink-light hover:text-ink"
                }`}
              >
                {labels.translated}
              </button>
              <button
                onClick={() => setShowOriginal(true)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                  showOriginal ? "bg-white text-ink shadow-sm" : "text-ink-light hover:text-ink"
                }`}
              >
                {labels.original}
              </button>
            </div>
            {loading && (
              <span className="flex items-center gap-1.5 text-sm text-ink-light">
                <svg className="w-4 h-4 spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                {labels.loading}
              </span>
            )}
          </div>

          {/* Content */}
          {err ? (
            <p className="text-sm text-red-500">
              {labels.failed}：{err}
            </p>
          ) : loading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-4 skeleton rounded" style={{ width: `${100 - (i % 3) * 12}%` }} />
              ))}
            </div>
          ) : shownText ? (
            <div className="whitespace-pre-line text-[15px] leading-relaxed text-ink">
              {shownText}
            </div>
          ) : (
            <p className="text-sm text-ink-light">{content.summary || "—"}</p>
          )}

          {/* External original link */}
          <div className="mt-6 pt-4 border-t border-border">
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
        </div>
      </div>
    </div>
  );
}
