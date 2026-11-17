-- Set (or change) a list's passcode. Run in Supabase → SQL Editor.
-- Change the two values in quotes, run it, then do the same for each list.
-- Use something hard to guess, like 3 random words. Anyone with it can see and log that list's dates.

insert into public.list_codes (list_id, code_hash)
values ('matt', extensions.crypt('CHANGE-ME-to-your-passcode', extensions.gen_salt('bf')))
on conflict (list_id) do update set code_hash = excluded.code_hash;
