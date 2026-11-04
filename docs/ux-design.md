# Waythread UX Design

This document describes the UX of the Waythread prototype in [`prototype/`](../prototype), the reasoning behind it, and what was left out on purpose. The app in [`app/web`](../app/web) has the same trip screen, on real data. It builds on the [proposal](proposal.md).

## Principles

The proposal set three principles. This is how each one shows up in the design:

| Principle | In practice |
| --- | --- |
| **Less is more** | Show information only when it is essential, isn't shown elsewhere on screen, and can't be inferred at a glance. Each element earns its place. |
| **The route and the plan are the focus** | The map fills the screen and the plan sits on top of it. The most prominent things are the stops and the routes between them, not controls. |
| **Co-editing is the default** | Every trip is shared. Everyone on it can edit, there are no roles, and the people on a trip are one tap away, in trip settings. |

One more rule came out of the iterations: **don't rebuild what Google Maps and Apple Maps already do.** Waythread plans the trip and hands off to the phone's maps app for navigation.

## Screens

### Home

- The app name, then one card per trip showing its **name** and **date range**, then a **New trip** button.
- The cards leave out stop counts, "next stop", and avatars. You can see those after opening a trip, and they don't help you pick one.

### Trip

The trip is a single screen: a full-screen **map** with the **stop list** in a sheet over it. There are no List/Map tabs.

```
┌──────────────────────────────┐
│ (⌂)                      (⚙) │  ← home, trip settings
│        map: pins + routes    │  ← what's over is grey
├──────────────────────────────┤  ← drag handle
│ ‹       Today, Nov 21 ⌄    › │  ← day bar: step, or tap the day
│ (🛏) Holiday Inn              │  ← last night's hotel
│  ⊖   10 min drive          ◇ │  ← car on the rail · Directions
│ (🏛) Museum of Space   9:30 AM│  ← marker · stop · time
│  ⊖   34 min drive          ◇ │  ← highlighted: you're on it now
│ (🍴) Cloudcroft       12:30 PM│
│      Lunch                   │
│  ⊖   35 min drive          ◇ │
│ (🛏) Holiday Inn              │  ← tonight's hotel
│ [████████ + Add stop ███████]│  ← black, pinned to bottom
└──────────────────────────────┘
```

**Two floating buttons** sit over the map: **home** (back to the trip list) on the left and **trip settings** on the right. The trip name, its people and sharing used to be a header row that took space from the plan without helping to plan it. They're in trip settings now.

**The sheet** is white and has three heights: the day bar only, half the screen (the default), and nearly full. Drag the top of the sheet to resize it. Tap its top edge to pull it down to the day bar. When it's pulled down, any tap on what's left of it opens it back to half. The map zooms to fit the day's stops above the sheet.

**On a computer or tablet** (768px wide and up), the sheet becomes a side panel: the plan down the left, about a third of the window (360–440px), and the map filling the rest. There's nothing to drag, and nothing floats over the map: home, the trip's name and settings sit at the top of the panel, above the day bar. Opening a stop, a day list or settings covers the panel, so the map stays in view beside it, with the stop being edited in the middle.

```
┌─────────────────────┬──────────────────────────────────┐
│ ⌂  White Sands, NM ⚙│                                  │
│ ‹   Today, Nov 21 ⌄ ›│                                  │
│ (🛏) Holiday Inn     │        map: pins + routes        │
│  ⊖  10 min drive   ◇│                                  │
│ (🏛) Museum   9:30 AM│                                  │
│  …                  │                                  │
│ [██ + Add stop ████]│                                  │
└─────────────────────┴──────────────────────────────────┘
```

**One day at a time.** The list and the map show a single day. A whole trip on one page was too much to take in, and a day is the unit you plan and travel by.
- **The day bar** tops the sheet, so it stays visible when the sheet is pulled down. It shows the day (`Fri, Nov 20`, or `Today, Nov 21` on a trip day, so today is easy to find again) between **‹** and **›** buttons that step to the previous and next day.
- **Picking a day:** tap the day to open a list of every day of the trip, each with the type icons of its stops and of the hotel you sleep at, so you can see what a day holds before you jump to it. On a computer, ← → also step through days.
- There's no swipe between days: the arrows and the day list replace it.
- **Which day opens:** today on a trip day, otherwise the first day. Saving a stop switches to that stop's day. If a day loses its last stop, the list moves to the next day.
- **Each day starts and ends at the hotel** (see [Hotel stays](#hotel-stays)). With no hotel the night before, the day starts from the day before's last stop: the list opens with that stop, and it's a faded pin on the map. Tapping that pin goes back to the day before.

**Trip settings** holds the trip's name, the people on it, the share link, and **Delete trip**.

## The list

### A timeline

The list is a timeline with three columns: a **rail**, the **stop**, and its **time** on the right. There are no cards: rows sit straight on the white sheet and touch, so the rail is one solid line down the day. Spacing is even; times are written out, not drawn to scale.

```
 (✈)  El Paso International Airport      10:30 AM
      UA 1234 lands · rental car at Hertz
  ⊖   1 hr 49 min drive                         ◇
 (🛏)  Holiday Inn Express Alamogordo      1:00 PM
      2 nights
```

- **Rail:** a solid grey line down the day. Each stop sits on it as a **type marker**: the stop's [type](#stop-types) icon on its type's color. The marker is the same as the stop's pin on the map, so you can match the list to the map at a glance. Drives sit on it as a small grey car.
- **Stop:** the name in bold, the largest text in the list, with the note under it in grey, shown in full. Notes hold things like confirmation numbers, so they're never cut off. Tapping a stop opens it.
- **Time:** on the right, in grey, with a small AM/PM. The name leads the row, and the time is where a glance down the right edge finds it. Hotel rows at either end of the day have no time, so the right edge stays empty instead of leaving a gap before the name.

A selected stop (tapped, or picked on the map) gets a light grey background and a dark outline. A selected drive gets no box: its car turns blue, like its route on the map.

### Drives

A drive is a row between two places: a small grey car on the rail, **`1 hr 49 min drive`**, and a Directions icon (a road-sign arrow) on the right, where stops have their time.

- **The Directions icon** opens the drive in the phone's maps app (see [Handing off navigation](#handing-off-navigation)). It sits in a pale grey circle, so it reads as a button without outranking the stops. It's the only part of the row that looks pressable: the row has no hover or press highlight, so tapping the row never looks like tapping Directions.
- **Tapping the rest of the row** shows that route on the map. On a computer, hovering it previews the route.
- **When a drive doesn't fit** in the gap between the two stops, its time turns red and a second line says by how much: `Arrives 49 min late`.

### Hotel stays

A hotel isn't just a stop: you sleep there, and the next morning starts there. Before this, Saturday's first drive started at Friday's last stop (the boardwalk), and so did its Directions link.

- **A hotel has nights.** On its check-in day it shows as a normal stop at its check-in time, with `2 nights` under the name.
- **Every day of the stay starts and ends there.** The day opens with the hotel and, after the day's last stop, a drive back to it. These rows look like any stop, with the same solid marker, and no time. Only the last morning has a note, `Check out`, since that's the one with something to do. Tapping one opens the hotel.
- **Nights, by default, follow the trip:** until the next hotel, or the trip's last day. In the stop sheet, a hotel's **When** becomes **Check-in**, and a **Nights** stepper shows the check-out day (`2 nights · check out Sun, Nov 22`).
- The drive back to the hotel has no times, because the day's last stop has no end.

### Where the day starts without a hotel

With no hotel the night before, the day opens with the day before's last stop, so you can see where you're driving from before the first drive. It looks like any stop, with its arrival time, and under the time, the day it was: `Yesterday`, or the weekday (`Sat`) when there's a day with no stops in between. Without that, a `3:00 PM` above a `10:00 AM` reads as a mistake. Tapping it opens that stop. It's left out when the day's first stop is the same place. This replaces a second line on the first drive (`from Interdune Boardwalk`), which was easy to miss and couldn't be tapped.

### Today

On trip days, today's page shows where you are without a clock in the list:

- **Now is highlighted.** The row you're in (the latest thing that has started: the stop you're at, or the drive you're on) gets a background tinted with its color on the map: a stop's type color, or blue for a drive, whose car turns blue too. A stop's marker also gets a ring.
- **Past dims, in the list and on the map.** Everything before it fades, and so does every earlier day. The rail stays solid. On the map, past drives turn grey and sit under the rest, and a stop you're done with gets a small, faded pin. A hotel stays strong until the night is over.
- **Today opens at now.** When today's page shows, it scrolls so the highlighted row sits a little above the middle.

### Stop types

Every stop has a type, shown as its icon in the list, on its map pin, and in the day list:

| Group (color) | Types |
| --- | --- |
| Travel (teal) | Airport, Gas |
| Stay (purple) | Hotel |
| Food (orange) | Restaurant, Café |
| Sights (pink) | Attraction, Museum, Viewpoint |
| Nature (green) | Nature |
| Shopping (ochre) | Shopping |
| Place (grey) | Place: anything else |

- Colors go by group, so a day's meals or sights read alike. The colors leave out blue (routes) and red (a drive that doesn't fit), and they have light and dark versions.
- **Choosing a type:** the stop sheet has a grid of types under the place. When you pick a place from search, the type starts as a guess from the place's OpenStreetMap category and its name (an "Inn" is a hotel, a "Visitor Center" an attraction). Tap a type to choose one yourself; after that, the guess leaves it alone.
- Stops saved before types existed get the guess from their name, or are a restaurant when the note says breakfast, brunch, lunch or dinner ("Cloudcroft", note "Lunch").

### What the list leaves out, and why

| Removed | Why |
| --- | --- |
| Stop numbers | The order is clear from the times, and type markers match the list to the map. Numbers added marks and had to match the map pins. |
| Addresses | The map already shows where each stop is. In a plan, the place name is what matters. |
| "Last edited by" avatars | This is history, not the plan. Live edits show up as a short notice instead. |
| Driving distance | The duration is what you plan around. The distance adds little and is one tap away in the maps app. |
| Check circles | Checking off stops added a control to every row. The highlight and dimming show what's done without anyone having to tap. |
| Now line | A line at the exact time added a clock to the list. Highlighting the row you're in says the same thing more plainly. |
| Day number (`Day 1 of 3`) | The date is enough. |
| Next card (`Leave in 30 min`, Directions) | Tried at the top of the sheet. It repeated the next drive row, which already has Directions, and took room from the list. The highlight shows where you are. |
| Hotel notes (`Start the day here`, `Back for the night`) and outlined hotel markers | Where the hotel sits in the day already says it. Only `Check out` is kept. |
| Stop counts in the day list | The type icons show the same thing. |
| Pins fading as you scroll the list | With one day on the map there are few pins, and fading them by scroll position made them look done. Faded pins now mean past only. |
| Trip header (name, edit button, faces) | Not needed to plan the day. It's all in trip settings. |
| Trip subtitle (dates · stop count) | The day bar already shows the date. |
| Time-scaled heights and stay lengths | Tried after the grid: cards and drives as tall as the time they take, then a written "41 min" under each time with the rail colored by stay. The uneven gaps looked like layout bugs, and the extra numbers made the list harder to scan. |
| Swiping between days | Dropped after review in favor of the day bar's arrows and day list, which say what they do. |
| Map credits on the map | They covered the map and the top of the sheet. They're at the bottom of trip settings. |
| Calendar time grid | Considered as a way to show how long each stop lasts. A grid shows about 3–4 hours in a half-height sheet on a phone, and trips are mostly long gaps (a 14-hour hotel stay). The [timeline](#a-timeline) keeps to start times and drives. |

### Adding and editing a stop

- **Add stop.** One black button pinned to the bottom of the sheet, always reachable: it's the main action on the screen. A new stop starts two hours after the last stop of the day on screen.
- **Editing.** Tap a stop. The map moves the stop into the strip still visible above the edit sheet.
- **The edit sheet** has four fields (five for a hotel), in this order:
  1. **Place.** The first line, like in the list. It shows the stop's name, and typing in it searches for a new place. One field does both, so there's no separate search box or address line.
  2. **Type.** A grid of [stop types](#stop-types).
  3. **When.** Date and time. For a hotel it's **Check-in**, followed by **Nights**.
  4. **Note.**
- **Delete.** In the edit sheet. Deleting shows a notice with **Undo**.

## The map

- **Pins** are the stop's type marker (its icon on its type's color) ringed in white, with no numbers. A selected stop gets a larger pin and its name in a label above it. Stops at the same place share one pin; for example, flying in and out of the same airport.
- **Routes** are drawn as driving routes in blue; on a trip day, past ones are grey. **Blue means routes and nothing else**: a selected stop is outlined in dark grey, no stop type is blue, and the drive you're on is tinted blue in the list.
- **The background map** is a light, low-contrast style (Stadia "Alidade Smooth"), so the routes stand out. Its credits are at the bottom of trip settings, not over the map.

### How the map and the list work together

- **Tapping a pin** selects that stop and scrolls it into view in the list.
- **Tapping a route** highlights it on the map and highlights its drive in the list. There's no popup, because the list already has the time and the link.
- **Tapping a drive** in the list shows its route; on a computer, hovering a drive previews the route.
- **Tapping empty map** clears the selection.

### Handing off navigation

Every drive's Directions icon opens directions from one stop to the next in the phone's own maps app: **Apple Maps** on iPhone and iPad, **Google Maps** everywhere else. Waythread has no turn-by-turn directions, step lists, or navigation mode. Those are what the maps apps do best.

## Collaboration

- **Sharing is a link.** Opening the link adds you to the trip, so the link is the invite. There are no roles: everyone can edit.
- **Who's on the trip** is listed in trip settings. It used to show as faces in the sheet header; that row went to give the plan more room.
- **Live edits** appear right away. When a co-editor adds, changes, or removes a stop, a short notice appears at the top (for example, "Sam updated Cloudcroft") and the changed stop flashes.
- Edits always build on the latest saved version, so two people editing don't overwrite each other's changes.

## Visual language

The full visual language (tokens, components, light and dark themes, accessibility rules) is the [Waythread design system](../design-system/README.md). Its live demo page is at `/design-system/` on the preview server. In short:

- **Color:**
  - Near-black for text and the main buttons.
  - Grey for secondary information.
  - Blue only for routes and links.
  - Red only for a drive that doesn't fit.
- **Type:** the system font. Stop names 16px semibold, times 15px with tabular numbers, notes and drives 13px.
- **Surfaces:** the map, then the white plan sheet with the timeline straight on it. Trip cards on Home and modal sheets are white too. No heavy shadows.
- **Phone-first layout, adapting up:**

  | Width | Trip | Home and sign-in |
  | --- | --- | --- |
  | Under 768px | Full-screen map, plan in a bottom sheet; modal sheets slide up | A 480px column |
  | 768px and up | Plan in a side panel beside the map; modal sheets cover the panel | Trips in a grid of cards; sign-in in a card; other sheets are dialogs in the middle |

  16px text in form fields (stops iPhone zooming in), and spacing for phone screen edges. The prototype doesn't opt in to the side panel, so it stays phone-shaped at every width.

## Prototype notes

- **Running it:** from the repo root, `python -m http.server 5173 -d .`, then open `http://localhost:5173/prototype/`. The design system demo is at `http://localhost:5173/design-system/`.
- **Tech:** plain HTML, CSS, and JavaScript with no build step, styled entirely by the [design system](../design-system/README.md). It follows the phone's light or dark setting. The map uses [Leaflet](https://leafletjs.com) 1.9.4.
- **External services:**

  | Purpose | Service | Notes |
  | --- | --- | --- |
  | Routes | OSRM public demo server | Rate-limited. Results are cached, and if a request fails it falls back to a straight-line estimate. |
  | Place search | Nominatim | |
  | Background map | Stadia | Falls back to OpenStreetMap if Stadia's map doesn't load. |

  None of these are meant for production traffic.
- **Data:** saved in the browser, one browser only. Open tabs sync with each other, which simulates co-editing.
- **Simulating other people and dates:**

  | Add to the address | Effect |
  | --- | --- |
  | `?as=sam` or `?as=jo` | Use the app as another person. Open two tabs to try co-editing. Trip settings links to these. |
  | `?today=2026-11-20` | Pretend it's a trip day, to preview the highlight and the dimming. |
| `&now=14:10` | With `?today=`, pretend it's that time, to preview what's highlighted and what dims. |

## Open questions and next steps

- **Backend:** real accounts, sharing between devices, and handling two people editing the same stop at once.
- **Production map services:** a paid or self-hosted service for routes, search, and the background map.
- **Transport modes:** walking and flights currently all show as driving time.
- **Phone-friendly gestures:** for example, dragging to reorder.
- **Day view in the app:** shipped. The day bar, timeline, hotel stays, stop types and floating buttons are in `app/web`, with their styles in the design system (v2.0.0). Stops store `kind` and `nights` on the server. In the app, trip settings also holds Make a new link, and the trip name saves when you leave the field. Try changes in `prototype/` first, then port them by hand.
- **How long a stop lasts:** stops have only a start time, so "Arrives late" and the highlight assume you leave each stop just in time for the next. Default lengths per type (a meal 1 hour, a museum 2, a flight's check-in 90 minutes) would make both more honest, without showing durations in the list.
- **From the UX review, not yet done:** a lighter Add stop (type as one tappable marker instead of a grid, quick time choices), showing who's on the trip at a glance and what changed while you were away, working offline, an "All days" map of the whole route, and marking estimated drive times with `≈`.
- **Map credits:** Stadia's and OpenStreetMap's terms ask for attribution on or next to the map. The app now shows them only in trip settings, like the prototype. Check the terms before this deploys; if needed, bring back a small ⓘ button on the map that shows the credits.
- **People at a glance:** with the header gone, who's on the trip is one tap away. If that hides co-editing too much, a small stack of faces could go back on the settings button.
- **Accessibility:** a full review, including focus handling in the sheets and screen-reader labels for pins.
