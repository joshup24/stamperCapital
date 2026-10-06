-- =====================================================================
-- Valuation model (ported from the Power BI report, "Valuation" page)
--
--   value / share = multiple x net income / share
--                 + multiple x dividends / share
--                 + value of assets / share
--
--   value of assets = total assets
--                     - intangibles incl. goodwill   (no credit: tax-benefit "assets")
--                     - 50% of PP&E                  (not a liquidation value)
--                     - total liabilities
--
-- Checked against the report for MO: FY2019, FY2022 and FY2023 value of assets match to
-- the dollar; FY2023 income and dividend values match to 2 decimals. Not floored at zero:
-- a company whose liabilities exceed its tangible assets (like MO) gets a negative asset
-- value, same as the report.
--
-- GAAP net income throughout, never adjusted EPS. EBITDA, operating cash flow and free
-- cash flow are reference columns only; they do not feed the value.
--
-- Shares = balance sheet commonStockSharesOutstanding for the same period, which is what
-- the report's _cShares column does.
--
-- Differences from the old Power BI model, on purpose:
--   * Missing data stays missing. The old model turned "None" into 0, which can make a
--     company look far better than it is (missing liabilities = 0). Here only goodwill,
--     PP&E and dividends default to 0 when absent.
--   * Everything is converted to USD at the rate of its own period.
--   * Values include your corrections.
-- =====================================================================

-- One row of global defaults. credit = share of that asset counted as value.
create table public.valuation_param (
  id                 boolean primary key default true check (id),
  default_multiple   numeric not null default 11  check (default_multiple > 0),
  intangibles_credit numeric not null default 0   check (intangibles_credit between 0 and 1),
  ppe_credit         numeric not null default 0.5 check (ppe_credit between 0 and 1),
  updated_at         timestamptz not null default now()
);
insert into public.valuation_param default values;


-- ---------------------------------------------------------------------
-- Multiples. Precedence for a ticker:
--   1. its own override   (ticker.multiple_override)
--   2. a category rule    (ticker.category, your own buckets: DEFENSE, INSURANCE, AUTO...)
--   3. an industry rule   (Alpha Vantage industry, e.g. AEROSPACE & DEFENSE)
--   4. a sector rule      (Alpha Vantage sector, e.g. FINANCE)
--   5. the global default (valuation_param.default_multiple)
-- Industry and sector names are Alpha Vantage's own spellings in upper case; see
-- industry_catalog for the list. Everything is on the default until a rule says otherwise.
-- ---------------------------------------------------------------------
create table public.multiple_rule (
  kind     text not null check (kind in ('category', 'industry', 'sector')),
  name     text not null check (name = upper(name)),
  multiple numeric not null check (multiple > 0),
  notes    text,
  primary key (kind, name)
);

create view public.ticker_multiple
with (security_invoker = true) as
select
  t.symbol,
  coalesce(t.multiple_override, cr.multiple, ir.multiple, sr.multiple, p.default_multiple) as multiple,
  case
    when t.multiple_override is not null then 'ticker'
    when cr.multiple is not null         then 'category'
    when ir.multiple is not null         then 'industry'
    when sr.multiple is not null         then 'sector'
    else 'default'
  end as multiple_source
from public.ticker t
cross join public.valuation_param p
left join public.company_overview o on o.symbol = t.symbol
left join public.multiple_rule cr on cr.kind = 'category' and cr.name = t.category
left join public.multiple_rule ir on ir.kind = 'industry' and ir.name = upper(o.industry)
left join public.multiple_rule sr on sr.kind = 'sector'   and sr.name = upper(o.sector);

-- Every sector / industry in the data with its current multiple: the list to pick from
-- when deciding which categories to favor.
create view public.industry_catalog
with (security_invoker = true) as
select
  o.sector,
  o.industry,
  count(*)                                              as symbols,
  min(m.multiple)                                       as multiple_min,
  max(m.multiple)                                       as multiple_max,
  count(*) filter (where m.multiple_source = 'default') as on_default
from public.company_overview o
join public.ticker_multiple m on m.symbol = o.symbol
group by o.sector, o.industry;


-- Value of assets, with the credit settings from valuation_param.
-- `intangibles` must already include goodwill.
create function public.assets_value(
  total_assets numeric, intangibles numeric, ppe numeric, total_liabilities numeric
) returns numeric
language sql stable as $$
  select total_assets
       - (1 - p.intangibles_credit) * coalesce(intangibles, 0)
       - (1 - p.ppe_credit)         * coalesce(ppe, 0)
       - total_liabilities
  from public.valuation_param p
$$;


-- ---------------------------------------------------------------------
-- By fiscal year: one row per symbol and year (the report's Valuation page).
-- AV sometimes folds goodwill into intangible_assets and sometimes not; taking the
-- ex-goodwill figure when given and adding goodwill avoids counting it twice.
-- ---------------------------------------------------------------------
create view public.valuation_annual
with (security_invoker = true) as
with joined as (
  select
    b.symbol, b.fiscal_date_ending,
    m.multiple, m.multiple_source,
    b.fx_rate is null                                                              as fx_missing,
    b.common_stock_shares_outstanding                                              as shares,
    b.fx_rate * b.total_assets                                                     as total_assets,
    b.fx_rate * b.total_liabilities                                                as total_liabilities,
    b.fx_rate * (coalesce(b.intangible_assets_excluding_goodwill, b.intangible_assets, 0)
                 + coalesce(b.goodwill, 0))                                        as intangibles,
    b.fx_rate * b.property_plant_equipment                                         as ppe,
    i.fx_rate * i.net_income                                                       as net_income,
    i.fx_rate * i.ebitda                                                           as ebitda,
    c.fx_rate * c.dividend_payout                                                  as dividends,
    c.fx_rate * c.operating_cashflow                                               as operating_cashflow,
    c.fx_rate * c.capital_expenditures                                             as capex,
    b.overridden_fields is not null
      or i.overridden_fields is not null
      or c.overridden_fields is not null                                           as any_overridden
  from public.balance_sheet b
  join public.ticker_multiple m on m.symbol = b.symbol
  left join public.income_statement i
         on i.symbol = b.symbol and i.period = 'annual' and i.year_month = b.year_month
  left join public.cash_flow c
         on c.symbol = b.symbol and c.period = 'annual' and c.year_month = b.year_month
  where b.period = 'annual'
),
vals as (
  select
    j.*,
    public.assets_value(j.total_assets, j.intangibles, j.ppe, j.total_liabilities) as assets_value,
    nullif(j.shares, 0)                                                            as sh
  from joined j
)
select
  symbol, fiscal_date_ending, multiple, multiple_source, shares,
  total_assets, total_liabilities, intangibles, ppe, net_income, dividends,
  assets_value,
  assets_value / sh                                                               as assets_value_per_share,
  multiple * net_income / sh                                                      as income_value_per_share,
  multiple * coalesce(dividends, 0) / sh                                          as dividend_value_per_share,
  (multiple * net_income + multiple * coalesce(dividends, 0) + assets_value) / sh as value_per_share,
  -- reference only
  ebitda,
  multiple * ebitda / sh                                                          as ebitda_value_per_share,
  operating_cashflow,
  operating_cashflow - coalesce(capex, 0)                                         as free_cash_flow,
  (operating_cashflow - coalesce(capex, 0)) / sh                                  as free_cash_flow_per_share,
  any_overridden,
  fx_missing
from vals;


-- ---------------------------------------------------------------------
-- Screener row: one per symbol, latest data.
--   balance sheet : latest reported quarter (and its share count)
--   income + dividends, on two bases side by side:
--     fy  = last full fiscal year                      (the report's current method)
--     ttm = last four reported quarters, which needs 4 consecutive quarters
-- Projections from quarter-by-quarter history can build on ttm later.
-- Price is the latest quote, assumed to be in USD.
-- ---------------------------------------------------------------------
create view public.valuation_latest
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
    i.symbol, i.year_month, i.fiscal_date_ending, i.fx_rate, i.net_income,
    row_number() over (partition by i.symbol order by i.fiscal_date_ending desc) as rn
  from public.income_statement i
  where i.period = 'quarterly' and i.net_income is not null
),
ttm as (
  select
    r.symbol,
    sum(r.fx_rate * r.net_income)                         as net_income,
    sum(r.fx_rate * coalesce(c.dividend_payout, 0))       as dividends,
    max(r.fiscal_date_ending)                             as through
  from ranked r
  left join public.cash_flow c
         on c.symbol = r.symbol and c.period = 'quarterly' and c.year_month = r.year_month
  where r.rn <= 4
  group by r.symbol
  -- four quarter-ends span about 273 days; anything else means a missing quarter.
  -- A missing FX rate would silently shrink the sum, so that disqualifies it too.
  having count(*) = 4
     and max(r.fiscal_date_ending) - min(r.fiscal_date_ending) between 260 and 290
     and bool_and(r.fx_rate is not null)
),
fy as (
  select distinct on (symbol) symbol, fiscal_date_ending, shares, net_income, dividends
  from public.valuation_annual
  where net_income is not null
  order by symbol, fiscal_date_ending desc
),
base as (
  select
    bs.symbol,
    m.multiple,
    m.multiple_source,
    bs.fiscal_date_ending                                                       as balance_sheet_date,
    fy.fiscal_date_ending                                                       as fiscal_year_end,
    ttm.through                                                                 as ttm_through,
    coalesce(bs.common_stock_shares_outstanding, fy.shares)                     as shares,
    public.assets_value(
      bs.fx_rate * bs.total_assets,
      bs.fx_rate * (coalesce(bs.intangible_assets_excluding_goodwill, bs.intangible_assets, 0)
                    + coalesce(bs.goodwill, 0)),
      bs.fx_rate * bs.property_plant_equipment,
      bs.fx_rate * bs.total_liabilities)                                        as assets_value,
    fy.net_income                                                               as fy_net_income,
    coalesce(fy.dividends, 0)                                                   as fy_dividends,
    ttm.net_income                                                              as ttm_net_income,
    ttm.dividends                                                               as ttm_dividends,
    ql.price,
    ql.latest_trading_day                                                       as price_date,
    bs.overridden_fields is not null                                            as any_overridden,
    bs.fx_rate is null                                                          as fx_missing
  from bs
  join public.ticker_multiple m on m.symbol = bs.symbol
  left join fy  on fy.symbol  = bs.symbol
  left join ttm on ttm.symbol = bs.symbol
  left join public.quote_latest ql on ql.symbol = bs.symbol
)
select
  b.symbol, b.multiple, b.multiple_source,
  b.balance_sheet_date, b.fiscal_year_end, b.ttm_through,
  current_date - b.balance_sheet_date                                           as balance_sheet_age_days,
  b.shares,
  b.assets_value / nullif(b.shares, 0)                                          as assets_value_per_share,
  (b.multiple * b.fy_net_income  + b.multiple * b.fy_dividends  + b.assets_value) / nullif(b.shares, 0) as value_per_share_fy,
  (b.multiple * b.ttm_net_income + b.multiple * b.ttm_dividends + b.assets_value) / nullif(b.shares, 0) as value_per_share_ttm,
  b.price,
  b.price_date,
  (b.multiple * b.fy_net_income  + b.multiple * b.fy_dividends  + b.assets_value) / nullif(b.shares, 0) / nullif(b.price, 0) - 1 as possible_gain_fy,
  (b.multiple * b.ttm_net_income + b.multiple * b.ttm_dividends + b.assets_value) / nullif(b.shares, 0) / nullif(b.price, 0) - 1 as possible_gain_ttm,
  b.any_overridden,
  b.fx_missing
from base b;


-- ---------------------------------------------------------------------
-- Row level security: members read; editors adjust settings and rules.
-- ---------------------------------------------------------------------
alter table public.valuation_param enable row level security;
alter table public.multiple_rule   enable row level security;

create policy "members read" on public.valuation_param
  for select to authenticated using (public.is_member());
create policy "editors update" on public.valuation_param
  for update to authenticated using (public.is_editor()) with check (public.is_editor());

create policy "members read" on public.multiple_rule
  for select to authenticated using (public.is_member());
create policy "editors manage rules" on public.multiple_rule
  for all to authenticated using (public.is_editor()) with check (public.is_editor());
