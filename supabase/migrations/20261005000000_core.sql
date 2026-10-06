-- =====================================================================
-- Core: users, tickers, groups, company overview, quotes, monthly prices,
-- and the bookkeeping that makes refreshes incremental.
--
-- Design rules for the whole schema
--   * Raw tables are written only by the ingest job (secret key, bypasses RLS).
--   * Corrections live in separate *_override tables the ingest job never touches.
--   * The app reads views that apply corrections on top of raw data.
--   * Prices and statements join on year-month, like the Power BI model.
-- =====================================================================

-- First day of the month. Immutable, so it can back generated columns.
create function public.month_start(d date) returns date
language sql immutable as $$ select d - (extract(day from d)::int - 1) $$;


-- ---------------------------------------------------------------------
-- Users & roles  (viewer = read only, editor = can correct data, admin)
-- ---------------------------------------------------------------------
create table public.app_user (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role         text not null default 'viewer' check (role in ('viewer', 'editor', 'admin')),
  created_at   timestamptz not null default now()
);

create function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_user where user_id = auth.uid());
$$;

create function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_user
                 where user_id = auth.uid() and role in ('editor', 'admin'));
$$;

-- Every new login gets a viewer row; promote people in the Table Editor.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_user (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- Tickers. Symbols use Alpha Vantage spelling: BRK-B, not BRK.B.
-- ---------------------------------------------------------------------
create table public.ticker (
  symbol            text primary key check (symbol = upper(symbol)),
  is_active         boolean not null default true,
  -- Alpha Vantage has nothing for ETFs, many foreign listings, etc. 'no_data' tickers are
  -- skipped by the daily run so they stop costing API calls (reset with a forced run).
  av_status         text not null default 'unknown' check (av_status in ('unknown', 'ok', 'no_data')),
  av_checked_at     timestamptz,
  -- your own bucket for valuation multiples, e.g. DEFENSE, INSURANCE, AUTO (see multiple_rule)
  category          text check (category = upper(category)),
  multiple_override numeric check (multiple_override > 0),
  notes             text,
  added_at          timestamptz not null default now()
);

-- Replaces equity-groups.xlsm. A ticker can be in several groups.
create table public.ticker_group (
  symbol     text not null references public.ticker(symbol) on delete cascade,
  group_name text not null check (group_name = upper(group_name)),
  notes      text,
  added_at   timestamptz not null default now(),
  primary key (symbol, group_name)
);
create index ticker_group_group_idx on public.ticker_group (group_name);


-- ---------------------------------------------------------------------
-- Company overview and latest quote: one row per symbol, replaced on refresh.
-- ---------------------------------------------------------------------
create table public.company_overview (
  symbol             text primary key references public.ticker(symbol) on delete cascade,
  name               text,
  asset_type         text,
  exchange           text,
  currency           text,
  country            text,
  sector             text,
  industry           text,
  fiscal_year_end    text,
  latest_quarter     date,
  market_cap         numeric,
  shares_outstanding numeric,
  description        text,
  data               jsonb not null,   -- the rest of the OVERVIEW fields
  fetched_at         timestamptz not null default now()
);

create table public.quote_latest (
  symbol             text primary key references public.ticker(symbol) on delete cascade,
  price              numeric,
  open               numeric,
  high               numeric,
  low                numeric,
  volume             bigint,
  latest_trading_day date,
  previous_close     numeric,
  change             numeric,
  change_percent     numeric,
  fetched_at         timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- Monthly adjusted prices, keyed by MONTH. Alpha Vantage dates the current
-- month with today's date and later replaces it with the month-end date, so
-- keying on the date itself would keep both rows.
-- ---------------------------------------------------------------------
create table public.price_monthly (
  symbol          text not null references public.ticker(symbol) on delete cascade,
  month           date not null check (month = public.month_start(month)),
  month_end       date not null,   -- the date Alpha Vantage used for this bar
  open            numeric,
  high            numeric,
  low             numeric,
  close           numeric,
  adjusted_close  numeric,
  volume          bigint,
  dividend_amount numeric,
  fetched_at      timestamptz not null default now(),
  primary key (symbol, month)
);

-- Corrections, e.g. spinoffs recorded as cash dividends (MO: 22.57 in Apr 2007, 51.23 in Mar 2008).
-- Rows are retired, never deleted, so every correction stays on record.
create table public.price_override (
  id                    bigint generated always as identity primary key,
  symbol                text not null references public.ticker(symbol) on delete cascade,
  month                 date not null check (month = public.month_start(month)),
  field                 text not null check (field in
                          ('open', 'high', 'low', 'close', 'adjusted_close', 'volume', 'dividend_amount')),
  value                 numeric,   -- null = treat as missing
  raw_value_at_override numeric,   -- what Alpha Vantage said when you corrected it
  reason                text not null,
  created_by            uuid default auth.uid() references auth.users(id),
  created_at            timestamptz not null default now(),
  retired_at            timestamptz,
  retired_by            uuid references auth.users(id)
);

create unique index price_override_active_uq
  on public.price_override (symbol, month, field) where retired_at is null;

create view public.price_monthly_effective
with (security_invoker = true) as
with o as (
  select
    symbol, month,
    jsonb_object_agg(field, value) as j
  from public.price_override
  where retired_at is null
  group by symbol, month
)
select
  p.symbol, p.month, p.month_end,
  case when o.j ? 'open'            then (o.j ->> 'open')::numeric            else p.open            end as open,
  case when o.j ? 'high'            then (o.j ->> 'high')::numeric            else p.high            end as high,
  case when o.j ? 'low'             then (o.j ->> 'low')::numeric             else p.low             end as low,
  case when o.j ? 'close'           then (o.j ->> 'close')::numeric           else p.close           end as close,
  case when o.j ? 'adjusted_close'  then (o.j ->> 'adjusted_close')::numeric  else p.adjusted_close  end as adjusted_close,
  case when o.j ? 'volume'          then (o.j ->> 'volume')::bigint           else p.volume          end as volume,
  case when o.j ? 'dividend_amount' then (o.j ->> 'dividend_amount')::numeric else p.dividend_amount end as dividend_amount,
  o.j is not null as is_overridden
from public.price_monthly p
left join o on o.symbol = p.symbol and o.month = p.month;


-- ---------------------------------------------------------------------
-- Incremental refresh bookkeeping
-- ---------------------------------------------------------------------
-- When each ticker was last refreshed, per dataset, so a run only fetches what is due.
create table public.ticker_refresh (
  symbol              text not null references public.ticker(symbol) on delete cascade,
  dataset             text not null check (dataset in
                        ('overview', 'income', 'balance', 'cashflow', 'earnings', 'prices', 'quote')),
  last_success_at     timestamptz not null,
  latest_period_seen  date,   -- newest fiscal date / trading day in that fetch
  primary key (symbol, dataset)
);

-- Alpha Vantage EARNINGS_CALENDAR (one call covers every company). A company that has
-- reported since its last fetch is "due" for new statements.
create table public.earnings_calendar (
  symbol             text not null references public.ticker(symbol) on delete cascade,
  fiscal_date_ending date not null,
  report_date        date not null,
  estimate           numeric,
  currency           text,
  fetched_at         timestamptz not null default now(),
  primary key (symbol, fiscal_date_ending)
);
create index earnings_calendar_report_idx on public.earnings_calendar (report_date);

create table public.ingest_run (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running'
              check (status in ('running', 'success', 'partial', 'rate_limited', 'failed')),
  jobs        text[],
  symbols     int,        -- how many tickers were in scope
  api_calls   int,
  errors      jsonb
);


-- ---------------------------------------------------------------------
-- Row level security. The ingest job uses the secret key, which bypasses it.
-- Members (signed-in, invited users) read everything; editors also manage
-- tickers and groups.
-- ---------------------------------------------------------------------
alter table public.app_user enable row level security;
create policy "read own user row" on public.app_user
  for select to authenticated using (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array[
    'ticker', 'ticker_group', 'company_overview', 'quote_latest', 'price_monthly',
    'price_override', 'ticker_refresh', 'earnings_calendar', 'ingest_run'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member())', t);
  end loop;
end $$;

create policy "editors add tickers" on public.ticker
  for insert to authenticated with check (public.is_editor());
create policy "editors update tickers" on public.ticker
  for update to authenticated using (public.is_editor()) with check (public.is_editor());

create policy "editors add to groups" on public.ticker_group
  for insert to authenticated with check (public.is_editor());
create policy "editors update groups" on public.ticker_group
  for update to authenticated using (public.is_editor()) with check (public.is_editor());
create policy "editors remove from groups" on public.ticker_group
  for delete to authenticated using (public.is_editor());

create policy "editors add price overrides" on public.price_override
  for insert to authenticated with check (public.is_editor());
create policy "editors retire price overrides" on public.price_override
  for update to authenticated using (public.is_editor()) with check (public.is_editor());
