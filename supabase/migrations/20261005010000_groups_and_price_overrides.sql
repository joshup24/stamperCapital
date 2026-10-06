-- =====================================================================
-- Ticker groups (replaces equity-groups.xlsm) and price overrides
-- =====================================================================


-- ---------------------------------------------------------------------
-- Groups: SCAN, CONSIDERING, HOWARD, MYERS, PRECAST, ...
-- A ticker can be in several groups (e.g. ADM is in SCAN and CONSIDERING).
-- ---------------------------------------------------------------------
create table public.ticker_group (
  symbol             text not null references public.ticker(symbol) on delete cascade,
  group_name         text not null check (group_name = upper(group_name)),
  notes              text,
  valuation_multiple numeric,   -- "Multiple" column from equity-groups.xlsm
  added_at           timestamptz not null default now(),
  primary key (symbol, group_name)
);

create index ticker_group_group_idx on public.ticker_group (group_name);

alter table public.ticker_group enable row level security;

create policy "members read" on public.ticker_group
  for select to authenticated using (public.is_member());
create policy "editors add to groups" on public.ticker_group
  for insert to authenticated with check (public.is_editor());
create policy "editors update groups" on public.ticker_group
  for update to authenticated using (public.is_editor()) with check (public.is_editor());
create policy "editors remove from groups" on public.ticker_group
  for delete to authenticated using (public.is_editor());


-- ---------------------------------------------------------------------
-- Price overrides, e.g. spinoffs recorded as cash dividends
-- (MO: 22.57 in Apr 2007 for Kraft, 51.23 in Mar 2008 for PMI).
-- ---------------------------------------------------------------------
create table public.price_monthly_override (
  id                    bigint generated always as identity primary key,
  symbol                text not null references public.ticker(symbol) on delete cascade,
  month_end             date not null,
  field                 text not null check (field in
                          ('open', 'high', 'low', 'close', 'adjusted_close', 'volume', 'dividend_amount')),
  value                 numeric,
  raw_value_at_override numeric,
  reason                text not null,
  created_by            uuid default auth.uid() references auth.users(id),
  created_at            timestamptz not null default now(),
  retired_at            timestamptz,
  retired_by            uuid references auth.users(id)
);

create unique index price_monthly_override_active_uq
  on public.price_monthly_override (symbol, month_end, field)
  where retired_at is null;

alter table public.price_monthly_override enable row level security;

create policy "members read" on public.price_monthly_override
  for select to authenticated using (public.is_member());
create policy "editors add overrides" on public.price_monthly_override
  for insert to authenticated with check (public.is_editor());
create policy "editors retire overrides" on public.price_monthly_override
  for update to authenticated using (public.is_editor()) with check (public.is_editor());

create view public.price_monthly_effective
with (security_invoker = true) as
with o as (
  select
    symbol, month_end,
    bool_or(field = 'open')            as has_open,            max(value) filter (where field = 'open')            as open,
    bool_or(field = 'high')            as has_high,            max(value) filter (where field = 'high')            as high,
    bool_or(field = 'low')             as has_low,             max(value) filter (where field = 'low')             as low,
    bool_or(field = 'close')           as has_close,           max(value) filter (where field = 'close')           as close,
    bool_or(field = 'adjusted_close')  as has_adjusted_close,  max(value) filter (where field = 'adjusted_close')  as adjusted_close,
    bool_or(field = 'volume')          as has_volume,          max(value) filter (where field = 'volume')          as volume,
    bool_or(field = 'dividend_amount') as has_dividend_amount, max(value) filter (where field = 'dividend_amount') as dividend_amount
  from public.price_monthly_override
  where retired_at is null
  group by symbol, month_end
)
select
  p.symbol,
  p.month_end,
  case when o.has_open            then o.open            else p.open            end as open,
  case when o.has_high            then o.high            else p.high            end as high,
  case when o.has_low             then o.low             else p.low             end as low,
  case when o.has_close           then o.close           else p.close           end as close,
  case when o.has_adjusted_close  then o.adjusted_close  else p.adjusted_close  end as adjusted_close,
  case when o.has_volume          then o.volume::bigint  else p.volume          end as volume,
  case when o.has_dividend_amount then o.dividend_amount else p.dividend_amount end as dividend_amount,
  o.symbol is not null as is_overridden
from public.price_monthly p
left join o on o.symbol = p.symbol and o.month_end = p.month_end;
