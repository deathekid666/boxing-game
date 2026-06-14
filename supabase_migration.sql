-- Run this once in the Supabase SQL Editor
-- https://supabase.com/dashboard/project/ntwfxljpgudfqgdyoblk/sql

create table if not exists leaderboard (
  id           uuid        default gen_random_uuid() primary key,
  player_name  text        not null,
  won          boolean     not null,
  kos          integer     not null default 0,
  best_combo   integer     not null default 0,
  damage_dealt integer     not null default 0,
  opponent     text,
  created_at   timestamptz default now()
);

alter table leaderboard enable row level security;

-- Anyone can read the leaderboard
create policy "Public leaderboard read"
  on leaderboard for select
  using (true);

-- Anyone can submit a score (name must be non-empty, max 32 chars)
create policy "Anyone can submit scores"
  on leaderboard for insert
  with check (
    player_name is not null
    and length(trim(player_name)) > 0
    and length(player_name) <= 32
  );

-- Aggregated leaderboard: one row per player, sorted by wins then KOs
create or replace function get_leaderboard(lim integer default 20)
returns table (
  player_name  text,
  wins         bigint,
  losses       bigint,
  kos          bigint,
  best_combo   bigint
)
language sql
security definer
as $$
  select
    player_name,
    count(*) filter (where won)     as wins,
    count(*) filter (where not won) as losses,
    coalesce(sum(kos), 0)           as kos,
    coalesce(max(best_combo), 0)    as best_combo
  from leaderboard
  group by player_name
  order by wins desc, kos desc
  limit lim;
$$;
