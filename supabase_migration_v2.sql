-- Phase 2 migration — run once in Supabase SQL Editor
-- https://supabase.com/dashboard/project/ntwfxljpgudfqgdyoblk/sql/new
--
-- Creates: players, matches tables + RLS + get_leaderboard_v2 + get_player_stats RPCs

-- ── players ──────────────────────────────────────────────────────────────────
create table if not exists players (
  id           uuid        default gen_random_uuid() primary key,
  uid          uuid        unique not null,          -- Supabase auth uid
  display_name text        not null,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table players enable row level security;

create policy "Public players read"
  on players for select using (true);

create policy "Own player insert"
  on players for insert
  with check (uid = auth.uid());

create policy "Own player update"
  on players for update
  using (uid = auth.uid());

-- ── matches ──────────────────────────────────────────────────────────────────
create table if not exists matches (
  id            uuid        default gen_random_uuid() primary key,
  player_uid    uuid        not null,                -- Supabase auth uid
  player_name   text        not null,
  opponent_name text,
  won           boolean     not null,
  kos           integer     not null default 0,
  best_combo    integer     not null default 0,
  damage_dealt  integer     not null default 0,
  created_at    timestamptz default now()
);

alter table matches enable row level security;

create policy "Public matches read"
  on matches for select using (true);

create policy "Own match insert"
  on matches for insert
  with check (player_uid = auth.uid());

-- ── Aggregated leaderboard (v2 — reads from matches) ─────────────────────────
create or replace function get_leaderboard_v2(lim integer default 20)
returns table (
  player_name  text,
  wins         bigint,
  losses       bigint,
  kos          bigint,
  best_combo   bigint
)
language sql security definer as $$
  select
    player_name,
    count(*) filter (where won)     as wins,
    count(*) filter (where not won) as losses,
    coalesce(sum(kos), 0)           as kos,
    coalesce(max(best_combo), 0)    as best_combo
  from matches
  group by player_name
  order by wins desc, kos desc
  limit lim;
$$;

-- ── Per-device stats ──────────────────────────────────────────────────────────
create or replace function get_player_stats(p_uid uuid)
returns table (
  wins         bigint,
  losses       bigint,
  kos          bigint,
  best_combo   bigint,
  total_damage bigint
)
language sql security definer as $$
  select
    count(*) filter (where won)     as wins,
    count(*) filter (where not won) as losses,
    coalesce(sum(kos), 0)           as kos,
    coalesce(max(best_combo), 0)    as best_combo,
    coalesce(sum(damage_dealt), 0)  as total_damage
  from matches
  where player_uid = p_uid;
$$;
