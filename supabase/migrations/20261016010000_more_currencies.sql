-- Four more reporting currencies, so these stocks stop showing blank USD values:
--   ARS (LOMA), BRL (GGB), DKK (NVO), KRW (PKX).
-- The ingest fetches monthly rates for every active row in `currency` (job "fx"), so adding the rows is
-- all it takes; the rates arrive on the next run (or a manual run with only = fx).
-- To see what is still missing at any time:  select * from public.currency_gaps;
-- Safe to run more than once.

insert into public.currency (currency)
values ('ARS'), ('BRL'), ('DKK'), ('KRW')
on conflict (currency) do nothing;

-- Check: the four should now be listed, and currency_gaps should come back empty.
-- select currency, is_active from public.currency order by currency;
-- select * from public.currency_gaps;
