-- One-time migration for the existing Shared project (formerly "WheelOfWhimsy"):
-- prefix Wheel of Whimsy's tables and functions with whimsy_, and add the Flashcards tables.

-- Wheel of Whimsy: rename tables and index
alter table if exists public.list_codes rename to whimsy_list_codes;
alter table if exists public.history    rename to whimsy_history;
alter index if exists public.history_list_date_idx rename to whimsy_history_list_date_idx;

-- Old unprefixed functions go away (replaced below)
drop function if exists public.check_code(text, text);
drop function if exists public.get_history(text, text);
drop function if exists public.add_history(text, text, text, date, int, text);
drop function if exists public.delete_history(text, text, uuid);
drop function if exists public._whimsy_code_ok(text, text);

-- Internal passcode check (not callable by the app).
create or replace function public._whimsy_code_ok(p_list text, p_code text)
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.whimsy_list_codes
    where list_id = p_list and code_hash = crypt(p_code, code_hash)
  );
$$;
revoke all on function public._whimsy_code_ok(text, text) from public, anon, authenticated;

-- App-facing functions. Each one checks the passcode first.
create or replace function public.whimsy_check_code(p_list text, p_code text)
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$ select public._whimsy_code_ok(p_list, p_code); $$;

create or replace function public.whimsy_get_history(p_list text, p_code text)
returns setof public.whimsy_history
language plpgsql stable security definer
set search_path = public, extensions
as $$
begin
  if not public._whimsy_code_ok(p_list, p_code) then
    raise exception 'wrong passcode' using errcode = '28P01';
  end if;
  return query
    select * from public.whimsy_history where list_id = p_list order by date desc, logged desc;
end;
$$;

create or replace function public.whimsy_add_history(
  p_list text, p_code text, p_idea text, p_date date, p_rating int, p_note text
)
returns public.whimsy_history
language plpgsql security definer
set search_path = public, extensions
as $$
declare r public.whimsy_history;
begin
  if not public._whimsy_code_ok(p_list, p_code) then
    raise exception 'wrong passcode' using errcode = '28P01';
  end if;
  insert into public.whimsy_history (list_id, idea, date, rating, note)
  values (p_list, left(p_idea, 200), p_date, p_rating, left(coalesce(p_note, ''), 2000))
  returning * into r;
  return r;
end;
$$;

create or replace function public.whimsy_delete_history(p_list text, p_code text, p_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._whimsy_code_ok(p_list, p_code) then
    raise exception 'wrong passcode' using errcode = '28P01';
  end if;
  delete from public.whimsy_history where id = p_id and list_id = p_list;
end;
$$;

revoke all on function public.whimsy_check_code(text, text) from public;
revoke all on function public.whimsy_get_history(text, text) from public;
revoke all on function public.whimsy_add_history(text, text, text, date, int, text) from public;
revoke all on function public.whimsy_delete_history(text, text, uuid) from public;
grant execute on function public.whimsy_check_code(text, text) to anon, authenticated;
grant execute on function public.whimsy_get_history(text, text) to anon, authenticated;
grant execute on function public.whimsy_add_history(text, text, text, date, int, text) to anon, authenticated;
grant execute on function public.whimsy_delete_history(text, text, uuid) to anon, authenticated;


-- =====================================================================
-- Flashcards (flashcards_*): each signed-in person sees only their own decks
-- =====================================================================
create table if not exists public.flashcards_decks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create index if not exists flashcards_decks_user on public.flashcards_decks (user_id);

create table if not exists public.flashcards_cards (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  deck_id       uuid not null references public.flashcards_decks(id) on delete cascade,
  front         text not null,
  back          text not null,
  ease          real not null default 2.5,
  interval_days integer not null default 0,
  reps          integer not null default 0,
  lapses        integer not null default 0,
  due           date not null default current_date,
  created_at    timestamptz not null default now()
);
create index if not exists flashcards_cards_deck on public.flashcards_cards (deck_id);
create index if not exists flashcards_cards_user_due on public.flashcards_cards (user_id, due);

alter table public.flashcards_decks enable row level security;
alter table public.flashcards_cards enable row level security;

drop policy if exists "own rows" on public.flashcards_decks;
create policy "own rows" on public.flashcards_decks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "own rows" on public.flashcards_cards;
create policy "own rows" on public.flashcards_cards for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
