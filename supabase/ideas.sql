-- Wheel of Whimsy: lists and date ideas.
-- Anyone with a list's link can read its ideas (to spin). Adding, editing, deleting and
-- restoring ideas needs that list's passcode (whimsy_list_codes, see setup.sql).
-- Run in the Shared project after setup.sql. Safe to re-run.

-- ---------- tables ----------
create table if not exists public.whimsy_lists (
  id   text primary key check (id ~ '^[a-z0-9-]{1,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  zip  text check (zip is null or zip ~ '^\d{5}$'),
  sort int  not null default 0
);

create table if not exists public.whimsy_ideas (
  id         uuid primary key default gen_random_uuid(),
  list_id    text not null references public.whimsy_lists(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  address    text not null default 'home' check (char_length(address) between 1 and 300),
  day_type   text not null default 'either' check (day_type in ('weeknight', 'weekend', 'either')),
  daylight   boolean not null default false,
  outdoor    boolean not null default false,
  seasons    text[] check (seasons <@ array['winter', 'spring', 'summer', 'fall']), -- null = all year
  budget     smallint check (budget between 1 and 3),
  energy     text check (energy in ('chill', 'medium', 'active')),
  notes      text not null default '' check (char_length(notes) <= 1000),
  link       text check (link is null or (link ~* '^https?://' and char_length(link) <= 500)),
  lat        double precision check (lat between -90 and 90),
  lng        double precision check (lng between -180 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists whimsy_ideas_list_live on public.whimsy_ideas (list_id) where deleted_at is null;

-- Locked: the app's public key reaches these only through the functions below.
alter table public.whimsy_lists enable row level security;
alter table public.whimsy_ideas enable row level security;
revoke all on public.whimsy_lists, public.whimsy_ideas from anon, authenticated;

-- ---------- public reads (no passcode) ----------
create or replace function public.whimsy_get_lists()
returns table (id text, name text, zip text)
language sql stable security definer
set search_path = public
as $$ select l.id, l.name, l.zip from public.whimsy_lists l order by l.sort, l.name; $$;

create or replace function public.whimsy_get_ideas(p_list text)
returns setof public.whimsy_ideas
language sql stable security definer
set search_path = public
as $$
  select * from public.whimsy_ideas
  where list_id = p_list and deleted_at is null
  order by created_at, name;
$$;

-- ---------- passcode-gated changes ----------
-- Shared by save: turns the app's JSON into clean column values.
create or replace function public._whimsy_seasons(p jsonb)
returns text[]
language sql immutable
set search_path = public
as $$
  select case
    when jsonb_typeof(p) <> 'array' then null
    when (select count(distinct s) from jsonb_array_elements_text(p) s
          where s in ('winter','spring','summer','fall')) in (0, 4) then null
    else (select array_agg(distinct s order by s) from jsonb_array_elements_text(p) s
          where s in ('winter','spring','summer','fall'))
  end;
$$;
revoke all on function public._whimsy_seasons(jsonb) from public, anon, authenticated;

-- Insert when p_idea has no "id", otherwise update that idea.
create or replace function public.whimsy_save_idea(p_list text, p_code text, p_idea jsonb)
returns public.whimsy_ideas
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  r   public.whimsy_ideas;
  v_id uuid := nullif(p_idea->>'id', '')::uuid;
  v_link text := nullif(btrim(coalesce(p_idea->>'link', '')), '');
begin
  if not public._whimsy_code_ok(p_list, p_code) then
    raise exception 'wrong passcode' using errcode = '28P01';
  end if;
  if v_id is null then
    insert into public.whimsy_ideas
      (list_id, name, address, day_type, daylight, outdoor, seasons, budget, energy, notes, link, lat, lng)
    values (
      p_list,
      btrim(p_idea->>'name'),
      coalesce(nullif(btrim(p_idea->>'address'), ''), 'home'),
      coalesce(p_idea->>'day_type', 'either'),
      coalesce((p_idea->>'daylight')::boolean, false),
      coalesce((p_idea->>'outdoor')::boolean, false),
      public._whimsy_seasons(p_idea->'seasons'),
      nullif(p_idea->>'budget', '')::smallint,
      nullif(p_idea->>'energy', ''),
      btrim(coalesce(p_idea->>'notes', '')),
      v_link,
      nullif(p_idea->>'lat', '')::double precision,
      nullif(p_idea->>'lng', '')::double precision
    )
    returning * into r;
  else
    -- Renaming an idea keeps its logged dates attached to it.
    update public.whimsy_history h set idea = btrim(p_idea->>'name')
    from public.whimsy_ideas i
    where i.id = v_id and i.list_id = p_list and h.list_id = p_list and h.idea = i.name
      and i.name <> btrim(p_idea->>'name');

    update public.whimsy_ideas set
      name     = btrim(p_idea->>'name'),
      address  = coalesce(nullif(btrim(p_idea->>'address'), ''), 'home'),
      day_type = coalesce(p_idea->>'day_type', 'either'),
      daylight = coalesce((p_idea->>'daylight')::boolean, false),
      outdoor  = coalesce((p_idea->>'outdoor')::boolean, false),
      seasons  = public._whimsy_seasons(p_idea->'seasons'),
      budget   = nullif(p_idea->>'budget', '')::smallint,
      energy   = nullif(p_idea->>'energy', ''),
      notes    = btrim(coalesce(p_idea->>'notes', '')),
      link     = v_link,
      lat      = nullif(p_idea->>'lat', '')::double precision,
      lng      = nullif(p_idea->>'lng', '')::double precision,
      updated_at = now()
    where id = v_id and list_id = p_list and deleted_at is null
    returning * into r;
    if r.id is null then
      raise exception 'idea not found' using errcode = 'P0002';
    end if;
  end if;
  return r;
end;
$$;

-- Soft delete: the idea goes to "Recently deleted" for 30 days.
create or replace function public.whimsy_delete_idea(p_list text, p_code text, p_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._whimsy_code_ok(p_list, p_code) then
    raise exception 'wrong passcode' using errcode = '28P01';
  end if;
  update public.whimsy_ideas set deleted_at = now()
  where id = p_id and list_id = p_list and deleted_at is null;
  -- tidy up anything deleted more than 30 days ago
  delete from public.whimsy_ideas where deleted_at < now() - interval '30 days';
end;
$$;

create or replace function public.whimsy_get_deleted_ideas(p_list text, p_code text)
returns setof public.whimsy_ideas
language plpgsql stable security definer
set search_path = public, extensions
as $$
begin
  if not public._whimsy_code_ok(p_list, p_code) then
    raise exception 'wrong passcode' using errcode = '28P01';
  end if;
  return query
    select * from public.whimsy_ideas
    where list_id = p_list and deleted_at > now() - interval '30 days'
    order by deleted_at desc;
end;
$$;

create or replace function public.whimsy_restore_idea(p_list text, p_code text, p_id uuid)
returns public.whimsy_ideas
language plpgsql security definer
set search_path = public, extensions
as $$
declare r public.whimsy_ideas;
begin
  if not public._whimsy_code_ok(p_list, p_code) then
    raise exception 'wrong passcode' using errcode = '28P01';
  end if;
  update public.whimsy_ideas set deleted_at = null, updated_at = now()
  where id = p_id and list_id = p_list and deleted_at is not null
  returning * into r;
  return r;
end;
$$;

-- ---------- who can call what ----------
revoke all on function public.whimsy_get_lists() from public;
revoke all on function public.whimsy_get_ideas(text) from public;
revoke all on function public.whimsy_save_idea(text, text, jsonb) from public;
revoke all on function public.whimsy_delete_idea(text, text, uuid) from public;
revoke all on function public.whimsy_get_deleted_ideas(text, text) from public;
revoke all on function public.whimsy_restore_idea(text, text, uuid) from public;
grant execute on function public.whimsy_get_lists() to anon, authenticated;
grant execute on function public.whimsy_get_ideas(text) to anon, authenticated;
grant execute on function public.whimsy_save_idea(text, text, jsonb) to anon, authenticated;
grant execute on function public.whimsy_delete_idea(text, text, uuid) to anon, authenticated;
grant execute on function public.whimsy_get_deleted_ideas(text, text) to anon, authenticated;
grant execute on function public.whimsy_restore_idea(text, text, uuid) to anon, authenticated;
