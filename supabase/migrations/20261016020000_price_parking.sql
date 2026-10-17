-- Memory for the data loader: which stocks have no company data AND keep having their price requests
-- rejected, so the loader can stop retrying them every night (see ingest/rules.py, ingest/av_ingest.py).
--   price_fail_count   how many runs in a row the stock's prices failed (0 = fine)
--   price_parked_until the loader leaves its prices alone until this date, then tries once more
-- Written only by the loader (secret key). Safe to run more than once. The loader still works, as before,
-- if this has not been run: it just cannot park anything.
alter table public.ticker
  add column if not exists price_fail_count   smallint not null default 0,
  add column if not exists price_parked_until date;

-- Check: which stocks are being set aside right now (empty until the loader has parked one).
-- select symbol, price_fail_count, price_parked_until from public.ticker where price_fail_count > 0 order by symbol;
