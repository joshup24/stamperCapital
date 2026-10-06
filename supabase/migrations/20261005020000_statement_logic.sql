-- =====================================================================
-- Statement logic on top of the generated raw tables:
--   currency + FX rates, corrections (overrides), a log of Alpha Vantage
--   changing its own numbers, and the views the app reads.
--
--   income_statement, balance_sheet, cash_flow, earnings
--     = raw values with your corrections applied, plus the currency and the
--       USD rate for that period. Multiply by fx_rate to get USD; share counts
--       and surprise % are not money, so never multiply those.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Currency
-- ---------------------------------------------------------------------
create table public.currency (
  currency  text primary key check (currency = upper(currency) and length(currency) = 3),
  is_active boolean not null default true
);

-- Same seven as the old sheet. The ingest job fetches rates for every active row, so
-- adding a currency here is all it takes to support a new one.
insert into public.currency (currency)
values ('USD'), ('CAD'), ('MXN'), ('GBP'), ('CHF'), ('ILS'), ('EUR');

-- rate = USD per 1 unit of currency (CAD 0.74 means 1 CAD = 0.74 USD), as in the old sheet.
-- Monthly closes, so history converts at the rate of its own month.
create table public.fx_rate_monthly (
  currency   text not null references public.currency(currency),
  month      date not null check (month = public.month_start(month)),
  rate       numeric not null check (rate > 0),
  fetched_at timestamptz not null default now(),
  primary key (currency, month)
);

-- The currency a symbol reports in: its latest income statement, else the currency it
-- trades in, else USD. Covers earnings rows (no currency from Alpha Vantage) and the
-- ~3% of tickers where Alpha Vantage sends the text "None".
create view public.symbol_currency
with (security_invoker = true) as
select
  t.symbol,
  coalesce(
    (select i.reported_currency
       from public.income_statement_raw i
      where i.symbol = t.symbol and i.reported_currency is not null
      order by i.fiscal_date_ending desc
      limit 1),
    o.currency,
    'USD'
  ) as currency
from public.ticker t
left join public.company_overview o on o.symbol = t.symbol;

-- Currencies in use that are not set up in `currency`: their fx_rate is null until added.
create view public.currency_gaps
with (security_invoker = true) as
select c.currency, count(*) as symbols
from public.symbol_currency c
where c.currency not in (select currency from public.currency)
group by c.currency;


-- ---------------------------------------------------------------------
-- Corrections. Never written by the ingest job, so they survive every refresh.
-- `field` is the column name (e.g. total_revenue). Rows are retired, never deleted.
-- ---------------------------------------------------------------------
create table public.statement_override (
  id                    bigint generated always as identity primary key,
  symbol                text not null references public.ticker(symbol) on delete cascade,
  statement             text not null check (statement in ('income', 'balance', 'cashflow', 'earnings')),
  period                text not null check (period in ('annual', 'quarterly')),
  fiscal_date_ending    date not null,
  year_month            date generated always as (public.month_start(fiscal_date_ending)) stored,
  field                 text not null,
  value                 numeric,   -- null = treat as missing
  raw_value_at_override numeric,   -- filled in automatically: what Alpha Vantage said right now
  reason                text not null,
  created_by            uuid default auth.uid() references auth.users(id),
  created_at            timestamptz not null default now(),
  retired_at            timestamptz,
  retired_by            uuid references auth.users(id)
);

create unique index statement_override_active_uq
  on public.statement_override (symbol, statement, period, year_month, field)
  where retired_at is null;

-- Rejects a field name that does not exist (it would silently do nothing) and records
-- what Alpha Vantage's number was at the time of the correction.
create function public.prepare_statement_override() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tbl text;
begin
  tbl := case new.statement
    when 'income'   then 'income_statement_raw'
    when 'balance'  then 'balance_sheet_raw'
    when 'cashflow' then 'cash_flow_raw'
    else 'earnings_raw'
  end;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = tbl
                    and column_name = new.field and data_type = 'numeric') then
    raise exception 'unknown numeric field "%" for % statements', new.field, new.statement;
  end if;

  execute format('select %I from public.%I where symbol = $1 and period = $2 and year_month = $3',
                 new.field, tbl)
     into new.raw_value_at_override
    using new.symbol, new.period, public.month_start(new.fiscal_date_ending);
  return new;
end $$;

create trigger statement_override_prepare
  before insert on public.statement_override
  for each row execute function public.prepare_statement_override();

-- Active corrections next to what Alpha Vantage says today. raw_changed_since_override
-- means Alpha Vantage revised the number after you corrected it: worth a second look.
create view public.override_review
with (security_invoker = true) as
select
  o.id, o.symbol, o.statement, o.period, o.fiscal_date_ending, o.field,
  o.value                 as override_value,
  o.raw_value_at_override,
  cur.raw_now             as raw_value_now,
  cur.raw_now is distinct from o.raw_value_at_override as raw_changed_since_override,
  o.reason, o.created_by, o.created_at
from public.statement_override o
left join lateral (
  select (x.j ->> o.field)::numeric as raw_now
  from (
    select to_jsonb(r) as j from public.income_statement_raw r
     where o.statement = 'income'   and r.symbol = o.symbol and r.period = o.period and r.year_month = o.year_month
    union all
    select to_jsonb(r) from public.balance_sheet_raw r
     where o.statement = 'balance'  and r.symbol = o.symbol and r.period = o.period and r.year_month = o.year_month
    union all
    select to_jsonb(r) from public.cash_flow_raw r
     where o.statement = 'cashflow' and r.symbol = o.symbol and r.period = o.period and r.year_month = o.year_month
    union all
    select to_jsonb(r) from public.earnings_raw r
     where o.statement = 'earnings' and r.symbol = o.symbol and r.period = o.period and r.year_month = o.year_month
  ) x
  limit 1
) cur on true
where o.retired_at is null;


-- ---------------------------------------------------------------------
-- Revision log: whenever a refresh changes a number Alpha Vantage sent before
-- (restated revenue, revised share counts...), the old and new values are kept.
-- ---------------------------------------------------------------------
create table public.statement_revision (
  id                 bigint generated always as identity primary key,
  symbol             text not null,
  statement          text not null,
  period             text not null,
  fiscal_date_ending date not null,
  field              text not null,
  old_value          text,
  new_value          text,
  changed_at         timestamptz not null default now()
);
create index statement_revision_symbol_idx on public.statement_revision (symbol, changed_at desc);

create function public.log_statement_revision() returns trigger
language plpgsql as $$
declare
  o jsonb := to_jsonb(old) - 'fetched_at' - 'extra';
  n jsonb := to_jsonb(new) - 'fetched_at' - 'extra';
  e record;
begin
  for e in select key, value from jsonb_each(n) where o -> key is distinct from value loop
    insert into public.statement_revision
      (symbol, statement, period, fiscal_date_ending, field, old_value, new_value)
    values
      (new.symbol, tg_argv[0], new.period, new.fiscal_date_ending, e.key, o ->> e.key, n ->> e.key);
  end loop;
  return new;
end $$;

create trigger income_statement_revision after update on public.income_statement_raw
  for each row execute function public.log_statement_revision('income');
create trigger balance_sheet_revision after update on public.balance_sheet_raw
  for each row execute function public.log_statement_revision('balance');
create trigger cash_flow_revision after update on public.cash_flow_raw
  for each row execute function public.log_statement_revision('cashflow');
create trigger earnings_revision after update on public.earnings_raw
  for each row execute function public.log_statement_revision('earnings');


-- ---------------------------------------------------------------------
-- The views the app reads: raw + corrections, built from the real column lists so a
-- new column added later only needs this block rerun (drop the views first).
-- ---------------------------------------------------------------------
do $$
declare
  t    record;
  cols text;
begin
  for t in
    select * from (values
      ('income',   'income_statement_raw', 'income_statement', 'r.reported_currency',
                   'coalesce(r.reported_currency, sc.currency)'),
      ('balance',  'balance_sheet_raw',    'balance_sheet',    'r.reported_currency',
                   'coalesce(r.reported_currency, sc.currency)'),
      ('cashflow', 'cash_flow_raw',        'cash_flow',        'r.reported_currency',
                   'coalesce(r.reported_currency, sc.currency)'),
      ('earnings', 'earnings_raw',         'earnings',         'r.reported_date, r.report_time',
                   'sc.currency')
    ) as v(stmt, raw, eff, text_cols, currency_expr)
  loop
    select string_agg(
             format('case when ov.j ? %1$L then (ov.j ->> %1$L)::numeric else r.%1$I end as %1$I', a.attname),
             E',\n  ' order by a.attnum)
      into cols
      from pg_attribute a
     where a.attrelid = ('public.' || t.raw)::regclass
       and a.attnum > 0
       and not a.attisdropped
       and a.atttypid = 'numeric'::regtype;

    execute format($v$
      create view public.%1$I with (security_invoker = true) as
      with ov as (
        select symbol, period, year_month,
               jsonb_object_agg(field, value)   as j,
               array_agg(field order by field)  as fields
          from public.statement_override
         where statement = %2$L and retired_at is null
         group by symbol, period, year_month
      )
      select
        r.symbol, r.period, r.fiscal_date_ending, r.year_month,
        %3$s,
        %4$s as currency,
        case when %4$s = 'USD' then 1::numeric
             else (select f.rate from public.fx_rate_monthly f
                    where f.currency = %4$s and f.month = r.year_month)
        end as fx_rate,
        %5$s,
        ov.fields as overridden_fields,
        r.fetched_at
      from public.%6$I r
      join public.symbol_currency sc on sc.symbol = r.symbol
      left join ov on ov.symbol = r.symbol and ov.period = r.period and ov.year_month = r.year_month
    $v$, t.eff, t.stmt, t.text_cols, t.currency_expr, cols, t.raw);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'income_statement_raw', 'balance_sheet_raw', 'cash_flow_raw', 'earnings_raw',
    'statement_override', 'statement_revision', 'currency', 'fx_rate_monthly'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member())', t);
  end loop;
end $$;

create policy "editors add overrides" on public.statement_override
  for insert to authenticated with check (public.is_editor());
create policy "editors retire overrides" on public.statement_override
  for update to authenticated using (public.is_editor()) with check (public.is_editor());

create policy "editors manage currencies" on public.currency
  for all to authenticated using (public.is_editor()) with check (public.is_editor());
