-- ============================================================
-- Migration 0004: PMX flight tracker (company-trip flight watch)
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- ============================================================

create table if not exists public.flights_to_track (
  id              uuid        primary key default gen_random_uuid(),
  flight_date     date        not null,
  dep_airport     text        not null,                 -- IATA, e.g. 'TPE'
  arr_airport     text        not null,                 -- IATA, e.g. 'LAX'
  airline_code    text        not null,                 -- e.g. 'AA'
  flight_number   text        not null,                 -- e.g. '1234'
  status          text        not null default 'scheduled'
                              check (status in ('scheduled','departed','arrived','cancelled')),
  scheduled_dep   timestamptz,
  scheduled_arr   timestamptz,
  actual_dep      timestamptz,
  actual_arr      timestamptz,
  delay_minutes   int,                                  -- auto-computed in API (actual_arr - scheduled_arr, minutes)
  notes           text,
  updated_by      text        not null default 'human', -- 'human' / 'ai' / 'import'
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Prevent duplicate entries for the same flight on the same day
create unique index if not exists flights_unique_idx
  on public.flights_to_track (flight_date, dep_airport, arr_airport, airline_code, flight_number);

create index if not exists flights_date_idx    on public.flights_to_track (flight_date);
create index if not exists flights_status_idx  on public.flights_to_track (status);

alter table public.flights_to_track enable row level security;

-- Public read for the web UI (anon key)
create policy "flights_public_read" on public.flights_to_track
  for select using (true);

-- No insert/update/delete policies: writes happen via the service_role key (server-only)
-- in the Vercel /api/flights/* routes.
