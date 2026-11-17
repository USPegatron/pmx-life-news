-- ============================================================
-- Migration 0006: flight tracker v6 (split lights + archive + display fields)
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- ============================================================

alter table public.flights_to_track
  add column if not exists airline_name          text,
  add column if not exists aircraft_type         text,
  add column if not exists departure_delay_minutes int,
  add column if not exists archived_at           timestamptz;

-- Index for the default "exclude archived" filter
create index if not exists flights_archived_idx
  on public.flights_to_track (archived_at);
