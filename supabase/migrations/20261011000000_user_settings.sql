-- =====================================================================
-- Per-user settings and the screener building blocks.
--
-- Until now multiples and groups were one shared set (multiple_rule, ticker_group,
-- ticker.category / multiple_override), changeable by editors only. The web app lets
-- every member keep their OWN multiples, categories and groups, so these tables are
-- private to each user. The shared ones stay as the starting point / fallback.
--
-- Precedence the app applies for a user (mirrors ticker_multiple):
--   1. user ticker multiple   user_multiple  kind = 'ticker'
--   2. user category multiple user_multiple  kind = 'category'  (category = user_ticker_category,
--                                                                else the shared ticker.category)
--   3. user industry multiple kind = 'industry'
--   4. user sector multiple   kind = 'sector'
--   5. the user's default     user_setting.default_multiple
-- If a user has set nothing, the app falls back to the shared multiple_rule values.
-- =====================================================================

create table public.user_setting (
  user_id          uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  default_multiple numeric not null default 11 check (default_multiple > 0),
  updated_at       timestamptz not null default now()
);

create table public.user_multiple (
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind     text not null check (kind in ('ticker', 'category', 'industry', 'sector')),
  name     text not null check (name = upper(name)),   -- symbol, category, industry or sector
  multiple numeric not null check (multiple > 0),
  notes    text,
  primary key (user_id, kind, name)
);

-- The user's own category for a ticker (their buckets: DEFENSE, INSURANCE, AUTO...).
create table public.user_ticker_category (
  user_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol   text not null references public.ticker(symbol) on delete cascade,
  category text not null check (category = upper(category)),
  primary key (user_id, symbol)
);

-- The user's own groups (the app's "equity groups"). A ticker can be in several.
create table public.user_group (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  group_name text not null check (group_name = upper(group_name)),
  symbol     text not null references public.ticker(symbol) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (user_id, group_name, symbol)
);
create index user_group_symbol_idx on public.user_group (symbol);


-- ---------------------------------------------------------------------
-- Screener building blocks: one row per symbol, per share, with NO multiple applied.
-- The app multiplies by each user's own multiple:
--   value = multiple x net_income_ps + multiple x dividends_ps + assets_ps
--
-- Same data rules as valuation_latest (and kept in step with it): balance sheet from the
-- latest quarter, income and dividends on two bases (fy = last full year, ttm = last four
-- consecutive quarters), everything in USD at the rate of its own period, missing data
-- stays null. Dividends default to 0 when absent. EBITDA is added here (reference value
-- the screener can test). To check: with the shared multiple, the app's value must equal
-- valuation_latest.value_per_share_fy / _ttm.
-- ---------------------------------------------------------------------
create view public.screener_components
with (security_invoker = true) as
with bs as (
  select distinct on (b.symbol) b.*
  from public.balance_sheet b
  where b.period = 'quarterly'
    and b.total_assets is not null
    and b.total_liabilities is not null
  order by b.symbol, b.fiscal_date_ending desc
),
ranked as (
  select
    i.symbol, i.year_month, i.fiscal_date_ending, i.fx_rate, i.net_income, i.ebitda,
    row_number() over (partition by i.symbol order by i.fiscal_date_ending desc) as rn
  from public.income_statement i
  where i.period = 'quarterly' and i.net_income is not null
),
ttm as (
  select
    r.symbol,
    sum(r.fx_rate * r.net_income)                    as net_income,
    case when count(r.ebitda) = 4 then sum(r.fx_rate * r.ebitda) end as ebitda,
    sum(r.fx_rate * coalesce(c.dividend_payout, 0))  as dividends,
    max(r.fiscal_date_ending)                        as through
  from ranked r
  left join public.cash_flow c
         on c.symbol = r.symbol and c.period = 'quarterly' and c.year_month = r.year_month
  where r.rn <= 4
  group by r.symbol
  having count(*) = 4
     and max(r.fiscal_date_ending) - min(r.fiscal_date_ending) between 260 and 290
     and bool_and(r.fx_rate is not null)
),
fy as (
  select distinct on (symbol) symbol, fiscal_date_ending, shares, net_income, ebitda, dividends
  from public.valuation_annual
  where net_income is not null
  order by symbol, fiscal_date_ending desc
),
base as (
  select
    bs.symbol,
    o.name, o.sector, o.industry, t.category,
    bs.fiscal_date_ending                                          as balance_sheet_date,
    fy.fiscal_date_ending                                          as fiscal_year_end,
    ttm.through                                                    as ttm_through,
    coalesce(bs.common_stock_shares_outstanding, fy.shares)        as shares,
    public.assets_value(
      bs.fx_rate * bs.total_assets,
      bs.fx_rate * (coalesce(bs.intangible_assets_excluding_goodwill, bs.intangible_assets, 0)
                    + coalesce(bs.goodwill, 0)),
      bs.fx_rate * bs.property_plant_equipment,
      bs.fx_rate * bs.total_liabilities)                           as assets_value,
    fy.net_income  as fy_net_income,  fy.ebitda  as fy_ebitda,  coalesce(fy.dividends, 0)  as fy_dividends,
    ttm.net_income as ttm_net_income, ttm.ebitda as ttm_ebitda, ttm.dividends              as ttm_dividends,
    ql.price, ql.latest_trading_day                                as price_date,
    bs.overridden_fields is not null                               as any_overridden,
    bs.fx_rate is null                                             as fx_missing
  from bs
  join public.ticker t on t.symbol = bs.symbol
  left join public.company_overview o on o.symbol = bs.symbol
  left join fy  on fy.symbol  = bs.symbol
  left join ttm on ttm.symbol = bs.symbol
  left join public.quote_latest ql on ql.symbol = bs.symbol
)
select
  symbol, name, sector, industry, category,
  balance_sheet_date, fiscal_year_end, ttm_through,
  current_date - balance_sheet_date                       as balance_sheet_age_days,
  shares, price, price_date,
  assets_value / nullif(shares, 0)                        as assets_per_share,
  fy_net_income   / nullif(shares, 0)                     as fy_net_income_per_share,
  fy_ebitda       / nullif(shares, 0)                     as fy_ebitda_per_share,
  fy_dividends    / nullif(shares, 0)                     as fy_dividends_per_share,
  ttm_net_income  / nullif(shares, 0)                     as ttm_net_income_per_share,
  ttm_ebitda      / nullif(shares, 0)                     as ttm_ebitda_per_share,
  ttm_dividends   / nullif(shares, 0)                     as ttm_dividends_per_share,
  any_overridden, fx_missing
from base;


-- ---------------------------------------------------------------------
-- Row level security: every member sees and changes only their own rows.
-- ---------------------------------------------------------------------
alter table public.user_setting         enable row level security;
alter table public.user_multiple        enable row level security;
alter table public.user_ticker_category enable row level security;
alter table public.user_group           enable row level security;

do $$
declare t text;
begin
  foreach t in array array['user_setting', 'user_multiple', 'user_ticker_category', 'user_group']
  loop
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = auth.uid() and public.is_member())
         with check (user_id = auth.uid() and public.is_member())', t);
  end loop;
end $$;
