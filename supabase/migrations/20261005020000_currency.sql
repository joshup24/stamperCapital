-- =====================================================================
-- Currency conversion (replaces 11_Currency Table.xlsm)
-- Statements arrive in the company's reporting currency; prices are in USD.
-- statement_value_effective_usd puts everything on the same footing.
-- =====================================================================

create table public.currency (
  currency  text primary key check (currency = upper(currency) and length(currency) = 3),
  is_active boolean not null default true
);

-- Same seven currencies as the old sheet. The ingest job fetches rates for every
-- active row, so adding a currency here is all it takes to support a new one.
insert into public.currency (currency)
values ('USD'), ('CAD'), ('MXN'), ('GBP'), ('CHF'), ('ILS'), ('EUR');

-- rate = USD per 1 unit of currency (CAD 0.74 means 1 CAD = 0.74 USD), same as the old sheet.
-- Monthly closes from Alpha Vantage FX_MONTHLY, so history converts at the rate of its own period.
create table public.fx_rate_monthly (
  currency   text not null references public.currency(currency),
  month_end  date not null,
  rate       numeric not null check (rate > 0),
  fetched_at timestamptz not null default now(),
  primary key (currency, month_end)
);

alter table public.currency        enable row level security;
alter table public.fx_rate_monthly enable row level security;

create policy "members read" on public.currency
  for select to authenticated using (public.is_member());
create policy "members read" on public.fx_rate_monthly
  for select to authenticated using (public.is_member());
create policy "editors manage currencies" on public.currency
  for all to authenticated using (public.is_editor()) with check (public.is_editor());


-- ---------------------------------------------------------------------
-- Statement values in USD.
--   * Fields that are not money (share counts, surprise %) are never converted.
--   * Earnings rows carry no currency from Alpha Vantage, so they inherit the
--     symbol's latest income-statement currency.
--   * Rate = the fiscal period's own month. fx_missing flags gaps instead of
--     silently treating a foreign amount as dollars.
-- ---------------------------------------------------------------------
create view public.statement_value_effective_usd
with (security_invoker = true) as
with symbol_currency as (
  select distinct on (symbol) symbol, reported_currency
  from public.statement_period
  where statement = 'income' and reported_currency is not null
  order by symbol, fiscal_date_ending desc
),
base as (
  select
    e.*,
    -- period's own currency, else the symbol's latest income-statement currency
    -- (earnings rows, and the ~3% of tickers where AV sends "None"), else the
    -- currency it trades in, else USD
    coalesce(p.reported_currency, sc.reported_currency, ov.currency, 'USD') as reported_currency,
    e.field not in ('commonStockSharesOutstanding', 'surprisePercentage') as is_monetary
  from public.statement_value_effective e
  left join public.statement_period p
    using (symbol, statement, period, fiscal_date_ending)
  left join symbol_currency sc on sc.symbol = e.symbol
  left join public.company_overview ov on ov.symbol = e.symbol
)
select
  b.symbol, b.statement, b.period, b.fiscal_date_ending, b.field,
  b.reported_currency,
  fx.rate as fx_rate,
  case
    when not b.is_monetary or b.reported_currency = 'USD' then b.value
    else b.value * fx.rate
  end as value_usd,
  b.value as value_reported,
  b.is_overridden,
  b.raw_changed_since_override,
  (b.is_monetary and b.reported_currency <> 'USD' and fx.rate is null) as fx_missing
from base b
left join lateral (
  select f.rate
  from public.fx_rate_monthly f
  where f.currency = b.reported_currency
    and date_trunc('month', f.month_end) = date_trunc('month', b.fiscal_date_ending)
  limit 1
) fx on true;


-- Currencies seen in the data but not set up in `currency`: their rows show
-- fx_missing and a null value_usd until the currency is added.
create view public.currency_gaps
with (security_invoker = true) as
select reported_currency as currency, count(distinct symbol) as symbols
from public.statement_period
where reported_currency is not null
  and reported_currency not in (select currency from public.currency)
group by reported_currency;
