# Spin for a Date 🎡

A spin wheel that picks a date idea for you, filtered by:

- **When**: weeknight or weekend
- **Light**: hide the ideas that need daylight once it's dark out
- **Season**: right now (automatic), winter, summer, or any
- **Distance**: within X miles of a ZIP code (straight-line distance, not drive time)

Live at: https://mattkrnr.github.io/dates/

## Your own list

Each person gets their own file in `lists/`. To add a friend:

1. Add them to `lists/lists.yaml`:
   ```yaml
   - id: sam
     name: Sam & Alex
     zip: "08540"
   ```
2. Create `lists/sam.yaml`. Copy `lists/matt.yaml` for the format.
3. Send them `https://mattkrnr.github.io/dates/?list=sam`

The **✏️ Add or edit ideas** link at the bottom of the app opens that list's file on GitHub. Friends need write access to the repo, or they can send a pull request.

## Idea format

```yaml
- name: Ice skating at Mercer County Park
  address: 1638 Old Trenton Rd, West Windsor, NJ 08550   # or: home
  when: either          # weeknight | weekend | either
  daylight: false       # true = needs daylight
  season: winter        # any | winter | summer | spring | fall, or a list: [spring, summer]
  notes: optional
  link: https://optional.example
```

Addresses are turned into map coordinates with OpenStreetMap's free geocoder, and each browser caches the results. If an address can't be found, the app falls back to the address's ZIP code. You can also add `lat:` and `lng:` to pin an idea exactly.

## Setup (one time)

Repo **Settings → Pages → Deploy from a branch → `main` / root**.

No build step: it's plain HTML, CSS, and JS.
