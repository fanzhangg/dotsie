# Waythread UX Design

This document describes the UX of the Waythread prototype in [`prototype/`](../prototype), the reasoning behind it, and what was left out on purpose. It builds on the [proposal](proposal.md).

## Principles

The proposal set three principles. This is how each one shows up in the design:

| Principle | In practice |
| --- | --- |
| **Less is more** | Show information only when it is essential, isn't shown elsewhere on screen, and can't be inferred at a glance. Each element earns its place. |
| **The route and the plan are the focus** | The map fills the screen and the plan sits on top of it. The most prominent things are the stops and the routes between them, not controls. |
| **Co-editing is the default** | Every trip is shared. Everyone on it can edit, there are no roles, and the people on a trip are always visible. |

One more rule came out of the iterations: **don't rebuild what Google Maps and Apple Maps already do.** Waythread plans the trip and hands off to the phone's maps app for navigation.

## Screens

### Home

- The app name, then one card per trip showing its **name** and **date range**, then a **New trip** button.
- The cards leave out stop counts, "next stop", and avatars. You can see those after opening a trip, and they don't help you pick one.

### Trip

The trip is a single screen: a full-screen **map** with the **stop list** in a sheet over it. There are no List/Map tabs.

```
┌──────────────────────────┐
│                          │
│        map: pins +       │
│        routes            │
│                          │
├──────────────────────────┤  ← drag handle
│ ‹  White Sands, NM ✎ (A)(S)│  ← sheet header
│ Fri, Nov 20              │  ← day heading (sticky)
│ ┌──────────────────────┐ │
│ │10:30AM  El Paso Intl │ │  ← stop card
│ │         UA 1234 lands│ │
│ └──────────────────────┘ │
│  🚗 1 hr 49 min ↗         │  ← drive
│ ┌──────────────────────┐ │
│ │ 1:00PM  Holiday Inn… │ │
│ └──────────────────────┘ │
│ [      + Add stop      ] │  ← pinned to bottom
└──────────────────────────┘
```

**The sheet** has three heights: header only, half the screen (the default), and nearly full. Drag the top of the sheet to resize it, or tap its top edge to switch between header-only and half. When the trip opens, the map zooms to fit every stop above the sheet.

**The sheet header** shows, in order:
- Back to the trip list.
- The trip name.
- A pencil button that opens **Edit trip** (rename or delete).
- The faces of everyone on the trip, which also open sharing. A trip with only you shows an add-person icon instead.

## The list

### Three layers

Each kind of information has its own look, so you can tell the time, the drive, and the stop name apart at a glance.

1. **Day heading.** Bold text such as "Fri, Nov 20" that stays pinned at the top while you scroll that day.
2. **Stop card.** A white card on the grey sheet. Inside it:
   - **Time:** grey, fixed-width column, small AM/PM. For example, `10:30 AM`.
   - **Name:** bold, the largest text in the list.
   - **Note:** grey, under the name, shown in full. Notes hold things like confirmation numbers, so they're never cut off.
   - **Check circle:** on the right, only on trip days (see [Checking off stops](#checking-off-stops)).
3. **Drive.** Sits between cards, outside them. It's a quiet grey button with a car icon, the duration, and an external-link arrow: `🚗 1 hr 49 min ↗`. The time turns **red** when the drive is longer than the gap between the two stops.

### What the list leaves out, and why

| Removed | Why |
| --- | --- |
| Stop numbers | The order is clear from the times. Numbers added marks and had to match the map pins. |
| Addresses | The map already shows where each stop is. In a plan, the place name is what matters. |
| "Last edited by" avatars | This is history, not the plan. Live edits show up as a short notice instead. |
| Driving distance | The duration is what you plan around. The distance adds little and is one tap away in the maps app. |
| "52 min short" badges | Replaced by coloring the drive time red: same signal, no extra element. |
| Trip subtitle (dates · stop count) | The day headings already show the dates. |

### Adding and editing a stop

- **Add stop.** One button pinned to the bottom of the sheet, always reachable. It's white with a thin outline, so it doesn't compete with the plan. A new stop starts two hours after the last one.
- **Editing.** Tap a stop card. The map moves the stop into the strip still visible above the edit sheet.
- **The edit sheet** has three fields, in this order:
  1. **Place.** The first line, like in the list. It shows the stop's name, and typing in it searches for a new place. One field does both, so there's no separate search box or address line.
  2. **When.** Date and time.
  3. **Note.**
- **Delete.** In the edit sheet. Deleting shows a notice with **Undo**.

### Checking off stops

Checking off only matters while you're on the trip. The check circle shows **only on trip days**, meaning today falls between the first and last stop. Before the trip, it would just be clutter.

Checked stops fade, and the route leading to them turns grey on the map.

## The map

- **Pins** are plain dots, all the same, with no numbers. A selected stop gets a larger pin and its name in a label above it. Stops at the same place share one pin; for example, flying in and out of the same airport.
- **Routes** are drawn as driving routes in blue. **Blue means routes and nothing else**: a selected card is outlined in dark grey, not blue.
- **The background map** is a light, low-contrast style (Stadia "Alidade Smooth"), so the routes stand out.

### How the map and the list work together

- **Scrolling links them.** Pins for the stops scrolled into view stay strong, and the rest fade. You can match list to map without numbers or tapping.
- **Tapping a pin** selects that stop and scrolls it into view in the list.
- **Tapping a route** highlights it on the map and highlights its drive in the list. There's no popup, because the list already has the time and the link.
- **On a computer, hovering a drive** in the list previews its route.
- **Tapping empty map** clears the selection.

### Handing off navigation

Every drive's grey button opens directions from one stop to the next in the phone's own maps app: **Apple Maps** on iPhone and iPad, **Google Maps** everywhere else. Waythread has no turn-by-turn directions, step lists, or navigation mode. Those are what the maps apps do best.

## Collaboration

- **Sharing is a link.** Opening the link adds you to the trip, so the link is the invite. There are no roles: everyone can edit.
- **Who's on the trip** is always visible as faces in the sheet header.
- **Live edits** appear right away. When a co-editor adds, changes, checks off, or removes a stop, a short notice appears at the top (for example, "Sam checked off Cloudcroft") and the changed card flashes.
- Edits always build on the latest saved version, so two people editing don't overwrite each other's changes.

## Visual language

- **Color:**
  - Near-black for text and the main buttons.
  - Grey for secondary information.
  - Blue only for routes and links.
  - Red only for a drive that doesn't fit.
- **Type:** the system font. Stop names 16px semibold, times 15px with tabular numbers, notes and drives 13px.
- **Surfaces:** the map, then a grey sheet, then white cards. Cards have a hairline border and no heavy shadows.
- **Phone-first layout:** a 480px column centered on larger screens, 16px text in form fields (stops iPhone zooming in), and spacing for phone screen edges.

## Prototype notes

- **Running it:** `python -m http.server 5173 -d prototype`, then open `http://localhost:5173`.
- **Tech:** plain HTML, CSS, and JavaScript with no build step. The map uses [Leaflet](https://leafletjs.com) 1.9.4.
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
  | `?as=sam` or `?as=jo` | Use the app as another person. Open two tabs to try co-editing. The share sheet links to these. |
  | `?today=2026-11-20` | Pretend it's a trip day, to preview checking off stops. |

## Open questions and next steps

- **Backend:** real accounts, sharing between devices, and handling two people editing the same stop at once.
- **Production map services:** a paid or self-hosted service for routes, search, and the background map.
- **Transport modes:** walking and flights currently all show as driving time.
- **Phone-friendly gestures:** for example, swiping a stop to check it off, and dragging to reorder.
- **Accessibility:** a full review, including focus handling in the sheets and screen-reader labels for pins.
