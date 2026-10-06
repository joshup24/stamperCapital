-- =====================================================================
-- Initial schema
--   * ticker universe
--   * raw Alpha Vantage data (ingest job owns these tables)
--   * user overrides (ingest job never touches these)
--   * effective views = override if present, else raw
-- =====================================================================


-- ---------------------------------------------------------------------
-- Users & roles  (viewer = read only, editor = can override data, admin)
-- ---------------------------------------------------------------------
create table public.app_user (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role         text not null default 'viewer' check (role in ('viewer', 'editor', 'admin')),
  created_at   timestamptz not null default now()
);

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_user where user_id = auth.uid());
$$;

create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_user
                 where user_id = auth.uid() and role in ('editor', 'admin'));
$$;

-- Every new login gets a viewer row; promote people in the Table Editor.
create or replace function public.handle_new_user() returns trigger
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
-- Universe of tickers
-- ---------------------------------------------------------------------
create table public.ticker (
  symbol    text primary key check (symbol = upper(symbol)),
  is_active boolean not null default true,
  notes     text,
  added_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- Financial statements (income, balance, cashflow, earnings)
-- Stored long/narrow: one row per symbol + period + field. This keeps
-- overrides uniform no matter which statement or line item is wrong.
-- ---------------------------------------------------------------------
create table public.statement_period (
  symbol             text not null references public.ticker(symbol) on delete cascade,
  statement          text not null check (statement in ('income', 'balance', 'cashflow', 'earnings')),
  period             text not null check (period in ('annual', 'quarterly')),
  fiscal_date_ending date not null,
  reported_date      date,   -- earnings only
  report_time        text,   -- earnings only (pre-market / post-market)
  reported_currency  text,
  fetched_at         timestamptz not null default now(),
  primary key (symbol, statement, period, fiscal_date_ending)
);

create table public.statement_value_raw (
  symbol             text not null,
  statement          text not null,
  period             text not null,
  fiscal_date_ending date not null,
  field              text not null,   -- Alpha Vantage field name, e.g. totalRevenue
  value              numeric,         -- null when AV sends "None"
  fetched_at         timestamptz not null default now(),
  primary key (symbol, statement, period, fiscal_date_ending, field),
  foreign key (symbol, statement, period, fiscal_date_ending)
    references public.statement_period on delete cascade
);

create index statement_value_raw_screen_idx
  on public.statement_value_raw (statement, period, field, fiscal_date_ending);

-- Corrections. Never written by the ingest job. Rows are retired, not
-- deleted, so there is a full audit trail of every correction.
create table public.statement_value_override (
  id                    bigint generated always as identity primary key,
  symbol                text not null references public.ticker(symbol) on delete cascade,
  statement             text not null check (statement in ('income', 'balance', 'cashflow', 'earnings')),
  period                text not null check (period in ('annual', 'quarterly')),
  fiscal_date_ending    date not null,
  field                 text not null,
  value                 numeric,   -- null = "treat as missing"
  raw_value_at_override numeric,   -- what AV said when the override was made
  reason                text not null,
  created_by            uuid default auth.uid() references auth.users(id),
  created_at            timestamptz not null default now(),
  retired_at            timestamptz,
  retired_by            uuid references auth.users(id)
);

create unique index statement_value_override_active_uq
  on public.statement_value_override (symbol, statement, period, fiscal_date_ending, field)
  where retired_at is null;

-- What the screener and app read. Full outer join so an override can also
-- fill a value (or a whole period) that Alpha Vantage is missing.
create view public.statement_value_effective
with (security_invoker = true) as
select
  coalesce(r.symbol, o.symbol)                          as symbol,
  coalesce(r.statement, o.statement)                    as statement,
  coalesce(r.period, o.period)                          as period,
  coalesce(r.fiscal_date_ending, o.fiscal_date_ending)  as fiscal_date_ending,
  coalesce(r.field, o.field)                            as field,
  case when o.id is not null then o.value else r.value end as value,
  r.value                                               as raw_value,
  o.value                                               as override_value,
  o.id                                                  as override_id,
  o.id is not null                                      as is_overridden,
  -- AV changed its number after you corrected it: worth a second look
  (o.id is not null and r.value is distinct from o.raw_value_at_override) as raw_changed_since_override
from public.statement_value_raw r
full outer join (
  select * from public.statement_value_override where retired_at is null
) o
  on  o.symbol = r.symbol
  and o.statement = r.statement
  and o.period = r.period
  and o.fiscal_date_ending = r.fiscal_date_ending
  and o.field = r.field;


-- ---------------------------------------------------------------------
-- Prices, overview, quote
-- ---------------------------------------------------------------------
create table public.price_monthly (
  symbol          text not null references public.ticker(symbol) on delete cascade,
  month_end       date not null,
  open            numeric,
  high            numeric,
  low             numeric,
  close           numeric,
  adjusted_close  numeric,
  volume          bigint,
  dividend_amount numeric,
  fetched_at      timestamptz not null default now(),
  primary key (symbol, month_end)
);

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
  data               jsonb not null,   -- full OVERVIEW payload
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
-- Ingest bookkeeping
-- ---------------------------------------------------------------------
-- Latest raw JSON per symbol + endpoint, for debugging bad data.
create table public.api_payload (
  symbol     text not null,
  function   text not null,
  payload    jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (symbol, function)
);

create table public.ingest_run (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running'
              check (status in ('running', 'success', 'partial', 'rate_limited', 'failed')),
  jobs        text[],
  symbols     text[],
  api_calls   int,
  errors      jsonb
);


-- ---------------------------------------------------------------------
-- Row level security
-- The ingest job uses the secret key, which bypasses RLS.
-- ---------------------------------------------------------------------
alter table public.app_user                 enable row level security;
alter table public.ticker                   enable row level security;
alter table public.statement_period         enable row level security;
alter table public.statement_value_raw      enable row level security;
alter table public.statement_value_override enable row level security;
alter table public.price_monthly            enable row level security;
alter table public.company_overview         enable row level security;
alter table public.quote_latest             enable row level security;
alter table public.api_payload              enable row level security;
alter table public.ingest_run               enable row level security;

create policy "read own user row" on public.app_user
  for select to authenticated using (user_id = auth.uid());

create policy "members read" on public.ticker                   for select to authenticated using (public.is_member());
create policy "members read" on public.statement_period         for select to authenticated using (public.is_member());
create policy "members read" on public.statement_value_raw      for select to authenticated using (public.is_member());
create policy "members read" on public.statement_value_override for select to authenticated using (public.is_member());
create policy "members read" on public.price_monthly            for select to authenticated using (public.is_member());
create policy "members read" on public.company_overview         for select to authenticated using (public.is_member());
create policy "members read" on public.quote_latest             for select to authenticated using (public.is_member());
create policy "members read" on public.api_payload              for select to authenticated using (public.is_member());
create policy "members read" on public.ingest_run               for select to authenticated using (public.is_member());

create policy "editors add tickers" on public.ticker
  for insert to authenticated with check (public.is_editor());
create policy "editors update tickers" on public.ticker
  for update to authenticated using (public.is_editor()) with check (public.is_editor());

create policy "editors add overrides" on public.statement_value_override
  for insert to authenticated with check (public.is_editor());
create policy "editors retire overrides" on public.statement_value_override
  for update to authenticated using (public.is_editor()) with check (public.is_editor());
