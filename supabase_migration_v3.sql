-- Phase 4 migration — run once in Supabase SQL Editor
-- https://supabase.com/dashboard/project/ntwfxljpgudfqgdyoblk/sql/new

-- ── matchmaking_queue ─────────────────────────────────────────────────────────
create table if not exists matchmaking_queue (
  id           uuid        default gen_random_uuid() primary key,
  player_uid   uuid        not null,
  player_name  text        not null default '',
  room_code    text        not null,             -- pre-generated PeerJS code
  status       text        not null default 'waiting',
  created_at   timestamptz default now()
);

alter table matchmaking_queue enable row level security;

-- Read all waiting entries (needed to find opponents)
create policy "Read waiting queue"
  on matchmaking_queue for select
  using (status = 'waiting' OR player_uid = auth.uid());

-- Own entry insert
create policy "Insert own queue entry"
  on matchmaking_queue for insert
  with check (player_uid = auth.uid());

-- Own entry update (e.g. marking as matched)
create policy "Update own queue entry"
  on matchmaking_queue for update
  using (player_uid = auth.uid());

-- Own entry delete (cleanup on timeout or disconnect)
create policy "Delete own queue entry"
  on matchmaking_queue for delete
  using (player_uid = auth.uid());

-- Cleanup function: removes stale entries older than 90 seconds
create or replace function cleanup_queue()
returns void language sql security definer as $$
  delete from matchmaking_queue where created_at < now() - interval '90 seconds';
$$;
