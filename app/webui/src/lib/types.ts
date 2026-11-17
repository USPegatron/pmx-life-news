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
  image_urls: string[] | null;
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

/**
 * One flight row from `public.flights_to_track`.
 *
 * Non-null fields: id, flight_date, dep_airport, arr_airport, airline_code,
 * flight_number, status, updated_by, created_at, updated_at (all `string`).
 *
 * Nullable fields: scheduled_dep, scheduled_arr, actual_dep, actual_arr,
 * notes (`string | null`); delay_minutes (`number | null`).
 */
export interface Flight {
  id: string;
  flight_date: string;
  dep_airport: string;
  arr_airport: string;
  airline_code: string;
  flight_number: string;
  status: string;
  scheduled_dep: string | null;
  scheduled_arr: string | null;
  actual_dep: string | null;
  actual_arr: string | null;
  delay_minutes: number | null;
  notes: string | null;
  updated_by: string;
  created_at: string;
  updated_at: string;
}
