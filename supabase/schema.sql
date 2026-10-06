create extension if not exists pgcrypto;

create table if not exists public.products (
  id text primary key, name text not null, category text not null, description text not null default '',
  price integer not null check (price > 0), image_url text, kind text not null default 'artwork' check (kind in ('artwork','workshop')),
  featured boolean not null default false, active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(), customer_id uuid references auth.users(id) on delete set null,
  customer_name text not null, customer_email text not null, customer_phone text not null, delivery_address text not null,
  status text not null default 'pending' check (status in ('pending','confirmed','in_progress','shipped','completed','cancelled')),
  total integer not null check (total > 0), currency text not null default 'NGN', created_at timestamptz not null default now()
);
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  product_id text not null references public.products(id), product_name text not null,
  unit_price integer not null check (unit_price > 0), quantity integer not null check (quantity between 1 and 20)
);
create table if not exists public.workshop_inquiries (
  id uuid primary key default gen_random_uuid(), customer_name text not null, customer_email text not null,
  customer_phone text not null, organization text, guest_count integer not null check (guest_count between 1 and 500),
  preferred_date date, workshop_type text not null check (workshop_type in ('company','open-studio','private-group')),
  notes text not null default '', status text not null default 'new' check (status in ('new','contacted','booked','closed')),
  created_at timestamptz not null default now()
);
create table if not exists public.custom_inquiries (
  id uuid primary key default gen_random_uuid(), customer_name text not null, customer_email text not null,
  customer_phone text not null, project_type text not null check (project_type in ('personal','brand','space')),
  organization text, needed_by date, details text not null,
  status text not null default 'new' check (status in ('new','contacted','quoted','accepted','closed')),
  created_at timestamptz not null default now()
);
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.workshop_inquiries enable row level security;
alter table public.custom_inquiries enable row level security;
drop policy if exists "Anyone can view active products" on public.products;
create policy "Anyone can view active products" on public.products for select using (active = true);
-- Customer records are written from server routes with the service-role key only.

insert into public.products (id,name,category,description,price,image_url,kind,featured) values
('sunrise','First Light','THE SUN SERIES','Warmth, caught in a thousand threads.',68000,'/art-sun.svg','artwork',true),
('flower','Wildflower No. 02','BOTANICAL STUDIES','A little reminder to keep growing.',54000,'/art-flower.svg','artwork',false),
('shore','Somewhere by the Sea','LANDSCAPE STUDIES','Blue skies and room to breathe.',76000,'/art-sea.svg','artwork',false)
on conflict (id) do update set name=excluded.name,category=excluded.category,description=excluded.description,price=excluded.price,image_url=excluded.image_url,kind=excluded.kind,featured=excluded.featured;
