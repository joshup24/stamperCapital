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
-- Checked against the report for MO: FY2019, FY2022 and FY2023 value of assets
-- match to the dollar; FY2023 income and dividend values match to 2 decimals.
-- Not floored at zero: a company whose liabilities exceed its tangible assets
-- (like MO) gets a negative asset value, same as the report.
--
-- GAAP net income throughout (never adjusted EPS). EBITDA, operating cash flow
-- and free cash flow are reference columns only; they do not feed the value.
--
-- Differences from the old Power BI model, on purpose:
--   * Missing data stays missing. The old model turned "None" into 0, which can
--     make a company look far better than it is (missing liabilities = 0).
--     Here only goodwill, PP&E and dividends default to 0 when absent.
--   * Everything is in USD (see currency migration).
--   * Values come from the corrected (effective) statements.
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

alter table public.valuation_param enable row level security;
create policy "members read" on public.valuation_param
  for select to authenticated using (public.is_member());
create policy "editors update" on public.valuation_param
  for update to authenticated using (public.is_editor()) with check (public.is_editor());


-- ---------------------------------------------------------------------
-- Multiples. Precedence for a ticker:
--   1. its own override   (ticker.multiple_override)
--   2. an industry rule   (e.g. AEROSPACE & DEFENSE -> 13)
--   3. a sector rule      (e.g. FINANCE -> 12)
--   4. the global default (valuation_param.default_multiple)
-- Rule names are Alpha Vantage's own sector / industry spellings (upper case),
-- see industry_catalog below. The old equity-groups "Multiple" column was 11 on
-- every row, so it is not used: everyone gets the default until a rule says otherwise.
-- ---------------------------------------------------------------------
alter table public.ticker
  add column multiple_override numeric check (multiple_override > 0);

create table public.multiple_rule (
  kind     text not null check (kind in ('sector', 'industry')),
  name     text not null check (name = upper(name)),
  multiple numeric not null check (multiple > 0),
  notes    text,
  primary key (kind, name)
);

alter table public.multiple_rule enable row level security;
create policy "members read" on public.multiple_rule
  for select to authenticated using (public.is_member());
create policy "editors manage rules" on public.multiple_rule
  for all to authenticated using (public.is_editor()) with check (public.is_editor());

create view public.ticker_multiple
with (security_invoker = true) as
select
  t.symbol,
  coalesce(t.multiple_override, ir.multiple, sr.multiple, p.default_multiple) as multiple,
  case
    when t.multiple_override is not null then 'ticker'
    when ir.multiple is not null         then 'industry'
    when sr.multiple is not null         then 'sector'
    else 'default'
  end as multiple_source
from public.ticker t
cross join public.valuation_param p
left join public.company_overview o on o.symbol = t.symbol
left join public.multiple_rule ir on ir.kind = 'industry' and ir.name = upper(o.industry)
left join public.multiple_rule sr on sr.kind = 'sector'   and sr.name = upper(o.sector);

-- Every sector / industry in the data with its current multiple: the list to
-- pick from when deciding which categories to favor.
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
-- Shares = balance-sheet commonStockSharesOutstanding for now. The report's own
-- share count is derived differently; once that is confirmed, correct it by
-- overriding commonStockSharesOutstanding or changing the line marked SHARES.
-- ---------------------------------------------------------------------
create view public.valuation_annual
with (security_invoker = true) as
with inputs as (
  select
    symbol, fiscal_date_ending,
    max(value_usd) filter (where statement = 'balance'  and field = 'totalAssets')                       as total_assets,
    max(value_usd) filter (where statement = 'balance'  and field = 'totalLiabilities')                  as total_liabilities,
    max(value_usd) filter (where statement = 'balance'  and field = 'intangibleAssetsExcludingGoodwill') as intangibles_ex_goodwill,
    max(value_usd) filter (where statement = 'balance'  and field = 'intangibleAssets')                  as intangibles_raw,
    max(value_usd) filter (where statement = 'balance'  and field = 'goodwill')                          as goodwill,
    max(value_usd) filter (where statement = 'balance'  and field = 'propertyPlantEquipment')            as ppe,
    max(value_usd) filter (where statement = 'balance'  and field = 'commonStockSharesOutstanding')      as shares, -- SHARES
    max(value_usd) filter (where statement = 'income'   and field = 'netIncome')                         as net_income,
    max(value_usd) filter (where statement = 'income'   and field = 'ebitda')                            as ebitda,
    max(value_usd) filter (where statement = 'cashflow' and field = 'dividendPayout')                    as dividends,
    max(value_usd) filter (where statement = 'cashflow' and field = 'operatingCashflow')                 as operating_cashflow,
    max(value_usd) filter (where statement = 'cashflow' and field = 'capitalExpenditures')               as capex,
    bool_or(is_overridden)                                                                               as any_overridden,
    bool_or(fx_missing)                                                                                  as fx_missing
  from public.statement_value_effective_usd
  where period = 'annual'
    and (   (statement = 'balance'  and field in ('totalAssets', 'totalLiabilities', 'intangibleAssetsExcludingGoodwill',
                                                  'intangibleAssets', 'goodwill', 'propertyPlantEquipment',
                                                  'commonStockSharesOutstanding'))
         or (statement = 'income'   and field in ('netIncome', 'ebitda'))
         or (statement = 'cashflow' and field in ('dividendPayout', 'operatingCashflow', 'capitalExpenditures')))
  group by symbol, fiscal_date_ending
),
calc as (
  select
    i.*,
    -- AV sometimes folds goodwill into intangibleAssets and sometimes not. Taking the
    -- ex-goodwill figure when given and adding goodwill avoids counting it twice.
    coalesce(i.intangibles_ex_goodwill, i.intangibles_raw, 0) + coalesce(i.goodwill, 0) as intangibles,
    m.multiple
  from inputs i
  join public.ticker_multiple m using (symbol)
),
vals as (
  select
    c.*,
    public.assets_value(c.total_assets, c.intangibles, c.ppe, c.total_liabilities) as assets_value,
    nullif(c.shares, 0)                                                            as sh
  from calc c
)
select
  symbol, fiscal_date_ending, multiple, shares,
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
with q as (
  select
    symbol, fiscal_date_ending,
    max(value_usd) filter (where statement = 'balance'  and field = 'totalAssets')                       as total_assets,
    max(value_usd) filter (where statement = 'balance'  and field = 'totalLiabilities')                  as total_liabilities,
    max(value_usd) filter (where statement = 'balance'  and field = 'intangibleAssetsExcludingGoodwill') as intangibles_ex_goodwill,
    max(value_usd) filter (where statement = 'balance'  and field = 'intangibleAssets')                  as intangibles_raw,
    max(value_usd) filter (where statement = 'balance'  and field = 'goodwill')                          as goodwill,
    max(value_usd) filter (where statement = 'balance'  and field = 'propertyPlantEquipment')            as ppe,
    max(value_usd) filter (where statement = 'balance'  and field = 'commonStockSharesOutstanding')      as shares, -- SHARES
    max(value_usd) filter (where statement = 'income'   and field = 'netIncome')                         as net_income,
    max(value_usd) filter (where statement = 'cashflow' and field = 'dividendPayout')                    as dividends,
    bool_or(is_overridden)                                                                               as any_overridden,
    bool_or(fx_missing)                                                                                  as fx_missing
  from public.statement_value_effective_usd
  where period = 'quarterly'
    and (   (statement = 'balance'  and field in ('totalAssets', 'totalLiabilities', 'intangibleAssetsExcludingGoodwill',
                                                  'intangibleAssets', 'goodwill', 'propertyPlantEquipment',
                                                  'commonStockSharesOutstanding'))
         or (statement = 'income'   and field = 'netIncome')
         or (statement = 'cashflow' and field = 'dividendPayout'))
  group by symbol, fiscal_date_ending
),
bs as (
  select distinct on (symbol) *
  from q
  where total_assets is not null and total_liabilities is not null
  order by symbol, fiscal_date_ending desc
),
ranked as (
  select q.*, row_number() over (partition by symbol order by fiscal_date_ending desc) as rn
  from q
  where net_income is not null
),
ttm as (
  select
    symbol,
    sum(net_income)                as net_income,
    sum(coalesce(dividends, 0))    as dividends,
    max(fiscal_date_ending)        as through
  from ranked
  where rn <= 4
  group by symbol
  -- four quarter-ends span about 273 days; anything else means a missing quarter
  having count(*) = 4 and max(fiscal_date_ending) - min(fiscal_date_ending) between 260 and 290
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
    bs.fiscal_date_ending                                                      as balance_sheet_date,
    fy.fiscal_date_ending                                                      as fiscal_year_end,
    ttm.through                                                                as ttm_through,
    coalesce(bs.shares, fy.shares)                                             as shares,
    public.assets_value(
      bs.total_assets,
      coalesce(bs.intangibles_ex_goodwill, bs.intangibles_raw, 0) + coalesce(bs.goodwill, 0),
      bs.ppe, bs.total_liabilities)                                            as assets_value,
    fy.net_income                                                              as fy_net_income,
    coalesce(fy.dividends, 0)                                                  as fy_dividends,
    ttm.net_income                                                             as ttm_net_income,
    ttm.dividends                                                              as ttm_dividends,
    ql.price,
    ql.latest_trading_day                                                      as price_date,
    bs.any_overridden,
    bs.fx_missing
  from bs
  join public.ticker_multiple m on m.symbol = bs.symbol
  left join fy  on fy.symbol  = bs.symbol
  left join ttm on ttm.symbol = bs.symbol
  left join public.quote_latest ql on ql.symbol = bs.symbol
)
select
  b.symbol, b.multiple, b.multiple_source,
  b.balance_sheet_date, b.fiscal_year_end, b.ttm_through,
  current_date - b.balance_sheet_date                                          as balance_sheet_age_days,
  b.shares,
  b.assets_value / nullif(b.shares, 0)                                         as assets_value_per_share,
  (b.multiple * b.fy_net_income  + b.multiple * b.fy_dividends  + b.assets_value) / nullif(b.shares, 0) as value_per_share_fy,
  (b.multiple * b.ttm_net_income + b.multiple * b.ttm_dividends + b.assets_value) / nullif(b.shares, 0) as value_per_share_ttm,
  b.price,
  b.price_date,
  (b.multiple * b.fy_net_income  + b.multiple * b.fy_dividends  + b.assets_value) / nullif(b.shares, 0) / nullif(b.price, 0) - 1 as possible_gain_fy,
  (b.multiple * b.ttm_net_income + b.multiple * b.ttm_dividends + b.assets_value) / nullif(b.shares, 0) / nullif(b.price, 0) - 1 as possible_gain_ttm,
  b.any_overridden,
  b.fx_missing
from base b;
