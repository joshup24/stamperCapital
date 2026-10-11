-- =====================================================================
-- Temporary experiment: when does Alpha Vantage's GLOBAL_QUOTE reflect a day's close?
-- Alpha Vantage does not publish this. quote_probe records what it returns at set times
-- around the close; once we know, drop this table and the probe workflow.
-- =====================================================================
create table public.quote_probe (
  id                 bigint generated always as identity primary key,
  probed_at          timestamptz not null default now(),
  symbol             text not null,
  -- 'default' is how the ingest calls it; 'delayed' and 'realtime' show what your plan allows
  variant            text not null default 'default',
  latest_trading_day date,
  price              numeric,
  volume             bigint,
  previous_close     numeric,
  raw                jsonb   -- the full response, including any plan or error message
);
create index quote_probe_time_idx on public.quote_probe (probed_at);

alter table public.quote_probe enable row level security;
create policy "members read" on public.quote_probe
  for select to authenticated using (public.is_member());
