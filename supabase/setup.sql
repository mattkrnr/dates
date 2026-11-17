-- Wheel of Whimsy: date history storage.
-- Run this once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run.

create extension if not exists pgcrypto with schema extensions;

-- One row per list. Holds a salted hash of that list's passcode, never the passcode itself.
create table if not exists public.list_codes (
  list_id   text primary key,
  code_hash text not null
);

-- Logged dates.
create table if not exists public.history (
  id      uuid primary key default gen_random_uuid(),
  list_id text not null,
  idea    text not null,
  date    date not null,
  rating  smallint check (rating between 1 and 5),
  note    text not null default '',
  logged  timestamptz not null default now()
);
create index if not exists history_list_date_idx on public.history (list_id, date desc);

-- Lock the tables: row level security on, and no policies, so the app's public key
-- can't read or write them directly. All access goes through the functions below.
alter table public.list_codes enable row level security;
alter table public.history    enable row level security;
revoke all on public.list_codes, public.history from anon, authenticated;

-- Internal passcode check (not callable by the app).
create or replace function public._whimsy_code_ok(p_list text, p_code text)
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.list_codes
    where list_id = p_list and code_hash = crypt(p_code, code_hash)
  );
$$;
revoke all on function public._whimsy_code_ok(text, text) from public, anon, authenticated;

-- App-facing functions. Each one checks the passcode first.
create or replace function public.check_code(p_list text, p_code text)
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$ select public._whimsy_code_ok(p_list, p_code); $$;

create or replace function public.get_history(p_list text, p_code text)
returns setof public.history
language plpgsql stable security definer
set search_path = public, extensions
as $$
begin
  if not public._whimsy_code_ok(p_list, p_code) then
    raise exception 'wrong passcode' using errcode = '28P01';
  end if;
  return query
    select * from public.history where list_id = p_list order by date desc, logged desc;
end;
$$;

create or replace function public.add_history(
  p_list text, p_code text, p_idea text, p_date date, p_rating int, p_note text
)
returns public.history
language plpgsql security definer
set search_path = public, extensions
as $$
declare r public.history;
begin
  if not public._whimsy_code_ok(p_list, p_code) then
    raise exception 'wrong passcode' using errcode = '28P01';
  end if;
  insert into public.history (list_id, idea, date, rating, note)
  values (p_list, left(p_idea, 200), p_date, p_rating, left(coalesce(p_note, ''), 2000))
  returning * into r;
  return r;
end;
$$;

create or replace function public.delete_history(p_list text, p_code text, p_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._whimsy_code_ok(p_list, p_code) then
    raise exception 'wrong passcode' using errcode = '28P01';
  end if;
  delete from public.history where id = p_id and list_id = p_list;
end;
$$;

revoke all on function public.check_code(text, text) from public;
revoke all on function public.get_history(text, text) from public;
revoke all on function public.add_history(text, text, text, date, int, text) from public;
revoke all on function public.delete_history(text, text, uuid) from public;
grant execute on function public.check_code(text, text) to anon, authenticated;
grant execute on function public.get_history(text, text) to anon, authenticated;
grant execute on function public.add_history(text, text, text, date, int, text) to anon, authenticated;
grant execute on function public.delete_history(text, text, uuid) to anon, authenticated;
