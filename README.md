# Wheel of Whimsy 🎡

A spin wheel that picks a date idea for you.

Live at: https://mattkrnr.github.io/dates/

## Features

- **Planning for:** choose today, tomorrow, Saturday, or any date. That day's forecast and sunset time drive the filters.
- **Filters:** weeknight/weekend, after sunset, season, budget ($ / $$ / $$$), energy (chill / medium / active), and distance from a ZIP (straight line).
- **Weather heads-up:** outdoor ideas get a badge when the planned day has a 50%+ chance of rain or snow, a high below 40°, or a high above 92°. Forecasts come from Open-Meteo and reach about 16 days out.
- **Our dates:** log the dates you went on, with a 1–5 star rating and notes. Ideas you did in the last 30 days sit out of the wheel for a while.
- **Phone app:** in Safari, tap Share → Add to Home Screen.

## Your own list

Each person or couple gets their own file in `lists/`. To add one:

1. Add an entry to `lists/lists.yaml`:
   ```yaml
   - id: sam
     name: Sam & Alex
     zip: "08540"
   ```
2. Create `lists/sam.yaml`. Copy `lists/matt.yaml` for the format.
3. Send them `https://mattkrnr.github.io/dates/?list=sam`

## Idea format

```yaml
- name: Ice skating at Mercer County Park
  address: 1638 Old Trenton Rd, West Windsor, NJ 08550   # or: home
  when: either          # weeknight | weekend | either
  daylight: false       # true = needs daylight
  season: winter        # any | winter | summer | spring | fall, or a list: [spring, summer]
  outdoor: true         # gets a weather heads-up
  budget: "$"           # "$" | "$$" | "$$$"
  energy: active        # chill | medium | active
  notes: optional
  link: https://optional.example
```

Addresses are turned into map coordinates with OpenStreetMap's free geocoder, and each browser caches the results. Add `lat:` and `lng:` to pin an idea exactly.

## Saving "Our dates"

History is saved to `history/<list id>.json` in this repo through the GitHub API. Each phone that logs dates needs a fine-grained GitHub token, entered once under ⚙️ Settings in the app:

- Repository access: **Only select repositories → dates**
- Permissions: **Contents → Read and write**

The token stays on that phone only. Anyone can view history without a token.

## Setup (one time)

Repo **Settings → Pages → Deploy from a branch → `main` / root**. No build step: it's plain HTML, CSS, and JS.
