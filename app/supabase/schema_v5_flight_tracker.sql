-- ============================================================
-- Migration 0005: flight_tracker last_checked_at column
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- ============================================================

alter table public.flights_to_track
  add column if not exists last_checked_at timestamptz;
