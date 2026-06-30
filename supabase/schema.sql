-- ClickDemo schema — idempotent, re-runnable

-- Enable extension for uuid generation (already available in Supabase)
create extension if not exists "pgcrypto";

-- updated_at trigger function
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- demos
create table if not exists demos (
  id           uuid primary key default gen_random_uuid(),
  title        text not null default 'Untitled demo',
  public_slug  text not null unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists demos_updated_at on demos;
create trigger demos_updated_at
  before update on demos
  for each row execute function set_updated_at();

-- screens
create table if not exists screens (
  id           uuid primary key default gen_random_uuid(),
  demo_id      uuid not null references demos(id) on delete cascade,
  name         text not null default 'Untitled screen',
  image_path   text not null,
  width        int,
  height       int,
  order_index  int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists screens_demo_order on screens(demo_id, order_index);

-- hotspots
create table if not exists hotspots (
  id             uuid primary key default gen_random_uuid(),
  screen_id      uuid not null references screens(id) on delete cascade,
  x              real not null,
  y              real not null,
  w              real not null,
  h              real not null,
  action         text not null default 'navigate' check (action in ('navigate', 'tooltip')),
  target_screen  uuid references screens(id) on delete set null,
  tooltip_text   text,
  created_at     timestamptz not null default now(),
  constraint hotspot_coords check (
    x >= 0 and x <= 1 and
    y >= 0 and y <= 1 and
    w > 0 and w <= 1 and
    h > 0 and h <= 1 and
    x + w <= 1.0001 and
    y + h <= 1.0001
  )
);

create index if not exists hotspots_screen on hotspots(screen_id);

-- Storage bucket (run this in Supabase dashboard or via API if needed)
-- The bucket must be created manually in Supabase Storage as "screenshots" with public access.
-- RLS: enabled; no public policies needed (service role bypasses RLS).
alter table demos enable row level security;
alter table screens enable row level security;
alter table hotspots enable row level security;
