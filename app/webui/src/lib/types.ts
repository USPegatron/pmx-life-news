export interface NewsItem {
  id: string;
  url_hash: string;
  url: string;
  topic: "border" | "aviation";
  source: string | null;
  language_original: "en" | "es" | "zh" | null;
  title_en: string;
  title_zh: string | null;
  title_es: string | null;
  summary_en: string | null;
  summary_zh: string | null;
  summary_es: string | null;
  content_original: string | null;
  content_zh: string | null;
  content_es: string | null;
  image_url: string | null;
  published_at: string | null;
  fetched_at: string;
  created_at: string;
}

export type Language = "zh" | "en" | "es";

export type TopicFilter = "all" | "border" | "aviation";

export type TimeFilter = "24h" | "7d" | "all";

export interface TranslatedContent {
  title: string;
  summary: string;
}
