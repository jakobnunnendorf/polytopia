-- Public, read-only copy of what the arena server on the Mac serves (scripts/arena-server.ts),
-- so the hosted web game (polytopia.expo.app) can show rankings and the game list.
-- Only scripts/supabase-sync.ts writes, with the secret key (service_role, bypasses RLS).
-- Every row carries synced_at; a sync run deletes the rows it did not send.

create table public.ratings (
  key text primary key,                -- "model:<id>" or "human:<profileId>"
  rating double precision not null,
  games integer not null,
  wins integer not null,
  lo double precision,                 -- 95% bootstrap interval
  hi double precision,
  source text,                         -- 'tournament' when it comes from elo/<date>/
  updated timestamptz not null,
  synced_at timestamptz not null default now()
);

create table public.models (
  id text primary key,
  spec jsonb not null,                 -- models/<id>/model.json as served by /api/models
  synced_at timestamptz not null default now()
);

create table public.profiles (
  id text primary key,
  name text not null,
  created timestamptz not null,
  synced_at timestamptz not null default now()
);

create table public.games (
  id text primary key,
  source text not null check (source in ('play', 'arena')),
  started_at timestamptz not null,
  ended_at timestamptz,
  map_size integer not null,
  mode text not null,
  seats jsonb not null,
  turn integer not null,
  steps integer not null,
  over boolean not null,
  winner integer,
  scores integer[],
  synced_at timestamptz not null default now()
);
create index games_started_at_idx on public.games (started_at desc);

-- Access: visitors (anon) and signed-in users may read; nobody but service_role writes.
do $$
declare t text;
begin
  foreach t in array array['ratings', 'models', 'profiles', 'games'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('create policy "%s are public to read" on public.%I for select to anon, authenticated using (true)', t, t);
  end loop;
end $$;
