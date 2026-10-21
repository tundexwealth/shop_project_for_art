-- Shared signed-in cart for the Artini web and native mobile apps.
create table if not exists public.user_carts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  updated_at timestamptz not null default now()
);

alter table public.user_carts enable row level security;
grant select on public.user_carts to authenticated;

drop policy if exists "Users can view their own cart" on public.user_carts;
create policy "Users can view their own cart"
  on public.user_carts for select to authenticated
  using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_carts'
  ) then
    alter publication supabase_realtime add table public.user_carts;
  end if;
end $$;
