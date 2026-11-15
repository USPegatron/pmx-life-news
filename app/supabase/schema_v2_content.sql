-- ============================================================
-- Migration 0002: full article text columns (on-demand translation)
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Safe / idempotent: uses ADD COLUMN IF NOT EXISTS.
-- ============================================================

alter table public.news_items
  add column if not exists content_original text,  -- cleaned full text, original language
  add column if not exists content_zh         text, -- cached Traditional-Chinese translation
  add column if not exists content_es         text; -- cached Spanish translation
