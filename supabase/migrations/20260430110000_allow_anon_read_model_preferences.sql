grant select on table public.v2_model_preferences to anon;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'v2_model_preferences'
      and policyname = 'Public users can read model preferences'
  ) then
    create policy "Public users can read model preferences"
      on public.v2_model_preferences
      for select
      to anon
      using (true);
  end if;
end $$;
