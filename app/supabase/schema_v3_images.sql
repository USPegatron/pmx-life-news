-- ============================================================
-- Migration 0003: multi-image array (overlay carousel + lightbox)
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Safe / idempotent: uses ADD COLUMN IF NOT EXISTS.
-- ============================================================

alter table public.news_items
  add column if not exists image_urls text[] not null default '{}';
