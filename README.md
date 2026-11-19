# Wheel of Whimsy 🎡

A spin wheel that picks a date idea for you.

Live at: https://mattkrnr.github.io/dates/

## Features

- **Planning for:** choose today, tomorrow, Saturday, or any date. That day's forecast and sunset time drive the filters.
- **Filters:** weeknight/weekend, after sunset, season, budget ($ / $$ / $$$), energy (chill / medium / active), and distance from a ZIP (straight line).
- **Weather heads-up:** outdoor ideas get a badge when the planned day has a 50%+ chance of rain or snow, a high below 40°, or a high above 92°. Forecasts come from Open-Meteo and reach about 16 days out.
- **Our dates:** log the dates you went on, with a 1–5 star rating and notes. History is private to each list, behind a passcode. Ideas you did in the last 30 days sit out of the wheel for a while.
- **Phone app:** in Safari, tap Share → Add to Home Screen.

## Adding ideas

Tap **＋ Add a date idea** at the bottom of the app (or ✎ next to any idea to edit it). Search for a place and the address fills in, then tap chips for when, daylight, season, budget, energy and outdoors.

- **Anyone with the link can spin.** Adding, editing and deleting ideas needs the list's passcode, entered once per phone.
- **Deleted ideas** sit in "Recently deleted" (under "What's on the wheel") for 30 days and can be restored.
- Links: `https://mattkrnr.github.io/dates/?list=matt`, `?list=matt-allie`

Ideas live in Supabase (`whimsy_ideas`); they used to be YAML files in `lists/`, which are in this repo's history if ever needed.

**New list for a friend:** add a row to `whimsy_lists` and set its passcode (see `supabase/set-passcode.sql`). Ask Claude to do it.

## Saving "Our dates"

Ideas and date history are stored in Supabase (free tier), in the **Shared** project: the project for apps that you, your partner and friends use. Every table and function there is prefixed with its app's name (`whimsy_…`, `flashcards_…`). Each list is protected by its own passcode:

- The tables are locked down. The app's public key can only call the functions in `supabase/setup.sql`, and each one checks the list's passcode first.
- Passcodes are stored as salted hashes, never in plain text.
- Each phone enters the passcode once under ⚙️ Settings. Anyone with a list's passcode can see and log that list's dates.

**Setup**

1. Create a free project at supabase.com.
2. In SQL Editor, run `supabase/setup.sql`, then `supabase/ideas.sql`. (`supabase/migrate-to-shared-layout.sql` was a one-time upgrade for the project created before the prefixes.)
3. For each list, run `supabase/set-passcode.sql` with that list's id and a passcode you choose.
4. Put the Project URL and publishable key in `CONFIG` at the top of `app.js`.

## Setup (one time)

Repo **Settings → Pages → Deploy from a branch → `main` / root**. No build step: it's plain HTML, CSS, and JS.
