-- =====================================================================
-- screener_components v2: what the Power BI Equity Summary needs that v1 lacked.
--
-- Adds, on both bases (fy = last full year, ttm = last four consecutive quarters):
--   * net income from continuing operations per share, so income value can use the LOWER of
--     net income and continuing-operations income, as the Power BI measure did
--   * revenue (USD, total, not per share)
-- and the statements' reporting currency.
--
-- Also makes the "custom balance" settings per user. How much of the balance sheet counts as value
-- is a personal choice (credit = share of an item counted as an asset: intangibles and goodwill
-- default 0, property/plant/equipment default 0.5). The shared defaults stay in valuation_param;
-- user_setting gets optional overrides (null = use the shared value), and this view now passes the
-- raw balance sheet parts per share so the app can apply each user's own credits.
--
-- Everything else is unchanged from 20261011000000_user_settings.sql: balance sheet from the
-- latest quarter, money converted to USD at the rate of its own period, missing stays null
-- (never 0), dividends default to 0. The view is dropped and recreated; nothing depends on it.
-- Safe to run more than once.
-- =====================================================================

alter table public.user_setting
  add column if not exists intangibles_credit numeric check (intangibles_credit between 0 and 1),
  add column if not exists ppe_credit         numeric check (ppe_credit between 0 and 1);

drop view if exists public.screener_components;

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
    i.symbol, i.year_month, i.fiscal_date_ending, i.fx_rate, i.net_income,
    i.net_income_from_continuing_operations as net_income_co,
    i.ebitda, i.total_revenue,
    row_number() over (partition by i.symbol order by i.fiscal_date_ending desc) as rn
  from public.income_statement i
  where i.period = 'quarterly' and i.net_income is not null
),
ttm as (
  select
    r.symbol,
    sum(r.fx_rate * r.net_income)                                          as net_income,
    -- a missing quarter makes the four-quarter total missing, never a smaller number
    case when count(r.net_income_co) = 4 then sum(r.fx_rate * r.net_income_co) end as net_income_co,
    case when count(r.ebitda)        = 4 then sum(r.fx_rate * r.ebitda)        end as ebitda,
    case when count(r.total_revenue) = 4 then sum(r.fx_rate * r.total_revenue) end as revenue,
    sum(r.fx_rate * coalesce(c.dividend_payout, 0))                        as dividends,
    max(r.fiscal_date_ending)                                              as through
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
  select distinct on (a.symbol)
    a.symbol, a.fiscal_date_ending, a.shares, a.net_income, a.ebitda, a.dividends,
    i.fx_rate * i.net_income_from_continuing_operations as net_income_co,
    i.fx_rate * i.total_revenue                         as revenue
  from public.valuation_annual a
  left join public.income_statement i
         on i.symbol = a.symbol and i.period = 'annual'
        and i.year_month = public.month_start(a.fiscal_date_ending)
  where a.net_income is not null
  order by a.symbol, a.fiscal_date_ending desc
),
base as (
  select
    bs.symbol,
    o.name, o.sector, o.industry, t.category,
    bs.currency,
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
    fy.net_income  as fy_net_income,  fy.net_income_co  as fy_net_income_co,
    fy.ebitda      as fy_ebitda,      fy.revenue        as fy_revenue,
    coalesce(fy.dividends, 0)                                      as fy_dividends,
    ttm.net_income as ttm_net_income, ttm.net_income_co as ttm_net_income_co,
    ttm.ebitda     as ttm_ebitda,     ttm.revenue       as ttm_revenue,
    ttm.dividends                                                  as ttm_dividends,
    ql.price, ql.latest_trading_day                                as price_date,
    bs.overridden_fields is not null                               as any_overridden,
    bs.fx_rate is null                                             as fx_missing,
    -- raw balance sheet parts in USD, so each user's own credits can be applied in the app
    bs.fx_rate * bs.total_assets                                   as total_assets,
    bs.fx_rate * bs.total_liabilities                              as total_liabilities,
    bs.fx_rate * (coalesce(bs.intangible_assets_excluding_goodwill, bs.intangible_assets, 0)
                  + coalesce(bs.goodwill, 0))                      as intangibles,
    bs.fx_rate * bs.property_plant_equipment                       as ppe
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
  any_overridden, fx_missing,
  -- new in v2
  currency,
  fy_net_income_co  / nullif(shares, 0)                   as fy_net_income_cont_per_share,
  ttm_net_income_co / nullif(shares, 0)                   as ttm_net_income_cont_per_share,
  fy_revenue,
  ttm_revenue,
  total_assets      / nullif(shares, 0)                   as total_assets_per_share,
  total_liabilities / nullif(shares, 0)                   as total_liabilities_per_share,
  intangibles       / nullif(shares, 0)                   as intangibles_per_share,
  ppe               / nullif(shares, 0)                   as ppe_per_share
from base;
