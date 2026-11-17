-- ============================================================
-- Border (El Paso / Juarez) + Aviation News Hub — Supabase schema
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.news_items (
  id                uuid primary key default gen_random_uuid(),
  url_hash          text not null unique,          -- sha256 of normalized URL (dedupe key)
  url               text not null,                 -- original article URL
  topic             text not null check (topic in ('border', 'aviation')),
  source            text,                          -- outlet name (e.g. 'El Paso Times')
  language_original text check (language_original in ('en', 'es', 'zh')),
  title_en          text not null,                 -- original language title (guaranteed non-empty)
  title_zh          text,
  title_es          text,
  summary_en        text,
  summary_zh        text,
  summary_es        text,
  image_url         text,
  image_urls        text[] not null default '{}',
  content_original  text,
  content_zh        text,
  content_es        text,
  published_at      timestamptz,
  fetched_at        timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index if not exists news_items_published_at_idx on public.news_items (published_at desc);
create index if not exists news_items_topic_idx        on public.news_items (topic);

alter table public.news_items enable row level security;

-- Public read: the web UI (Vercel) uses the anon key; anyone with the URL can read news.
create policy "news_items_public_read" on public.news_items
  for select using (true);

-- Intentionally NO insert/update/delete policies:
-- only the crawler, which runs with the service_role key (server-side, GitHub Actions), can write.
