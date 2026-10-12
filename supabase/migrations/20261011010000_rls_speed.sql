-- =====================================================================
-- Speed: evaluate the membership check once per query, not once per row.
--
-- Every read policy calls public.is_member() (or auth.uid()). Written bare, Postgres runs
-- it for EACH row of EACH table a view touches: the screener reads thousands of statement
-- rows, so that is thousands of lookups. Wrapped as (select ...) Postgres runs it once and
-- reuses the answer (an "initPlan"). Same rule, same access, far fewer calls.
--
-- This changes only HOW the check is evaluated, never who can see what.
-- Safe to run more than once.
-- =====================================================================

-- Shared read policies, named "members read" on every table (core, statements, valuation...).
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public' and policyname = 'members read' and cmd = 'SELECT'
  loop
    execute format('alter policy %I on %I.%I using ((select public.is_member()))',
                   p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- The per-user tables: own rows only.
do $$
declare t text;
begin
  foreach t in array array['user_setting', 'user_multiple', 'user_ticker_category', 'user_group']
  loop
    execute format(
      'alter policy "own rows" on public.%I
         using (user_id = (select auth.uid()) and (select public.is_member()))
         with check (user_id = (select auth.uid()) and (select public.is_member()))', t);
  end loop;
end $$;

-- Check: every policy should now show the (select ...) form.
--   select tablename, policyname, qual from pg_policies
--    where schemaname = 'public' and qual like '%is_member%' and qual not like '%SELECT%';
-- (no rows = nothing left unwrapped)
