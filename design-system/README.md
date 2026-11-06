# Waythread Design System

Version 9.4.0. The design system behind Waythread, a minimal, phone-first trip planner that also works on a computer. It's three plain files, with no build step:

| File | What it holds |
| --- | --- |
| [`tokens.css`](tokens.css) | Every color, font, size, radius, shadow, duration and layer, in light and dark themes. |
| [`components.css`](components.css) | The component classes (`.wt-*`), built only from tokens. |
| [`icons.js`](icons.js) | The icon set, as `WaythreadIcons.svg(name, size?, stroke?)`. |

To see everything live, in both themes, run the preview server and open [`index.html`](index.html) at `/design-system/`:

```bash
python -m http.server 5173 -d .
```

The [prototype](../prototype) is built entirely on this system. Read it for a working example.

## Principles

1. **Less is more.** Show information only when it's essential, isn't shown elsewhere, and can't be inferred at a glance. Each element earns its place.
2. **The plan and the route lead.** Stop names are the strongest text, and routes are the only blue. Ink and color get quieter as information matters less. Controls stay quiet.
3. **Built for sharing.** Everyone on a trip can edit. People are always visible, and their changes show up as they happen.
4. **Hand off what others do best.** Navigation opens in Apple Maps or Google Maps. Never rebuild it.

Each principle comes with a rule you can check:

- Color has a job, and how loud it is says how much its information matters. Loudest first:

  | Color | Means | Where |
  | --- | --- | --- |
  | Red (`--wt-danger`) | Needs fixing | A drive that doesn't fit: its time, its car, "Arrives 13 min late". Destructive buttons. |
  | Black (`--wt-now`, `--wt-text-primary`) | Now, and what you read first | The row happening now: a black ring on its marker or a black car, and its time in primary ink. Stop names. The one primary button. |
  | Type colors (`--wt-kind-*`) | What kind of place | Markers and pins only. One color per type, all about as light, so no type outranks another. |
  | Greys (`--wt-text-secondary`, `--wt-text-tertiary`) | Read next, then detail | Times and notes, then drives and detail. |
  | Light grey (`--wt-text-past`, `--wt-kind-past`) | Over | Past rows' text, markers and cars; past routes; muted pins. The color drains out of what's done. |
  | Blue (`--wt-route`, `--wt-text-link`) | Routes and links | Route lines on the map, links in notes. Never a highlight. |

  Nothing else is colored. A highlight is grey, never tinted.
- Use one way to show emphasis at a time. A card is set apart by its surface, not by surface and shadow and border together.
- Weight is for the few things that lead. Stop names are medium (500) and the strongest text on the trip screen: the trip's name and the day above them are smaller and grey (`--wt-type-context`). Modal titles are semibold (600); only the app name on Home is bold. Everything else is regular, and steps down by size and ink (`--wt-text-secondary`, then `--wt-text-tertiary`, and `--wt-text-past` for what's over), never by adding weight.
- Show state with what's already there. A late drive is the same row in red; a past row turns light grey. Don't add a badge.

## Getting started

Load the files in this order, then put `wt-base` on `<body>`:

```html
<link rel="stylesheet" href="design-system/tokens.css">
<link rel="stylesheet" href="design-system/components.css">
<link rel="stylesheet" href="your-app.css">        <!-- layout only -->
<script src="design-system/icons.js"></script>

<body class="wt-base"> … </body>
```

- **Your app's CSS** places components on the screen. Leave color, type and shape to the system. If you need a value it doesn't have, add a token (see [Contributing](#contributing)), don't hard-code one.
- **Theming** is automatic. The system follows the phone's light or dark setting. To force a theme, set `data-theme="light"` or `data-theme="dark"` on `<html>`.
- **Script-drawn graphics** (canvas, map libraries) read tokens at draw time so they follow the theme:

  ```js
  const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  L.polyline(coords, { color: token('--wt-route') });
  ```

## How it's organized

### Three tiers of tokens

| Tier | Prefix | Example | Rule |
| --- | --- | --- | --- |
| 1. Primitives | `--wt-color-*` | `--wt-color-blue-500` | The raw palette. Only tier 2 uses these. |
| 2. Roles | `--wt-surface-*`, `--wt-text-*`, `--wt-border-*`, `--wt-action-*`, `--wt-route-*`, `--wt-pin-*`, `--wt-kind-*`, `--wt-danger*`, `--wt-identity-*` | `--wt-route` | Named for what they're for. Each theme sets them differently. Components use these. |
| 3. Scales | `--wt-type-*`, `--wt-space-*`, `--wt-radius-*`, `--wt-size-*`, `--wt-shadow-*`, `--wt-duration-*`, `--wt-z-*` | `--wt-space-4` | The same in every theme. |

A new theme, such as high-contrast, only redefines tier 2.

### Class names

| Pattern | Meaning | Example |
| --- | --- | --- |
| `.wt-<component>` | A component | `.wt-sheet` |
| `.wt-<component>__<part>` | A part of a component | `.wt-sheet__body` |
| `.wt-<component>--<variant>` | A lasting variant | `.wt-marker--sm`, `.wt-btn--primary` |
| `.is-<state>` | A passing state set by script | `.is-open`, `.is-selected`, `.is-past` |

Prefer ARIA attributes for state where one exists. The type picker reads `aria-checked="true"`, and the open day in the day list `aria-current="date"`, not a class.

The timeline's parts are named `.wt-tl-*` (`.wt-tl-stop`, `.wt-tl-drive`), not `.wt-tl__*`. Each row is a small component of its own, with its own parts (`.wt-tl-drive__what`).

## Tokens

The values live in [`tokens.css`](tokens.css). The demo page shows each one live, in the current theme.

### Color roles

| Token | Use for |
| --- | --- |
| `--wt-surface-page` | Behind the app column on wide screens. |
| `--wt-surface-sheet` | Grey panels behind raised content. (Before 2.0.0, the list sheet.) |
| `--wt-surface-raised` | The list sheet over the map, modal sheets, cards, focused inputs. The timeline sits on it. |
| `--wt-surface-sunken` | Inputs at rest, and quiet panels. |
| `--wt-surface-hover` | Pressed or hovered quiet controls. |
| `--wt-surface-current` | The one highlighted timeline row: the selected one, or else the one happening now. The same for stops and drives. A clear step darker than `--wt-surface-raised` in both themes, so the highlight is easy to find. Grey, never tinted. |
| `--wt-surface-inverse` | Toasts. |
| `--wt-surface-map` | The map before its tiles load. |
| `--wt-text-primary` | Names, titles, running text and what you typed. The first thing you read. |
| `--wt-text-secondary` | Times, notes, field labels, addresses, dates on a trip card. Read right after the name. |
| `--wt-text-tertiary` | Drives, AM/PM, "Yesterday" in the time column, the credit line, chevrons. Detail that's there when you look for it. It passes 4.5:1 on raised, sheet and sunken surfaces, not on `--wt-surface-current`: a highlighted timeline row steps it up to secondary. |
| `--wt-text-past` | The fourth ink: every line of a row that's over, links included. About 2.5:1, as faded on purpose as the old 45% opacity, but the same grey on any background. |
| `--wt-text-placeholder` | Placeholder text only. |
| `--wt-text-inverse`, `--wt-text-inverse-action`, `--wt-text-inverse-secondary`, `--wt-text-inverse-danger` | On a toast: text, the action, a rich toast's detail line, and an error's icon. |
| `--wt-text-link` | Links in running text. |
| `--wt-text-danger` | A late drive, destructive buttons. |
| `--wt-border-subtle` | Card hairlines. |
| `--wt-border-default` | Input borders, list dividers. |
| `--wt-border-strong` | The sheet's grab handle (decorative). |
| `--wt-border-rail` | The timeline's rail: a quiet hairline, dimmer than `--wt-border-strong`, one step darker than `--wt-surface-current` so it shows through a highlighted row. |
| `--wt-border-control` | Control borders that must meet 3:1 on cards. No component uses it since 2.0.0. |
| `--wt-border-focus` | Focus rings, the focused input. |
| `--wt-action-primary`, `--wt-action-primary-text` | The one main action in a view, like Add stop. |
| `--wt-action-danger`, `--wt-action-danger-text` | The confirm button of a dialog that destroys something (`.wt-btn--destructive`). |
| `--wt-action-secondary`, `--wt-action-secondary-text` | Quiet actions, like Copy. |
| `--wt-action-done`, `--wt-action-done-text` | Unused since 2.0.0, when checks were removed. Kept until the next major version. |
| `--wt-route`, `--wt-route-active`, `--wt-route-muted`, `--wt-route-done`, `--wt-route-casing` | Route lines: normal, selected, the others while one is selected, past (on today: the same grey as `--wt-kind-past`), and the outline under each line. |
| `--wt-pin-fill` | The outline around a map pin. |
| `--wt-pin-ring`, `--wt-pin-ring-muted`, `--wt-pin-ring-done` | Unused since 2.0.0, when pins became markers. Kept until the next major version. |
| `--wt-kind-place`, `--wt-kind-hotel`, `--wt-kind-airport`, `--wt-kind-gas`, `--wt-kind-restaurant`, `--wt-kind-cafe`, `--wt-kind-attraction`, `--wt-kind-viewpoint`, `--wt-kind-nature`, `--wt-kind-museum`, `--wt-kind-shopping` | Stop types, one color each, so no two types look alike (see [Marker](#marker-wt-marker)). Named for the type's key, so a stop's color is `--wt-kind-<kind>`. Only on markers, pins and the type picker. Each is as vivid as its hue allows (OKLCH chroma up to .21 in light, .18 in dark) at about one lightness (L .62 in light, .74 in dark), so markers are bright and colorful and a type says what a place is, never that it matters more. Café, gas, nature and airport sit a little deeper, to stay apart from their neighbors. L .62 is as light as a type can be with `--wt-marker-ink` still at 3:1. None is blue or red. Place stays a neutral. |
| `--wt-kind-travel`, `--wt-kind-stay`, `--wt-kind-food`, `--wt-kind-sight`, `--wt-kind-shop` | Unused since 6.6.0, when each type got its own color. Each is now its group's first type (airport, hotel, restaurant, attraction, shopping). Kept until the next major version. |
| `--wt-kind-drive` | The car marker on a drive in the timeline: grey, and quieter than any stop type. |
| `--wt-kind-drive-current` | The car on the selected drive: a darker grey, never blue. |
| `--wt-kind-past` | Markers, cars and muted pins of what's over: light grey. |
| `--wt-marker-lift`, `--wt-marker-sink`, `--wt-marker-boost` | The shading on a stop's marker and pin, as on a maps app's. Each builds its own gradient from its color (`--wt-marker-fill`) with OKLCH relative colors: `lift` lighter and `boost` times the chroma at the top, `sink` darker at the bottom, one hue throughout. Not on a drive's car, which stays flat, nor on what's over. |
| `--wt-marker-gloss` | Unused since 6.2.0: a white-and-black overlay that greyed the colors. Kept until the next major version. |
| `--wt-marker-ink` | The icon on a marker, the number or dot on a map pin, and the car on a drive. Meets 3:1 on every kind color, `--wt-kind-drive`, `--wt-kind-drive-current`, `--wt-now`, `--wt-danger` and `--wt-route`. Not on `--wt-kind-past`: what's over is faded on purpose. |
| `--wt-danger`, `--wt-danger-surface` | "Doesn't fit" and destructive states; a late drive's car. The loudest color. |
| `--wt-now` | The ring on the stop happening now and the car on the drive you're on: the blackest ink (`gray-950`; `gray-100` in dark). |
| `--wt-highlight` | Flashing a co-editor's change once. |
| `--wt-overlay` | The dimmed backdrop behind modal sheets. |
| `--wt-identity-1` … `--wt-identity-6`, `--wt-identity-text` | A person's color and their initial. Give each person on a trip a fixed color in order. |

### Greys

Every neutral comes from one ramp, `--wt-color-gray-0` … `--wt-color-gray-1000`: a single warm grey (OKLCH hue 90, chroma .0035, so the sheet reads as paper, not steel), stepped by lightness. The steps are fine at both ends, where surfaces and lines need small differences, and wide in the middle, where each step is an ink with its own contrast and its own rank:

| Rank | Light | Dark | On white / on `gray-900` | For |
| --- | --- | --- | --- | --- |
| Ink 1 | `gray-950` | `gray-100` | 18:1 / 15:1 | Names, titles, the time happening now. Also `--wt-now` and the primary button. |
| Ink 2 | `gray-600` | `gray-350` | 7:1 / 8:1 | Times, notes, labels. AAA. |
| Ink 3 | `gray-500` | `gray-450` | 5:1 / 5:1 | Drives, AM/PM, detail. AA on raised, sheet and sunken surfaces. |
| Ink 4 | `gray-400` | `gray-600` | 2.6:1 / 2.4:1 | What's over, placeholders. |

Below those come the lines (`150` borders, `250` the rail, `300` the grab handle, `450` control borders) and the surfaces (`0` raised, `50` sunken, `100` sheet, `200` the highlighted row; in dark, `900`, `850`, `950` and `750`). At the far end are the blacks: `950` is the strongest ink and the primary button, and `1000` is the dark page. No role uses a grey from outside the ramp.

### Type

The system font throughout, so the app feels native on every phone. Each token is a full `font` shorthand. Use it as `font: var(--wt-type-name);`.

Four weights, each with a job: **700** the app name only; **600** headings and the one primary button; **500** names, the strongest text in a list, and other buttons; **400** everything else. A screen with lots of semibold tires the eye and makes nothing stand out, so below the names, hierarchy comes from size and ink, not weight. `<b>` and `<strong>` inside `wt-base` are 600, never 700.

| Token | Size / line | Weight | Use for |
| --- | --- | --- | --- |
| `--wt-type-display` | 28 / 34 | 700 | The app name on Home. Pair it with `--wt-tracking-display`. |
| `--wt-type-title` | 18 / 24 | 600 | Modal titles. |
| `--wt-type-context` | 15 / 20 | 500 | Where you are: the trip's name and the day bar, in `--wt-text-secondary`. Smaller and lighter than a stop's name, so the plan leads. |
| `--wt-type-heading` | 15 / 20 | 600 | Section titles in trip settings and Account (`.wt-section__title`). |
| `--wt-type-name` | 16 / 21 | 500 | Stop and trip names: the strongest text in a list. |
| `--wt-type-body` | 15 / 21 | 400 | Running text. |
| `--wt-type-time` | 15 / 21 | 400 | Stop times, in `--wt-text-secondary`. Always use `tabular-nums`. |
| `--wt-type-label` | 14 / 20 | 500 | Buttons and pin labels. A primary button is 600. |
| `--wt-type-caption` | 13 / 18 | 400 | Notes, drives, field labels, hints. |
| `--wt-type-caption-strong` | 13 / 18 | 500 | A late drive's "Arrives 13 min late". |
| `--wt-type-overline` | 12 / 16 | 600 | Day headings in All days. Set in capitals, with `--wt-tracking-caps`. |
| `--wt-type-micro` | 11 / 14 | 500 | AM/PM (in `--wt-text-tertiary`), avatar initials (600). |
| `--wt-type-input` | 16 / 22 | 400 | Form fields. 16px stops iPhone zooming in. |

### Space, shape, size

- **Columns:** icons and text line up down the screen, the way the timeline's rail does.
  - **Trip screen:** home, the day bar's ‹, and every marker and car are centred on the rail (36px in from the screen edge on a phone). Settings, the day bar's › and Directions share a column on the right. The trip's name starts where stop names do. The header card, docked header and side panel all keep these positions, so nothing shifts as the sheet docks.
  - **Sheets:** two icon columns measured from the content edge: the options' markers on the left (23px), and their checks on the right (17px). The search icon, a picker's marker, a sub-page's back button, Close and a picker's chevron all sit on these columns. The typed search, a picker's value and a sub-page's title start where option names do.
- **Space:** a 4px grid. `--wt-space-1` (4) · `2` (8) · `3` (12) · `4` (16) · `5` (20) · `6` (24) · `8` (32) · `10` (40). The side margin on a phone is `--wt-space-4`; the list's inner margin is `--wt-space-3`.
- **Radius:** `--wt-radius-sm` (8, pin labels) · `md` (12, cards, inputs, block buttons, timeline rows) · `lg` (18, sheets) · `pill` (buttons, toasts) · `round` (avatars, markers, icon buttons).
- **Size:** `--wt-size-touch` (44, the minimum for anything tapped often) · `icon-btn` (40) · `avatar` (26) · `check` (26, unused since 2.0.0) · `icon` (22) · `column` (480, the app column on large screens) · `panel` (360–440, 30% of the window: the plan's side panel from 768px wide) · `trip-head` (56, the trip header, below the top safe area).

### Elevation, motion, layers

- **Elevation is set by role:**
  - `--wt-shadow-hairline`: cards.
  - `--wt-shadow-sheet`: the list sheet.
  - `--wt-shadow-float`: labels and buttons over the map.
  - `--wt-shadow-card`: a card floating over the map. (The trip header uses the lighter `--wt-shadow-float` since 5.1.0.)
  - `--wt-shadow-pin`: pins.
  - `--wt-shadow-pin-selected`: the selected pin, and both ends of a route on show.

  Nothing else gets a shadow.
- **Motion:**
  - `--wt-duration-fast` (150ms): color changes.
  - `--wt-duration-base` (250ms): sheets and toasts, with `--wt-ease-out`.
  - `--wt-duration-flash` (2.4s): a co-editor's change.

  All three drop to 0 when the phone asks for reduced motion.
- **A set of buttons changing to another morphs, never swaps.** When what you can do changes (the add bar's Add stop, a stop's Open in Maps, a drive's Directions), the old buttons turn into the new ones on `--wt-duration-base` with `--wt-ease-out`, so you see where each went:
  - **A button in both sets moves and stretches** from where it was to where it goes, its old look (color, label) fading out over it in the first 60%. Selecting a stop shrinks the full-width Add stop to the right, into the round `+` at the row's end; clearing it grows the `+` back. Open in Maps and Directions are the same button: one stretches into the other.
  - **A new button fades in**: a wide one grows from its left edge, out of a circle; a round one grows from 60%.
  - **A button that's gone fades out where it was,** under the rest, which slide over it.
  - Give each button a key that's the same in every set (the app uses `data-key`). Mark the row `.is-morphing` while it runs: its buttons are placed absolutely, from where they'll end up, and it keeps its height. The fading copies are `.is-ghost` and take no taps. The add bar is the only such row so far; a new one should work the same way.
  - With reduced motion the new set just appears.
- **Layers:** `--wt-z-raised` (sticky parts inside a scroll area) · `sheet` (500, above the map; also the map buttons) · `modal` (1000) · `dialog` (1500, a question over any sheet) · `toast` (2000).

## Icons

Line icons on a 24px grid with a 2px stroke and round ends, drawn in the text color:

`back` `forward` `close` `plus` `edit` `check` `car` `external` `person-add` `search` `pin` `home` `settings` `chevron-down` `chevron-up-down` `directions` `map` `list` `fit` `alert` (something failed)

Offline: `download` (saving, and Save for offline), `saved` (saved on this device) and `cloud-off` (no connection).

Stop types: `plane` `bed` `utensils` `cup` `star` `museum` `tree` `camera` `bag` `fuel` (with `pin` for a plain place).

How you get there: `car` `walk` `bike` `train` `plane` (Drive, Walk, Bike, Transit, Flight).

```js
WaythreadIcons.svg('car');           // the size the product uses
WaythreadIcons.svg('check', 16, 3);  // custom size and stroke
```

- An icon next to a label is decoration (`aria-hidden`).
- An icon-only button needs an `aria-label`.
- `external` means "opens another app or site". Use it only for that.
- `chevron-up-down` means "tap for a list to choose from" (the day bar's day). `forward` and `back` step or go to another page; don't put two controls that look alike but do different things next to each other.

## Components

Each entry shows the minimum markup. Your code supplies the content and the behavior; the system supplies the look.

### Button `.wt-btn`

```html
<button class="wt-btn wt-btn--primary">Save</button>
<button class="wt-btn wt-btn--primary wt-btn--block">${icon('plus')}Add stop</button>
<button class="wt-btn wt-btn--secondary">Copy</button>
<button class="wt-btn wt-btn--secondary wt-btn--icon" aria-label="Add stop">${icon('plus')}</button>
<button class="wt-btn wt-btn--danger">Delete trip</button>
```

| Variant | Use for |
| --- | --- |
| `--primary` | The one main action in a view: Save, Add, Create. On the trip screen, Add stop, or Open in Maps while a stop is selected. Never more than one per view. |
| `--secondary` | Every other action: white with a hairline outline. Copy, Save for offline, Make a new link, Remove from this device, Sign out, Continue with Google. |
| `--danger` | A destructive action: the same button as `--secondary`, with a red label. Delete trip, Delete (a stop), Disconnect. Always leave a way back: an Undo toast or a confirmation. |
| `--destructive` | Filled red, only for the confirm button of a [dialog](#dialog-wt-dialog) that destroys something: "Delete trip". |
| `--block` | Full width, at the bottom of a sheet or form. |
| `--icon` | Icon only: a round button as tall as the others, for an action that sits beside a bigger one, like Edit stop and the `+` beside Open in Maps. White (`--secondary`). Needs an `aria-label`. |

**Unavailable for now:** `aria-disabled="true"` on any variant makes it grey (`--wt-surface-sunken`, `--wt-text-tertiary`, no shadow) but leaves it tappable, so the tap can say why in a toast. Offline, Add stop, the round `+` and Edit stop work this way, and a tap shows the "You're offline" notice (a [rich toast](#toast-wt-toast)). Use `disabled` only where the reason is plain on screen, since a disabled button does nothing when tapped.

**One look per kind of button.** A button is black (`--primary`), white and outlined (`--secondary`, or `--danger` with a red label), or, only in a dialog, filled red (`--destructive`). There are no text-only buttons: an action you can tap always has a shape, so it never reads as a label or a link. Text that's tappable inside a sentence (Change, after your email) is a link, not a button.

Labels are verbs that say exactly what happens.

### Icon button `.wt-icon-btn`

```html
<button class="wt-icon-btn" aria-label="Close">${icon('close')}</button>
<button class="wt-icon-btn wt-icon-btn--sm wt-icon-btn--muted" aria-label="Edit trip">${icon('edit')}</button>
```

- Only for actions whose icon is universally understood: add, back, close, edit, home, settings, the day arrows and Directions.
- Everything else gets a text label.
- `--muted` is for secondary actions next to a title.

### Avatar `.wt-avatar` and stack `.wt-avatar-stack`

```html
<button class="wt-avatar-stack" aria-label="People and sharing">
  <span class="wt-avatar" style="--wt-avatar-color: var(--wt-identity-1)">A</span>
  <span class="wt-avatar" style="--wt-avatar-color: var(--wt-identity-2)">S<img class="wt-avatar__img" src="…" alt="" referrerpolicy="no-referrer"></span>
</button>
```

- The stack shows who's on the trip. Trip settings lists everyone by name (`.wt-people`), with "(you)" in `.wt-people__meta`.
- A photo (`.wt-avatar__img`) goes inside the avatar, after the initial, and covers it. Keep the initial and the identity color: they show while the photo loads, and if it fails, remove the `<img>`. The name is always next to it or in a label, so `alt` stays empty.
- With only one person on the trip, show the `person-add` icon instead. (A trip card shows its one person: there, the stack says who's on the trip, not how to add someone.)
- Set `--wt-avatar-ring` to the surface behind the stack.
- Out of room: `<span class="wt-avatar wt-avatar--more">+3</span>` stands for the rest, in quiet grey.

### Settings section `.wt-section`

```html
<div class="wt-modal__head"><h2 class="wt-modal__title">Trip settings</h2>…</div>
<form class="wt-section">                          <!-- a section that is one field -->
  <label class="wt-section__title" for="trip-name">Name</label>
  <input class="wt-input" id="trip-name">
</form>
<section class="wt-section">
  <h3 class="wt-section__title">Share link</h3>
  <p class="wt-section__text">Anyone with the link can join and edit this trip.</p>
  <div class="wt-copy-row"><input class="wt-input" readonly …><button class="wt-btn wt-btn--secondary">Copy</button></div>
  <button class="wt-btn wt-btn--secondary">Make a new link</button>
</section>
<div class="wt-section"><button class="wt-btn wt-btn--danger">Delete trip</button></div>
```

- **Trip settings and Account are a column of sections**, one thing each, divided by `--wt-border-default` hairlines. Every section reads in the same order: the title (`__title`, `--wt-type-heading`), a line on what it does (`__text`, body in `--wt-text-secondary`), its controls, then a hint under a control (`__hint`, caption) or a button. The spacing between them is set by the section, so each one has the same rhythm.
- **A section that is one field** is the field's `<form>`, with its title as the `<label>`. A picker goes in a `.wt-field` inside the section, so its menu drops down under it.
- **No primary button.** Every change saves on its own (a name when you leave the field), so nothing in a settings sheet is black. Every button is the same white `--secondary` button (Copy, Save for offline, Make a new link, Remove from this device, Sign out), and the destructive one (Delete trip) is `--danger`, the same button with a red label, last, in a section of its own. Sign out is `--secondary`: it destroys nothing, and a guest is asked first.
- **Words:** `__text` says what the section does, in one sentence. `__hint` says how to use the control above it ("People on your trips see this name").
- The map's credits (`.wt-credit`) follow the last section in trip settings.

### Field `.wt-field`, input `.wt-input`, search page `.wt-search-bar`, `.wt-search`, results `.wt-results`

```html
<label class="wt-field">
  <span class="wt-field__label">Note</span>
  <textarea class="wt-input" rows="2" placeholder="Confirmation #, tickets, tips…"></textarea>
</label>

<!-- A field picked by searching: a row in the form… -->
<div class="wt-field"><span class="wt-field__label" id="place-label">Place</span>
  <button class="wt-picker wt-picker--text" aria-describedby="place-label">
    <span class="wt-picker__value"><span class="wt-picker__name">Joshua Tree Inn</span>
      <span class="wt-picker__detail">61259 29 Palms Hwy, Joshua Tree, CA</span></span>${icon('forward', 18)}
  </button></div>

<!-- …that opens a search page in place of the form (on .wt-modal, add .is-full) -->
<div class="wt-search-bar">
  <label class="wt-input wt-input-group wt-search">${icon('search')}
    <input type="text" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="place-results"
           aria-activedescendant="opt-0" aria-label="Search a place" placeholder="Search a place">
    <span class="wt-spinner" hidden></span>
    <button type="button" class="wt-search__clear" aria-label="Clear">${icon('close')}</button></label>
  <button type="button" class="wt-search-bar__cancel">Cancel</button>
</div>
<div class="wt-results" id="place-results" role="listbox" aria-label="Places">
  <div class="wt-option" role="option" id="opt-0" aria-selected="true">
    <i class="wt-marker" style="--wt-kind-color: var(--wt-kind-hotel)">${icon('bed')}</i>
    <span class="wt-option__text"><span class="wt-option__label"><mark class="wt-option__match">Joshua</mark> Tree Inn</span>
      <span class="wt-option__detail">61259 29 Palms Hwy, Joshua Tree, CA</span></span></div>
  <!-- one per result; or, when there's nothing to pick -->
  <div class="wt-results__msg"><b>No places match “zzq”</b>Try adding the town, or check the spelling.</div>
</div>
```

- Every field has a visible label.
- Placeholders show an example, never the label.
- Messages say what happened and what to do next, for example "No places match … Try adding the town, or check the spelling".
- `textarea.wt-input` works the same way.
- **A field picked by searching works as in Google or Apple Maps**, and their calendars' Location field. The form shows the choice as a row: its name, and under it a detail (a place's address, so two places with the same name can be told apart). Tapping the row opens a search page in place of the form, with the current name in the field and the cursor at its end, so you edit it rather than retype it. Results fill the page. Tapping one fills it in and comes back; **Cancel** (or Esc) comes back with nothing changed. Nothing typed is ever kept: only a picked result is. A choice that's required (a stop's place) can open on this page, and Cancel there closes the sheet.
- **While the search page is open** the sheet takes the whole screen on a phone (`.wt-modal.is-full`), as a maps app's sheet rises when you search, so the results show above the keyboard. The search bar stays at the top as the results scroll.
- **Results are options** (`.wt-option`, below), the same rows as the type list. Each shows the marker of the type the place would get, so the type's guess is never a surprise. The part of the name that matches what's typed is `.wt-option__match`.
- **Keyboard:** ↑ ↓ move the grey row (`aria-selected`, with `aria-activedescendant` on the input), Return picks it, Esc is Cancel. Keep focus in the input while a result is tapped: `preventDefault()` on the results' `mousedown`.
- **While it searches**, the spinner shows in the field and the last results stay on the page, so the list doesn't flash.
- `ul.wt-results` with `.wt-results__item`, `__name` and `__detail` (the list under the field before 4.6.0) are still in the stylesheet, though neither the app nor the prototype uses them. They can go in the next major version.

### Marker `.wt-marker`

A stop's type icon on its type's color, shaded from that color (lighter at the top, darker at the bottom, the same hue throughout), so it reads as a solid, tappable object like a maps app's marker. The same marker sits on the timeline's rail, in the day list, in the Type picker and in place search. On the map, a stop's [pin](#map-pin-wt-pin) has the same color but carries its number instead of the icon.

```html
<i class="wt-marker" role="img" aria-label="Restaurant" style="--wt-kind-color: var(--wt-kind-restaurant)">${icon('utensils')}</i>
<i class="wt-marker wt-marker--sm" role="img" aria-label="Restaurant" style="--wt-kind-color: var(--wt-kind-restaurant)">${icon('utensils')}</i>
```

Every type has its own color, so no two look alike. The colors follow maps apps where they can; where those use blue (airports, gas), Waythread uses the nearest hue that isn't the route's.

| Type | Icon | Color | Light / dark |
| --- | --- | --- | --- |
| Place | `pin` | `--wt-kind-place`: grey | `#78746d` / `#b4b0aa` |
| Hotel | `bed` | `--wt-kind-hotel`: purple | `#b24acf` / `#d785ef` |
| Airport | `plane` | `--wt-kind-airport`: indigo | `#7250e2` / `#8c80ee` |
| Gas | `fuel` | `--wt-kind-gas`: petrol | `#0a6783` / `#3292b3` |
| Restaurant | `utensils` | `--wt-kind-restaurant`: orange | `#d65b0f` / `#fd862e` |
| Café | `cup` | `--wt-kind-cafe`: coffee brown | `#89552a` / `#aa7b54` |
| Attraction | `star` | `--wt-kind-attraction`: teal | `#139996` / `#1ed1cd` |
| Viewpoint | `camera` | `--wt-kind-viewpoint`: lime | `#789310` / `#b6dd1e` |
| Nature | `tree` | `--wt-kind-nature`: green | `#0e844c` / `#17b55f` |
| Museum | `museum` | `--wt-kind-museum`: pink | `#df3c8c` / `#f96da4` |
| Shopping | `bag` | `--wt-kind-shopping`: yellow | `#a98410` / `#edbe1c` |

- Set `--wt-kind-color` on the marker or on a parent, to `var(--wt-kind-<kind>)`. Without one, the marker is grey.
- The colors are about as light as each other, so no type looks more important than another; what matters more (a late drive, now) is louder than any of them.
- `--sm` (20px) is for the day list. The default is 30px.
- `.wt-option__meta`, after `__text`, puts a short value on the right of an option, such as a way's time (`17 min`).
- `--travel` is a way of getting somewhere (Drive, Walk, Bike, Transit, Flight) in the list of them: flat `--wt-kind-drive` grey with no shading, like a drive's car on the rail, so a way never looks like a stop type. `<i class="wt-marker wt-marker--travel">${icon('walk')}</i>`
- The `aria-label` names the type, so color is never the only signal.

### Timeline `.wt-tl`

The core of the product: one day of the plan, down a single rail. Stops and drives alternate.

```html
<div class="wt-tl">
  <div class="wt-tl-stop" tabindex="0" role="button" aria-pressed="false" style="--wt-kind-color: var(--wt-kind-restaurant)">
    <span class="wt-tl-rail"><i class="wt-marker wt-tl-marker" role="img" aria-label="Restaurant">${icon('utensils')}</i></span>
    <span class="wt-tl-name">Cloudcroft</span><span class="wt-tl-notes"><span class="wt-tl-note">Lunch</span></span>
    <span class="wt-tl-time">12:30<span class="wt-tl-meridiem">PM</span></span>
  </div>
  <div class="wt-tl-drive is-late">
    <span class="wt-tl-rail"><i class="wt-tl-car">${icon('car', 14)}</i></span>
    <span class="wt-tl-drive__body">
      <span class="wt-tl-drive__what"><b>58 min</b> drive</span>
      <span class="wt-tl-drive__late">Arrives 13 min late</span>
    </span>
  </div>
  <!-- more stops and drives -->
</div>
```

- **Rows touch.** Put them straight inside `.wt-tl`, with nothing between, so the rail is one solid hairline (`--wt-border-rail`, 1.5px) from the first marker to the last. Rows have no top or bottom padding of their own, which would break the rail.
- **Surface:** put the timeline on `--wt-surface-raised`. Stop markers are ringed in that color.
- **Stop** (`.wt-tl-stop`): marker, name, time, and optional notes. Nothing else.
  - Set `--wt-kind-color` on the row and the marker.
  - Notes go in one `.wt-tl-notes`, one `.wt-tl-note` per line of meaning ("2 nights", then the stop's note). They sit under the name and run across the time column too, so a long note wraps to the row's full width and its right edge lines up with the times.
  - **The name is one line.** A long one ends in an ellipsis.
  - **On a phone, notes are one line** (inside the `wt-trip` container, under 768px wide): they run together with ` · ` and end in an ellipsis. The selected stop (`is-selected`) shows them in full, with their line breaks; so does every stop on a wider screen.
  - Leave out `.wt-tl-notes` when there are none.
  - **Links in a note can be tapped.** Each shows only its site (`booking.com`), in blue, so a long link doesn't fill the row; tapping it opens the page and doesn't select the stop. Since a link can't sit inside a `<button>`, the row is a `div` with `role="button"`, `tabindex="0"` and `aria-pressed`, like a drive, and Enter or Space selects it.
- **Hotel:** at the start or end of a day, a hotel is a stop row with an empty `.wt-tl-time`. Only check-out morning gets a note ("Check out").
- **The day before's last stop:** with no hotel the night before, a day opens with that stop. In place of a time, `.wt-tl-time__day` says which day it was: "Yesterday", or the weekday ("Sat").
- **Drive** (`.wt-tl-drive`): a car on the rail and "1 hr 49 min drive". The same row is any leg: put the way's icon in `.wt-tl-car` in place of the car and finish the sentence with it ("12 min walk", "25 min bike ride"); a leg with no time (transit, a flight) is just its name in the `<b>`: `<b>Flight</b>`. Tapping it shows its route; Directions to the maps app goes in the add bar (see [the add bar](#trip-header-wt-trip-head-bottom-sheet-wt-sheet-and-add-bar-wt-add-bar)), not in the row.
  - **Hierarchy:** the drive's text is 13px in `--wt-text-tertiary`, its duration medium in `--wt-text-secondary`. Stop names are the only strong text in the list, so the day reads as its stops, with drives as the links between them. The drive you're on darkens its duration to primary and its car to black; a late drive turns both red.
  - **Spacing:** stops get `--wt-tl-pad` (12px) above and below their text; drives are a 32px row. The rail column (`--wt-tl-rail`) is 40px. Change `--wt-tl-pad` on `.wt-tl` to tighten or loosen the list; the markers follow.
  - The car (`.wt-tl-car`) is a marker like a stop's: a 22px circle in `--wt-kind-drive` grey with the `car` icon in `--wt-marker-ink`. Smaller and greyer than any stop, so drives never outrank them. On the selected drive it turns a darker grey (`--wt-kind-drive-current`), on the drive you're on black (`--wt-now`), on a late drive red (`--wt-danger`), and once it's over light grey (`--wt-kind-past`). Never blue: blue is for routes on the map.
  - Give the row `role="button"` and `aria-pressed` while its route is shown.
  - `.wt-tl-drive__go`, a small Directions icon in the time column, is no longer used by the app (since 4.5.0) or the prototype. It can go in the next major version.
  - `__late`: "Arrives 13 min late", with `is-late`.
  - Never add distance or badges.
- **Day heading** (`.wt-tl-day`): the overview, **All days**, puts every day in one timeline, each day's stops under its name. See [All days](#all-days-wt-tl-day).
- **States:**

  | State | On | Means |
  | --- | --- | --- |
  | `is-selected` | a stop | Its pin was tapped, or the row was. Highlighted. |
  | `is-active` | a drive | Its route was tapped, or the row was. Highlighted, like a selected stop. |
  | `is-now` | either | On today, what's happening now: the latest row that has started. Always in the blackest ink: a black ring (`--wt-now`) around a stop's marker or a black car, and its time or drive time primary. Highlighted only while nothing in the list is selected. |
  | `is-past` | either | On today, every row before `is-now`. On an earlier day, every row. Its text turns `--wt-text-past` and its marker or car `--wt-kind-past`. A late drive that's over loses its red: nothing is left to fix. |
  | `is-late` | a drive | The drive is longer than the gap between its two stops. The drive time and the car turn red, even on the row happening now: red outranks everything. |
  | `is-flash` | a stop | A co-editor just changed it. Flashes once. |

  **One highlighted row at most.** A selection takes the highlight; with none, the row happening now has it (the CSS works this out with `:has()`, so scripts set the classes as before). The highlight is the same for stops and drives: `--wt-surface-current` behind the row, no outline, no blue. Text in a highlighted row steps up one ink: a stop's time and a drive's duration turn `--wt-text-primary`, and tertiary text (AM/PM, the rest of the drive) turns secondary, which keeps it at 4.5:1 on the darker grey. A selected drive's car turns `--wt-kind-drive-current`, and its Directions icon turns `--wt-text-primary`. Color stays on the rail, where the map's colors already are.

  **Now is ink, not color.** The row happening now keeps its black ring or car and its primary time even while another row is selected, so the day's position is never lost; only the grey background moves to the selection. It's not tinted blue or any other color: a colored highlight is louder than the information it marks.

### All days `.wt-tl-day`

The overview: every day of the trip on one page, before the first day. Each day's stops, and the drives between them, go under a heading with the day's name.

```html
<div class="wt-tl">
  <button class="wt-tl-day" aria-label="Fri, Nov 20. Open this day">
    <span class="wt-tl-day__name">Fri, Nov 20</span><span class="wt-tl-day__open" aria-hidden="true">View day</span>
  </button>
  <button class="wt-tl-stop">…</button>   <!-- the day's stops… -->
  <div class="wt-tl-drive">…</div>       <!-- …and the drives between them -->
  <button class="wt-tl-day" aria-label="Sat, Nov 21. Open this day">…</button>
  <!-- … -->
</div>
```

- **The heading** is a row in the timeline with **View day** on the right (`.wt-tl-day__open`, caption size in `--wt-text-link`; secondary ink on a past day): tapping it opens that day. It's in words, not a `forward` icon, since the day bar's ‹ › sit just above it and step through days instead. It's a label, not a name: `--wt-type-overline` in grey capitals (`text-transform` and `--wt-tracking-caps`; the text stays "Fri, Nov 20" for screen readers), starting at the list's left edge, where the markers start. Stop names are larger, black and indented past the rail, so a date never reads as a stop. It's at least `--wt-size-touch` tall, with its text at the bottom, next to the day's first stop.
- **It isn't on the rail.** Each day's rail runs from its first stop's marker to its last; a day with one stop has no rail.
- **Stops and the drives between them,** as on a day: marker, name, time, and `1 hr 36 min drive`. Notes are left to the day's own page, and so are the hotel you wake up at and go back to, with the drives to and from it (the map still draws every drive). A day's rows start and end with a place, never a drive, so its rail runs from marker to marker. A hotel keeps its nights on its check-in day, and check-out morning is a row with `Check out`. A day with no stops of its own, in the middle of a stay, shows the hotel you wake up at.
- `is-selected`, `is-now` and `is-past` work as on a day. A past day's heading gets `is-past` and turns `--wt-text-past` with its stops.

### Day bar `.wt-day-bar` and day list `.wt-day-list`

The day bar sits at the top of the sheet and steps through the trip one day at a time, with All days before the first day. Tapping the day opens the day list in a modal sheet.

```html
<div class="wt-day-bar">
  <button class="wt-icon-btn wt-day-bar__step" aria-label="Previous day">${icon('back')}</button>
  <button class="wt-day-bar__title" aria-label="Today, Nov 21. Pick a day">
    <span class="wt-day-bar__label">Today, Nov 21${icon('chevron-up-down')}</span>
  </button>
  <button class="wt-icon-btn wt-day-bar__step" aria-label="Next day">${icon('forward')}</button>
</div>

<ul class="wt-day-list">
  <li><button class="wt-day-list__item" aria-current="date">
    <span class="wt-day-list__name">Today, Nov 21</span>
    <span class="wt-day-list__kinds"><!-- .wt-marker--sm for each place --></span>
  </button></li>
</ul>
```

- The title says "Today, Nov 21" on today, so it's easy to find your way back. Other days are "Sat, Nov 21", and the overview is "All days".
- **‹ and › are round buttons on a grey disc** (32px of `--wt-surface-hover`, drawn by `::before` inside the 44px button, so the button keeps its size and its place on the columns). The day has a `chevron-up-down` picker glyph. The two look different because they do different things: step, or pick from a list.
- Disable the previous arrow on All days and the next arrow on the last day.
- The day list shows All days, then every day, with up to six small markers: the day's stops in order, then the hotel you sleep at. `aria-current="date"` marks the open day (`"page"` on All days).

### Picker `.wt-picker`, options `.wt-options` and check-out

**Every choice from a list is a picker.** A field that takes one of a set of named options is a row that shows the current choice; tapping it opens the options on a page of the sheet. A stop's **Type** (11 options) and Account's **Maps app** (2) work the same way. However few the options, there are no inline radio lists, `<select>`s, segmented controls or switches between named choices: one pattern, so every choice looks and behaves the same, and a sheet stays one column of fields.

```html
<div class="wt-field"><span class="wt-field__label" id="kind-label">Type</span>
  <button class="wt-picker" aria-describedby="kind-label">
    <i class="wt-marker" style="--wt-kind-color: var(--wt-kind-hotel)">${icon('bed')}</i>
    <span class="wt-picker__value">Hotel</span>${icon('forward', 18)}
  </button>
</div>

<!-- The types page, shown in place of the form (hide the form; don't remove it) -->
<div class="wt-modal__head wt-modal__head--sub">
  <button class="wt-icon-btn" aria-label="Back">${icon('back')}</button>
  <h2 class="wt-modal__title">Type</h2>
</div>
<ul class="wt-options" role="radiogroup" aria-label="Type">
  <li><button class="wt-option" role="radio" aria-checked="true">
    <i class="wt-marker" style="--wt-kind-color: var(--wt-kind-hotel)">${icon('bed')}</i>
    <span class="wt-option__text"><span class="wt-option__label">Hotel</span>
      <span class="wt-option__detail">Check-in and check-out</span></span>${icon('check', 18)}</button></li>
  <li class="wt-options__sep" role="presentation"></li>   <!-- between sections -->
  <!-- one per type -->
</ul>

<!-- A picker whose options have no marker: .wt-picker--text, and options without one -->
<div class="wt-field"><span class="wt-field__label" id="maps-label">Maps app</span>
  <button class="wt-picker wt-picker--text" aria-describedby="maps-label">
    <span class="wt-picker__value">Google Maps</span>${icon('forward', 18)}</button></div>

<div class="wt-modal__head wt-modal__head--sub">
  <button class="wt-icon-btn" aria-label="Back">${icon('back')}</button>
  <h2 class="wt-modal__title">Maps app</h2>
</div>
<p class="wt-modal__text">Places and directions open in this app. Saved on this device.</p>
<ul class="wt-options" role="radiogroup" aria-label="Maps app">
  <li><button class="wt-option" role="radio" aria-checked="true">
    <span class="wt-option__text"><span class="wt-option__label">Google Maps</span></span>${icon('check', 18)}</button></li>
  <li><button class="wt-option" role="radio" aria-checked="false">
    <span class="wt-option__text"><span class="wt-option__label">Apple Maps</span></span>${icon('check', 18)}</button></li>
</ul>

<label class="wt-field">   <!-- hidden unless it's a hotel -->
  <span class="wt-field__label">Check-out</span>
  <input class="wt-input" type="datetime-local" value="2026-11-22T11:00" min="2026-11-21T00:00" max="2026-12-20T23:59"></label>
```

- **The row** (`.wt-picker`) has the field's label above it, like any field, and shows the current choice with a `forward` chevron. If the options have markers (the types), the row shows the current one's; if not, use `.wt-picker--text`.
- **The page** takes the place of everything else in the sheet (hide it; don't remove it), and the sheet scrolls to its top:
  - A sub-head (`.wt-modal__head--sub`) with **Back** and the field's label as its title.
  - Optionally, one `.wt-modal__text` line on what the choice affects, when the label alone doesn't say ("Places and directions open in this app").
  - A `ul.wt-options` with `role="radiogroup"`, one `.wt-option` with `role="radio"` per choice; the current one is `aria-checked="true"` (grey, with its check).
- **Picking applies it at once** and slides back to the sheet, which shows the new choice in the row; there's no Save or Done, and no toast. **Back** slides back with nothing changed. The sheet returns to where it was scrolled.
- **Focus** goes to the checked option when the page opens, and back to the row when it closes. ↑ ↓ move between options.
- **On a computer (768px and up) the options drop down as a menu** (`.wt-menu`) under the row instead of taking over the sheet, since a page and a Back button are slow with a mouse. It's the same page, moved into the field: its Back head goes, its intro line stays, smaller, and rows are 36px. Click the row to open it (its chevron points down there), click an option to pick it; Esc, a click outside, or tabbing away closes it without changing anything, and Esc doesn't close the sheet. Give the row `aria-haspopup` and `aria-expanded`. Same options, same check, same keys: only the way in and out changes.
- **Markers and details:** give options a marker only when every option has one (types do; maps apps don't). A detail line only where a choice changes something else: Hotel's "Check-in and check-out".
- **Type** keeps the stop sheet short this way, so the map stays in view above it.
- In the app, `optionHTML`, `choicePageHTML` and `choicePage` in `app/web/app.js` build and wire any picker, as a page on a phone and a menu on a computer; use them for a new one.
- Type starts as a guess from the place's name and category, until someone picks one.
- **Option** (`.wt-option`) is one row for every choice in a list: marker, label over an optional detail, and a check. The type list and search results are both made of it. The grey row means "this one", as a selected row does in the timeline: the set type in a radiogroup (`aria-checked`, with its check), the one Return picks in a listbox (`aria-selected`). Rows are at least 44px tall.
- **The types** come in sections a traveler thinks in, split by `.wt-options__sep`: Place; Hotel, Airport, Gas; Restaurant, Café; Attraction, Viewpoint, Nature, Museum, Shopping. A detail line only where a type changes the form: Hotel's "Check-in and check-out". ↑ ↓ move between types.
- **One time for a stop: Arrive**, when you get there. There's no leave time: the drive after a stop sets off just in time for the next one.
- **Check-out** shows only for a hotel, under Check-in, and is a day and time like it. Arrive becomes Check-in: 3:00 PM for a new hotel. The nights are the days between the two, so there's no separate Nights field: pick the day you leave. Check-out is after check-in, as early as the same day (0 nights, for a stay that starts after midnight), and at most 30 nights later (`min` is the check-in, `max` 30 days on); a day after that, or an empty field, goes back to the last good one when you leave the field. 11:00 AM unless someone sets another time. Moving check-in keeps the check-out day while that still leaves 0–30 nights.
- **Date and time fields** (`.wt-input` on `date`, `time` and `datetime-local`) are drawn like any other field on iPhone, so they read from the left and stay inside the sheet, rather than Safari's centred control, which is wider than the sheet.
- **`.wt-input-group`** is a `.wt-input` box with a fixed `__prefix` and a bare `<input>` after it. Make the box a `<label>` so a tap anywhere opens the input, and label the input with `aria-labelledby`.
- `.wt-nights` (the stepper), `.wt-field-row` and `.wt-input-group` are no longer used: Check-out became a day and time, which replaced the stepper and the day shown before the time. They can go in the next major version.
- `.wt-kinds`, a grid of every type, is no longer used: the app and the prototype both use the picker. It can go in the next major version.

### Trip header `.wt-trip-head`, bottom sheet `.wt-sheet` and add bar `.wt-add-bar`

```html
<header class="wt-trip-head">
  <a class="wt-icon-btn" href="#/" aria-label="All trips">${icon('home')}</a>
  <h1 class="wt-trip-head__name">White Sands, NM</h1>
  <button class="wt-icon-btn wt-trip-head__status" aria-label="Available offline">${icon('saved')}</button>   <!-- .is-offline with cloud-off -->
  <button class="wt-icon-btn" aria-label="Trip settings and sharing">${icon('settings')}</button>
</header>
<section class="wt-sheet" aria-label="Plan">   <!-- .is-full, or half with no class -->
  <div class="wt-sheet__top">
    <button class="wt-sheet__grab" aria-label="Show the whole day"></button>
    <div class="wt-day-bar">…</div>
  </div>
  <div class="wt-sheet__body wt-tl"><!-- the day's timeline --></div>
  <div class="wt-add-bar"><button class="wt-btn wt-btn--primary wt-btn--block">${icon('plus')}Add stop</button></div>
</section>
```

With a stop selected, the add bar holds Open in Maps, a round Edit stop and a round `+`:

```html
<div class="wt-add-bar">   <!-- .is-morphing while it changes set -->
  <a class="wt-btn wt-btn--primary wt-btn--block" href="…" target="_blank" rel="noopener">${icon('map')}Open in Maps</a>
  <button class="wt-btn wt-btn--secondary wt-btn--icon" aria-label="Edit stop">${icon('edit')}</button>
  <button class="wt-btn wt-btn--secondary wt-btn--icon" aria-label="Add stop">${icon('plus')}</button>
</div>
```

- **The header** is one row: home, the trip's name, settings. The name is always in view. It stays quiet next to the list: `--wt-size-trip-head` (44px) tall, the name in `--wt-type-context` and `--wt-text-secondary`, the icons 20px in `--wt-text-secondary`. Floating, it's frosted (`--wt-surface-raised` at 80% with a backdrop blur) with `--wt-shadow-float`; docked and in the side panel it's solid. On a phone it's a card floating over the map, like a maps app's from/to card, and the map runs under it. Add `.is-docked` when the sheet is full: it goes flat across the top and joins the list. Its bottom edge is the same either way, so the full sheet's height doesn't change when it docks.
- **The sheet** is white (`--wt-surface-raised`) and sits over the map. On a phone it has two heights:
  - **Half**, the default: one fixed height, the same on every day, for the list to fit exactly three stops (each with one line of notes) and the two drives between them (never more than about 60% of the screen).
  - The list (`.wt-sheet__body`) fades out at an edge with more past it: `.is-more-above` and `.is-more-below`, which the app sets from the scroll position.
  - **Full** (`.is-full`): the whole day, up to the header's bottom edge. The sheet goes square and flat, and the docked header and the list read as one page.
  - It never hides.
- **The offline status** (`.wt-trip-head__status`) sits between the name and settings, and only while it has something to say: `saved` when the trip is saved on this device, `download` while it's saving, and `cloud-off` with `.is-offline` when there's no connection. It's quieter than home and settings (18px, `--wt-text-tertiary`); offline is a step louder (`--wt-text-secondary`), since changes won't save. Its `aria-label` names the status ("Available offline", "Saving for offline", "Offline"), and a tap explains it in a toast. It isn't an action, so it's the one icon-only button whose icon isn't a universal one.
- **Moving it is dragging,** as in a maps app: the grab handle, the day bar, or the list itself. Below full, dragging the list moves the sheet rather than scrolling it, and the list can't be scrolled by hand at all (`touch-action: none` and `overflow: hidden`): your code scrolls it, to keep the focused row in its middle. At full, the list scrolls; pulled down from its top, it shrinks the sheet. A flick goes on to the other height; a slower drag settles at the nearer. Add `.is-dragging` while a finger is moving it.
- **Taps:** the grab handle is a button that switches between half and full. Choosing a stop or a drive on the whole day brings the sheet down to half. No other tap resizes the sheet.
- **The map:** a new height re-frames the map for what's left of it, unless the map has been touched since it was last framed. Selecting a pin or showing a route opens the sheet to half. Zooming doesn't move the sheet.
- The top holds the grab handle and the day bar, with a 1px `--wt-border-default` line under it that divides the day bar from the list (left out when the day bar is hidden, on an empty trip). The handle is laid over the day bar's top edge rather than taking a row of its own; the day bar's buttons sit above it and take their own taps, and a tap anywhere else on that strip is the handle's. People live in trip settings.
- The add bar comes after `.wt-sheet__body`, not inside it. It's static, not sticky.
- **The add bar follows the selection.** With nothing selected it's Add stop. Tapping a stop in the list selects it rather than opening it, and the bar becomes **Open in Maps** (the place in the maps app picked in Account, the same one Directions opens; `<a class="wt-btn wt-btn--primary wt-btn--block" target="_blank">`), then a round white **Edit stop** with only its pencil, then a round `+`, so adding is always one tap away. Seeing what a place is (its photos, reviews and hours) is what you most often want from a stop on the road, so it's the black button; editing is one tap to its right. A stop you've just added is selected, so it's there to check the moment you save. Tapping a drive shows its route, and the bar becomes Directions (a link to the maps app, as Open in Maps), then a round white button with the leg's way (`car`, `walk`…) that changes it, then the same `+`. A flight has no directions, so its black button is Open in Maps, for where it lands. It's always one primary button. Every button in the bar is a pill (the 44px ones are circles), so the row reads as one set.
- **Changing set morphs** (see [Motion](#elevation-motion-layers)): Add stop shrinks to the right into the `+`, Open in Maps grows from the left and Edit stop grows in between; clearing the selection runs it back. Open in Maps and Directions stretch into each other.
- Tapping a selected stop or a shown drive again keeps it selected, and at half nothing animates: it's already in the middle.
- **One row is the half list's focus**, and it sits in the middle of the list: the selected row (`.is-selected` or `.is-active`), or else, on today, the `is-now` row. When the sheet changes height and the list has to scroll, move both together, on one timeline, so the row goes straight to the middle. The app does this frame by frame and turns off the sheet's height transition.

**On a wide screen it's a side panel.** Make the element that holds the header, map and sheet a size container named `wt-trip`:

```css
.trip { position: relative; height: 100dvh; container: wt-trip / inline-size; }
#map { position: absolute; inset: 0; }   /* under the header card on a phone */
@container wt-trip (min-width: 768px) { #map { left: var(--wt-size-panel); } }   /* the map sits beside the panel */
```

Pad the top when you fit the map on a phone, so pins stay clear of the header card. From 768px wide, the header and the sheet stack into a full-height panel on the left, `--wt-size-panel` wide, and the map fills the rest. Your code clears the sheet's `height` there: no snapping, no dragging, and the grab handle hides. Without the `wt-trip` container, the header floats and the sheet is a bottom sheet at every width.

`.wt-view-toggle` (Map/List in the header) is unused since 4.1.0: the heights are reached by dragging, as in a maps app. It can go in the next major version.

### Map buttons `.wt-map-bar` and credit `.wt-credit`

```html
<nav class="wt-map-bar">
  <a class="wt-icon-btn wt-map-btn" href="#/" aria-label="All trips">${icon('home')}</a>
  <button class="wt-icon-btn wt-map-btn" aria-label="Trip settings and sharing">${icon('settings')}</button>
</nav>

<p class="wt-credit">Map © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors</p>
```

- `.wt-map-bar` floated home and settings over the map's top corners. The trip header replaced it in the app and the prototype, so it's no longer used and can go in the next major version.
- The map's credits go at the bottom of trip settings, not on the map.

### Whole day `.wt-map-btn`

```html
<button class="wt-icon-btn wt-map-btn" aria-label="Show the whole day on the map" title="Whole day">${icon('fit')}</button>
```

- A round icon button floating over the map, 44px, the touch size. **Whole day** fits the day's route back in view, as a maps app's route overview button does. It's the one icon-only button whose icon isn't universal, so it keeps its `aria-label` and a `title` ("Whole day") for hover.
- Your code places it: the app puts it at the map's bottom right, just above the sheet on a phone (`bottom: calc(var(--bottom-h) + var(--wt-space-3))`), one z-index under the sheet so a dragged sheet covers it.
- Keep it on the map, and set `disabled` while it would do nothing: the background stays solid and only the icon greys out, so the map doesn't show through. Whole day is disabled while the map already shows the whole day. Hide it with `hidden` where the map isn't there to fit: over the whole-day list, and while a stop is open.

### Modal sheet `.wt-modal`

```html
<div class="wt-modal-root is-open">
  <div class="wt-modal__backdrop"></div>
  <div class="wt-modal" role="dialog" aria-modal="true">
    <div class="wt-modal__head"><h2 class="wt-modal__title">Edit stop</h2>
      <button class="wt-icon-btn" aria-label="Close">${icon('close')}</button></div>
    <!-- fields -->
    <div class="wt-modal__actions">   <!-- add wt-modal__actions--sticky for a long form -->
      <button class="wt-btn wt-btn--danger">Delete</button>
      <button class="wt-btn wt-btn--primary">Save</button>
    </div>
  </div>
</div>
```

- Slides up from the bottom, for editing one thing.
- **From 768px wide** it's a dialog in the middle of the screen. On the trip screen, while the side panel shows, add `.wt-modal-root--side`: the sheet then covers the panel, so the map stays in view beside it (center the stop being edited).
- **Panel:** add `.wt-modal-root--panel` and leave out the backdrop, for a sheet you work on with the map in view: the stop sheet. Nothing dims or blocks the map. On a phone it's at most 62% of the screen, so the map shows above it; with `--side` it covers the side panel. Use `aria-modal="false"`, and show what's being edited on the map as it changes (the stop's pin at the place picked, with the type chosen). Taps on the map don't change the selection while it's open.
- **Actions:** destructive on the left, the main action on the right.
- **Long forms** (the stop sheet, in a panel only 62% of the screen tall): add `.wt-modal__head--sticky` to the head and `.wt-modal__actions--sticky` to the actions. The fields scroll between them, so Close and Save are always on screen, not below the fold. The sticky actions get a hairline above them and take over the sheet's bottom padding, including the home-indicator inset.
- **Closing:** a tap on the backdrop, the close button or the Escape key closes it. A panel has no backdrop.

### Toast `.wt-toast`

```html
<div class="wt-toast is-visible" role="status">
  <span>Deleted Cloudcroft</span><button class="wt-toast__action">Undo</button>
</div>

<div class="wt-toast wt-toast--rich is-visible" role="status">
  <span class="wt-toast__icon">${icon('cloud-off')}</span>
  <span class="wt-toast__text"><b class="wt-toast__title">You’re offline</b>
    <span class="wt-toast__detail">Showing the plan saved 2 hr ago. To add or change stops, reconnect.</span></span>
</div>

<div class="wt-toast wt-toast--rich wt-toast--error is-visible" role="alert">
  <span class="wt-toast__icon">${icon('alert')}</span>
  <span class="wt-toast__text"><b class="wt-toast__title">Couldn’t save your change</b>
    <span class="wt-toast__detail">Try again in a moment.</span></span>
</div>
```

News at the top of the screen, for a moment: a confirmation, a co-editor's change, an undo, a failure. See **Messages** under [Patterns](#patterns) for which kind to use and how to word it.

| Kind | Looks like | Use for |
| --- | --- | --- |
| Plain | A pill with one short line, maybe an action | "Link copied", "Sam updated Cloudcroft", "Deleted Cloudcroft · Undo" |
| Rich (`--rich`) | A card: an icon, a bold heading, a quieter detail line | A notice that needs a second line: offline, a trip saved for offline, signed in and what happened to your trips |
| Error (`--rich --error`) | Rich, with the icon in red (`alert`, or `cloud-off` with no connection) and `role="alert"` | Something failed: the heading says what, the detail says what to do |

- **Where:** top center. Set `--wt-toast-top` to keep it below something that must stay in reach: on a phone's trip screen it shows just below the trip header.
- **How long:** long enough to read, about a quarter second a word plus a second: at least 3 seconds, 5 with an action (it takes time to reach), at most 8.
- **Held:** while the pointer is on it or focus is in it (reaching for Undo), it stays.
- **Put away:** a tap, or a swipe up, which it follows (it resists going down). The app sets `--wt-toast-drag` and `.is-dragging` while a finger is on it.
- **One at a time.** A new toast replaces the one showing, except that news waits until a toast with an action has gone, so Undo isn't lost to a co-editor's change.
- **Rich:** a card with `--wt-radius-lg`, at most 360px wide, so two lines sit well in it. The detail is `--wt-type-caption` in `--wt-text-inverse-secondary`.
- A plain toast is one short line. If it needs more, make it rich rather than letting a pill wrap.

### Dialog `.wt-dialog`

```html
<div class="wt-dialog-root is-open">
  <div class="wt-dialog__backdrop"></div>   <!-- a tap cancels -->
  <div class="wt-dialog" role="alertdialog" aria-modal="true" aria-labelledby="t" aria-describedby="d">
    <h2 class="wt-dialog__title" id="t">Delete “White Sands, NM”?</h2>
    <p class="wt-dialog__text" id="d">It’s deleted for everyone on the trip. You can undo right after.</p>
    <div class="wt-dialog__actions">
      <button class="wt-btn wt-btn--secondary">Cancel</button>
      <button class="wt-btn wt-btn--destructive">Delete trip</button>   <!-- or --primary when nothing is destroyed -->
    </div>
  </div>
</div>
```

A question before an action that can't be undone, or that other people will notice. It replaces the browser's `confirm()`, which can't be styled, names the site instead of the action, and on a phone looks like a system warning.

- **Small, in the middle, over everything** (`--wt-z-dialog`), sheets included, so a sheet can ask without closing.
- **The title is the question,** naming the thing: "Delete “White Sands, NM”?". The line under it says what happens, and what can still be done ("You can undo right after").
- **Two buttons, the same width:** Cancel on the left, and on the right a button that names the action: "Delete trip", "Make new link", never "OK" or "Yes".
- **Destroys something** (a trip, a guest's trips, an assistant's access): the action is `.wt-btn--destructive` and **Cancel has the focus**, so Return doesn't destroy anything. Otherwise the action is `--primary` and has the focus.
- **Esc** or a tap on the backdrop cancels. Tab stays between the two buttons. Focus goes back where it was.
- Ask only when there's no undo, or when the change reaches other people. Deleting a stop doesn't ask: it has Undo.

### Trip card `.wt-trip-card`

```html
<a class="wt-trip-card" href="#/trip/white-sands">
  <span class="wt-trip-card__map" aria-hidden="true">
    <svg viewBox="0 0 320 128" preserveAspectRatio="xMidYMid meet">
      <path class="wt-trip-card__casing" d="M…"/><path class="wt-trip-card__route" d="M…"/>  <!-- drives along the roads -->
      <path class="wt-trip-card__casing is-estimate" d="M…"/><path class="wt-trip-card__route is-estimate" d="M…"/>  <!-- not looked up yet -->
      <path class="wt-trip-card__ring" d="M160 40h0M180 90h0"/>
      <path class="wt-trip-card__stop" style="--wt-kind-color: var(--wt-kind-hotel)" d="M160 40h0"/>
      <path class="wt-trip-card__stop" style="--wt-kind-color: var(--wt-kind-airport)" d="M180 90h0"/>
    </svg>
    <img class="wt-trip-card__photo" src="…" alt="" loading="lazy">  <!-- add .is-loaded once it loads -->
  </span>
  <span class="wt-trip-card__body">
    <span class="wt-trip-card__text"><span class="wt-trip-card__name">White Sands, NM</span><span class="wt-trip-card__dates">Nov 20 – 22 · <span class="wt-trip-card__when">In 2 weeks</span></span></span>
    <span class="wt-avatar-stack wt-trip-card__people" aria-hidden="true">${avatars}</span>
    <span class="wt-visually-hidden">, with Alex, Sam</span>
  </span>
</a>
<!-- no stops yet -->
<span class="wt-trip-card__map wt-trip-card__map--empty">No stops yet</span>
```

What you need to pick a trip: where it goes, its name and dates, and who's on it.

Put cards on `--wt-surface-sheet`, as the list is: the card is white and set apart by its surface alone, with no border or shadow.

- `__map` is the route, across the top of the card: a 5:2 box on `--wt-surface-map`.
  - `__photo` is a map picture of the route, made at 5:2 so nothing is cut off. It's hidden until it has `.is-loaded`, then fades in over the sketch. If it can't load, remove it and the sketch stays.
  - The `svg` is a sketch of the route, under the picture. Draw it in any units with `preserveAspectRatio="xMidYMid meet"`: lines and dots keep their pixel widths at any card size (`vector-effect: non-scaling-stroke`).
  - `__casing` then `__route`: the drives, in `--wt-route` over `--wt-route-casing`, like routes on the map. Add `.is-estimate` to both for drives not looked up yet: dotted, as on the map.
  - `__ring` then one `__stop` per place, like the map's pins: a dot is a path of no length (`M x y h0`), drawn by its round cap. `__ring` holds every dot, in `--wt-pin-fill` with `--wt-shadow-pin`; each `__stop` sets `--wt-kind-color`.
- `__body`: the name (`--wt-type-name`, as a stop's; one line, cut off with an ellipsis), the dates and `__when` (how soon), and the people as a `.wt-avatar-stack` on the right. The stack's ring follows the card's surface, hovered too. Hide the stack from screen readers and say the names in a `.wt-visually-hidden` span, so the link reads "White Sands, NM, Nov 20 – 22, with Alex, Sam".
- `.is-now`: the trip is under way. `__when` ("Day 2 of 3") is in primary ink, like the row happening now.
- `.is-past`: the trip is over. Its route turns `--wt-route-done`; give its dots `--wt-kind-past`, as past pins have.

### Map pin `.wt-pin`

```html
<div class="wt-pin wt-pin--selected" role="img" aria-label="3. White Sands Visitor Center, Attraction" style="--wt-kind-color: var(--wt-kind-attraction)">
  <b class="wt-pin__num">3</b>
</div>
<!-- a place that isn't a numbered stop: the hotel at either end of a day, or the day before's last stop -->
<div class="wt-pin" role="img" aria-label="Holiday Inn Express Alamogordo, Hotel" style="--wt-kind-color: var(--wt-kind-hotel)">
  <i class="wt-pin__dot"></i>
</div>
<!-- crowded: no room for its number -->
<div class="wt-pin wt-pin--dot" role="img" aria-label="4. Interdune Boardwalk, Nature" style="--wt-kind-color: var(--wt-kind-nature)">
  <b class="wt-pin__num">4</b>
</div>
```

- **A round dot, centered on its place,** like a stop on a transit map: place the element at the place and its center lands there. 24px, ring included (`--wt-pin-size`). It covers its place and little else, so the routes running into it stay visible.
- **Its color is the stop's type** (`--wt-kind-color`, as on a [marker](#marker-wt-marker)), shaded like a marker, in a 2px `--wt-pin-fill` ring that keeps it apart from the route under it.
- **It holds one thing: the stop's number,** in the day's order (on All days, the trip's), in `--wt-marker-ink`. A place that isn't a numbered stop has `.wt-pin__dot` instead.
- **Crowded pins are small dots, all or none.** `--dot` is 14px with no number. If any two pins in view are too close for both to show their numbers (two numbered pins' radii plus 4px), give it to every pin; the app checks after each zoom and pan. Zoomed out, a day is a line of small dots along its route instead of a pile of pins; zoom in and every number comes back at once. Never mix numbered pins and dots: a lone number among dots reads as special. A selected pin always keeps its number.
- **Nothing else.** No name label and no time tag: the list has them. The `aria-label` gives the number, the name and the type, so color is never the only signal.
- Variants: `--selected` (32px, with `--wt-shadow-pin-selected`: the selected stop, and both ends of a route on show) and `--muted` (20px and grey, `--wt-kind-past`, 10px as a `--dot`: on today, a stop that's over; the day before's last stop, where a day with no hotel starts; or, while a route is shown, a stop it doesn't start or end at). The pins still in color are the ones that matter now.
- **A tap target of 36px**, centered on the dot (`::after`), so a small dot is still easy to tap.
- **Put the pins in a `.wt-pins` element** (with Leaflet, the marker pane). While one of them is `--selected`, the rest fade to 55%, keeping their colors, so the selected pin stands out among pins of every type. They fade rather than turn grey, since grey means over.
- Stops at the same place, like a hotel in the morning and at night, share one pin, with the first one's number.
- The map shows only the open day, or the whole trip on All days. Framing a day or a route leaves half a selected pin clear at the edges.

### Sight `.wt-sight`

```html
<div class="wt-sight" style="--wt-kind-color: var(--wt-kind-nature)">
  <i class="wt-sight__marker"><!-- WaythreadIcons.svg('tree', 12) --></i>
  <span class="wt-sight__name">White Sands National Park</span>
</div>
```

- **A place worth seeing, on the map**, as a maps app shows its places once you zoom in: a 20px marker in the type's color (`--wt-kind-color`) with the type's icon at 12px, and the place's name to its right.
- **Placed by its marker's center**, at the place, like a [pin](#map-pin-wt-pin). The name runs to the right, in 12px secondary ink with a halo in `--wt-pin-fill`, so it reads over the light and the dark map. A long name stops at 160px with an ellipsis.
- **Quieter than a pin:** smaller, flat (no marker shading), and never numbered. The trip's pins and routes come first: put sights in a layer under the routes, and leave a place for a sight only where its marker and name clear the pins and the other sights.
- **It's a button.** Give it (or the element holding it) `role="button"`, a tab stop and an `aria-label` that says what tapping does ("Alameda Park Zoo, Attraction. Add as a stop"). Its tap target reaches 8px above and below and 4px to either side.
- It fades in on `--wt-duration-base` when it appears.

### Empty state `.wt-empty`

```html
<p class="wt-empty">Add a flight, a hotel, or a place to see.</p>
```

Say what can go here, in the user's words. No illustrations.

## Patterns

- **The trip screen.**
  - On a phone: `.wt-trip-head` across the top, the map under it, and `.wt-sheet` over the map, at half height or the whole day.
  - From 768px wide: the header and the sheet are a side panel on the left, and the map fills the rest. Modal sheets cover the panel. Fit the map with even padding: nothing covers it.
  - One day at a time, after All days. The day bar steps through them, and the map shows only the open day; on All days, the whole trip.
  - A stop's pin is a dot in its marker's color with its number in the day; where pins in view crowd, they're all small dots with no number. The map has no text. The list says what each pin is: the half list keeps the row in focus in its middle.
  - Tapping a pin selects its stop (`is-selected`). Tapping a route, or its drive in the list, marks the drive `is-active` and shows the route: both ends' pins larger, the map fitted to it, and the drive in the middle of the half list, between its two stops. Tapping the drive again goes back to the whole day.
  - Editing a stop leaves the map in view (a panel), with the stop's pin showing the edit as it happens.
- **Today.** During the trip, the trip opens on today. On any other day, it opens on All days.
  - The row happening now is highlighted (`is-now`), unless another row is selected.
  - Rows before it turn light grey (`is-past`), their routes turn grey (`--wt-route-done`), and their pins mute to grey (`.wt-pin--muted`).
  - The hotel you go back to tonight stays bright.
- **Doesn't fit.** If a drive takes longer than the gap between its two stops, the drive gets `is-late` and says "Arrives 13 min late". That red text is the only warning.
- **Handing off to maps.** Every drive's Directions button, and a stop's Open in Maps button, opens the maps app the person picked in Account: Google Maps unless they chose Apple Maps. Both always open the same one. Directions are never rebuilt in-app.
- **Choosing from a list.** Every choice of one from a set of named options is a [picker](#picker-wt-picker-options-wt-options-and-check-out): a row with the current choice that opens the options on a page of the sheet. Picking applies it and comes back. On a computer the options drop down as a menu instead. A stop's Type and Account's Maps app both work this way; a new choice should too, even with two options.
- **Changes from others.** When a co-editor changes a stop, show a toast naming them ("Sam updated Cloudcroft") and flash the stop once with `is-flash`.
- **Deleting.** Delete right away, then show a toast with Undo. Ask first only when undo isn't possible, such as deleting a whole trip.
- **Messages.** Tell people what happened and what to do next, in the place that fits it:

  | Situation | Where | Example |
  | --- | --- | --- |
  | It worked, quietly | Plain toast, or nothing if the screen already shows it | "Link copied", "Name saved" |
  | It's done, with a way back | Plain toast with an action | "Deleted Cloudcroft · Undo" |
  | Someone else changed something | Plain toast, naming them | "Sam updated Cloudcroft + 2 more" |
  | Something needs explaining | Rich toast | **You're offline** · Showing the plan saved 2 hr ago… |
  | Something failed | Error toast | **Couldn't save your change** · Check your connection, then try again. |
  | A field's input is wrong | Under the field, in red | "Enter a valid email address" |
  | Can't be undone, or reaches others | Dialog | **Delete “White Sands, NM”?** · Cancel / Delete trip |
  | Not available right now | The control greyed out (`aria-disabled`), and a tap explains in a toast | Add stop while offline |

  - An error's heading says what failed ("Couldn't save your change", "Couldn't copy"), never "Error" or "Something went wrong". Its detail says what to do: "Check your connection, then try again", "Too many tries. Wait a minute, then try again", "Try again in a moment". No apologies, no codes.
  - When a failure leaves something to do by hand, set it up: a link that wouldn't copy is selected.
  - Keep headings to a few words, and details to one sentence or two short ones.

## Content

- **Voice:** plain and short, from the traveller's side. Name things the way people do: "stop", "drive", "trip", "people".
- **Formats:**

  | Thing | Format | Example |
  | --- | --- | --- |
  | Time | `h:mm AM` | 10:30 AM |
  | Day | `Ddd, Mmm d` | Fri, Nov 20 |
  | Trip dates | `Mmm d – d` | Nov 20 – 22 |
  | Day, on the day | `Today, Mmm d` | Today, Nov 21 |
  | Drive | `h hr m min drive` | 1 hr 49 min drive |
  | Late drive | `Arrives h hr m min late` | Arrives 13 min late |
  | Notice | `<Person> <did> <stop>` | Sam updated Cloudcroft |
- **Labels:** say what happens. "Add stop", "Save", "Copy", "Delete trip". Avoid "Submit", "OK" and "Confirm".
- **Errors** say what went wrong and how to fix it, with no apology. See **Messages** under [Patterns](#patterns).

## Accessibility

- **Contrast:**
  - Text: 4.5:1 on its background, in both themes. The exception is `--wt-text-past`, on rows that are over, faded on purpose (as they were with opacity before 6.1.0).
  - Large text, icons, focus rings and control borders: 3:1.
  - The demo page checks the key pairs live.
- **Focus:** everything interactive shows a 2px focus ring in `--wt-border-focus`.
- **Touch targets:** anything tapped often is at least `--wt-size-touch` (44px) high. Small icon buttons are 36–40px and never sit next to each other without space.
- **Color isn't the only signal:** a stop's type has an icon and a label as well as a color. A late drive also says "Arrives 13 min late". Past rows fade, and past pins shrink as well as turn grey. The row happening now has a ring or a darker car as well as its highlight.
- **Motion:** every animation respects reduced motion.
- **Forms:** visible labels, and 16px input text so iPhones don't zoom in.

## Contributing

- **Adding a value:**
  1. Add a primitive if the raw value is new.
  2. Add a role token for each theme.
  3. Use the role token in the component.

  Components never use primitives or literal colors.
- **Adding a component:** `.wt-<name>` in `components.css`, a section in this README (markup, variants, rules), and a live example on the demo page.
- **Versioning:** the version at the top of each file follows semantic versioning.
  - **Patch:** fixes.
  - **Minor:** new tokens, components or variants.
  - **Major:** renamed or removed tokens or classes. Note each rename here.

### Added in 9.4.0

- New: `.wt-sight`, `.wt-sight__marker` and `.wt-sight__name`, a place worth seeing on the map with its name ([Sight](#sight-wt-sight)).
- Tokens are unchanged.

### Added in 9.3.0

- New: `.wt-option__meta`, a short value on the right of an option, before its check: how long each way of getting there takes. Secondary ink, tabular numbers.
- Tokens are unchanged.

### Added in 9.2.0

A leg can be a walk, a bike ride, transit or a flight, not only a drive.

- New icons: `walk`, `bike` and `train` (icons v1.6.0). With `car` and `plane`, they're the ways of getting somewhere.
- New: `.wt-marker--travel`, a way in the list of them: a flat grey marker like a drive's car.
- `.wt-tl-car` holds the leg's way's icon, not only `car`.
- Tokens are unchanged.

### Added in 9.1.0

Avatars show the person's Google photo when they have one, over their initial.

- New: `.wt-avatar__img`, a photo inside `.wt-avatar`. The initial and identity color stay underneath while it loads, and if it fails.
- Tokens are unchanged.

### Changed in 9.0.0

Buttons have one look per kind. Copy was an outlined button, but Make a new link and Sign out were grey text and Delete trip was red text, so the same sheet had three kinds of button.

- `.wt-btn--danger` is now the outlined `--secondary` button with a red label, not red text. Its negative margin is gone, and in a `.wt-section` it gets the same spacing as any other control.
- Removed: `.wt-btn--quiet`. Use `--secondary`.
- Removed: `.wt-btn--ghost`. Use `--secondary`.
- Tokens are unchanged.

### Added in 8.2.0

Trip settings and Account were a run of fields, each with a small grey label over a larger paragraph, and two black Copy buttons. They're now sections that all read the same way.

- New: `.wt-section` with `__title`, `__text` and `__hint`, a section of a settings sheet (see [Settings section](#settings-section-wt-section)).
- New: `.wt-btn--quiet`, a grey text button for a rare action.
- New: `.wt-people__meta`, the "(you)" after your name.
- Copy in a settings sheet is `--secondary`, as the button table always said, not `--primary`.
- Tokens are unchanged.

### Added in 8.1.0

Messages work the same everywhere, and confirmations no longer use the browser's `confirm()`.

- New: `.wt-dialog` (`-root`, `__backdrop`, `__title`, `__text`, `__actions`), a question before an action that can't be undone (see [Dialog](#dialog-wt-dialog)).
- New: `.wt-btn--destructive`, the filled red confirm button of a dialog.
- New: `.wt-toast--error`; the toast's `--wt-toast-top` (where it shows), `--wt-toast-drag` and `.is-dragging` (a swipe to put it away). Toasts last as long as they take to read, are held while pointed at or focused, and put away with a tap or a swipe up (see [Toast](#toast-wt-toast)).
- New: the [Messages](#patterns) pattern: which kind of message for which situation, and how to word an error.
- New tokens (tokens 1.12.0): `--wt-action-danger`, `--wt-action-danger-text`, `--wt-text-inverse-danger`, `--wt-z-dialog`.
- New icon (icons 1.5.0): `alert`.

### Changed in 8.0.0

Home's cards showed only a trip's name and dates. They now show where the trip goes and who's on it.

- **`.wt-trip-card` is a column**: the route (`__map`, a 5:2 box) across the top, then `__body` with `__text` (the name and dates) and `__people`. The name and dates must now be inside `__body` and `__text`: a card with them directly inside no longer has its padding. New: `__photo` (a map picture over the sketch), `__casing`, `__route` and their `.is-estimate`, `__ring`, `__stop`, `__map--empty`, `__when`, `.is-now` and `.is-past`. See [Trip card](#trip-card-wt-trip-card).
- **It looks like the list's rows:** no border, set apart from `--wt-surface-sheet` by its white surface; `--wt-radius-md`, as cards are; the name in `--wt-type-name`, as a stop's (was 17px).
- New: `.wt-avatar--more`, the "+N" at the end of a stack that's out of room.
- Tokens are unchanged.

### Added in 7.2.0

Trips can be saved on the device for offline use, and the trip header says when one is.

- New: `.wt-trip-head__status` and `.is-offline` (see [Trip header](#trip-header-wt-trip-head-bottom-sheet-wt-sheet-and-add-bar-wt-add-bar)).
- New: `.wt-btn[aria-disabled="true"]`, a button that's unavailable for now but still explains itself when tapped (see [Button](#button-wt-btn)).
- New: `.wt-toast--rich` with `__icon`, `__text`, `__title` and `__detail`, a two-line notice (see [Toast](#toast-wt-toast)).
- New token (tokens 1.11.0): `--wt-text-inverse-secondary`.
- New icons (icons 1.4.0): `download`, `saved`, `cloud-off`.

### Changed in 7.1.0

The day bar and the All days list had four look-alike chevrons in view, and a lone numbered pin among dots looked special.

- **Day bar:** `.wt-day-bar__step` draws a 32px `--wt-surface-hover` disc behind its arrow (`::before`), and its arrow is in primary ink. The day's chevron is the new `chevron-up-down` icon (icons 1.3.0).
- **Day heading:** `.wt-tl-day` ends in `.wt-tl-day__open` ("View day", in link blue) instead of a `forward` icon.
- **Map pins:** `.wt-pin--dot` goes on every pin or on none (see [Map pin](#map-pin-wt-pin)). The class is unchanged; only how the app uses it.
- Tokens are unchanged.

### Changed in 7.0.0

Zoomed out, the teardrop pins piled up into one blob: each stood 39px tall above its place and covered its neighbors and the routes between them.

- **`.wt-pin` is a round dot centered on its place** (24px, ring included), not a teardrop placed by its tip. Removed: `.wt-pin__shape` (the drop's outline), and the drop's mask on `::before`. Place a pin by its center: with Leaflet, nothing changes (`iconSize: [0, 0]`).
- New: `.wt-pin--dot`, a 14px dot with no number, for a pin with no room for its number. New: `--wt-pin-size`, the dot's whole width.
- `--selected` is 32px (was the drop at 1.5×); `--muted` is 20px, or 10px as a dot (was the drop at .85×).
- `::after` is now the pin's 36px tap target.
- Tokens are unchanged.

### Changed in 6.6.0

Types shared a color with their group (a café looked like a restaurant, a museum like a viewpoint), and the colors were muted: dark and greyish in light, pastel in dark. Now each of the eleven types has a bright color of its own (tokens 1.10.0).

- New: `--wt-kind-hotel`, `--wt-kind-airport`, `--wt-kind-gas`, `--wt-kind-restaurant`, `--wt-kind-cafe`, `--wt-kind-attraction`, `--wt-kind-viewpoint`, `--wt-kind-museum` and `--wt-kind-shopping`, one per type, named for its key. `--wt-kind-place` and `--wt-kind-nature` keep their names. See the table under [Marker](#marker-wt-marker).
- The colors follow maps apps: food orange, coffee brown, hotels purple, nature green, shopping yellow, museums pink. Airports and gas, blue in maps apps, are indigo and petrol, since blue is the route's. Nothing is red.
- Each is as vivid as its hue allows at about one lightness (OKLCH L .62, chroma up to .21; in dark L .74, chroma up to .18). Café, gas, nature and airport sit a little deeper, so the eleven stay apart. `--wt-marker-ink` still meets 3:1 on every one.
- `--wt-kind-travel`, `--wt-kind-stay`, `--wt-kind-food`, `--wt-kind-sight` and `--wt-kind-shop` are unused. Each now points at its group's first type; they stay until the next major version. Nothing was renamed or removed.

### Changed in 6.5.0

A selected pin was hard to find: a quarter larger, among pins of seven colors.

- `.wt-pin--selected` is half as large again (was a quarter), with a deeper shadow, the new `--wt-shadow-pin-selected` (tokens 1.9.0).
- New: `.wt-pins`, the element that holds the pins. While one is selected, the others fade to 55% opacity, in their colors.
- Nothing was renamed or removed.

### Changed in 6.4.0

- **With a stop selected, Open in Maps is the add bar's black button** (`a.wt-btn--primary.wt-btn--block`), and Edit stop is a round white icon button (`wt-btn--secondary wt-btn--icon`, `aria-label="Edit stop"`) to its right, before the `+`. Maps used to be a white button between a black Edit stop and the `+`.
- **A row of buttons morphs from one set to the next** instead of swapping ([Motion](#elevation-motion-layers)). New: `.wt-add-bar.is-morphing` (its buttons placed absolutely while they move) and `.is-ghost` (a fading copy that takes no taps).
- Every `.wt-btn` in the add bar is a pill (was only `--secondary`), so a round button can stretch into a wide one without turning oval.
- Nothing was renamed or removed.

### Changed in 6.3.0

- The `fit` icon is simpler (icons 1.2.1): just the four corners of a frame, without the route line inside.
- `.wt-map-btn:disabled`: Whole day now stays on the map and is disabled, rather than hidden, while the map already shows the whole day. It keeps its solid background, greys its icon and has no hover or press state.
- Nothing was renamed or removed.

### Changed in 6.2.0

The marker gradient looked dirty: white over the top and black over the bottom washed the color out and turned it muddy, and on pins it greyed the white outline.

- `.wt-marker` and `.wt-pin` shade from their own color instead: `--wt-marker-fill` (their type color) and `--wt-marker-shade`, an OKLCH gradient a little lighter and richer at the top and darker at the bottom, in one hue. New tokens `--wt-marker-lift`, `--wt-marker-sink` and `--wt-marker-boost` tune it per theme. Without relative-color support a marker is its flat color.
- A pin's fill is now `::before` (was the SVG's fill plus an `::after` overlay); the SVG draws only the outline, on top. The shadow moved from the SVG to `.wt-pin`.
- Past markers and muted pins are flat grey.
- `--wt-marker-gloss` is unused; it stays until the next major version. Nothing else was renamed or removed.

### Changed in 6.1.0

A new palette, so color and ink say how much a piece of information matters, and the plan leads over the trip's name and the day (tokens 1.7.0).

- **Greys:** the neutral ramp is rebuilt in OKLCH, one warm hue, with even steps that are fine at both ends and wide in the middle. New step: `gray-250`. Each ink has a rank and a contrast (see [Greys](#greys)). `--wt-text-tertiary` now passes 4.5:1 on the sheet's grey too. The roles that used greys from outside the ramp now use it: `--wt-surface-inverse` (`gray-850`), `--wt-route-done` (`gray-350`), `--wt-marker-ink` (`gray-0`, `gray-950` in dark). `--wt-border-rail` is `gray-250`, so the rail shows through a highlighted row.
- **Stop types** share one lightness and similar chroma. The magenta, orange and violet used to outshine the grey place and the green; now none outranks another, and red and black are louder than all of them. Dark-theme food is amber, clear of red.
- **Red** is a little lighter in dark (`red-300`), so it passes 4.5:1 on the highlighted row, and a late drive's car is red too.
- **Now is the blackest ink** (`--wt-now`): a black ring around the marker, in place of a ring in the type's color, or a black car. It stays while another row is selected. The grey background is still the one highlight. Never blue or tinted.
- **What's over is grey:** `--wt-text-past` replaces the 45% opacity on past rows, and `--wt-kind-past` the faded type color on their markers and cars. A late drive that's over loses its red. Muted map pins are grey (`--wt-kind-past`) at 85% opacity, instead of their type color at 50%.
- `--wt-type-context` (15 / 20, 500) is new: the trip's name (`.wt-trip-head__name`) and the day bar (`.wt-day-bar__label`) use it, in `--wt-text-secondary`. Both used to be as strong as the stops or stronger (the day bar was 18px semibold in black). The day bar's arrows are `--wt-text-secondary` too. `--wt-type-title` is now for modal titles only.
- `--wt-marker-gloss` is new: a gradient over `.wt-marker` and `.wt-pin` (as `::after`), lighter at the top and darker at the bottom, as on Apple Maps' markers. A marker's color is now set with `background-color`. A drive's car (`.wt-tl-car`) stays flat, so drives stay quieter than stops.
- Added: `--wt-text-past`, `--wt-now`, `--wt-kind-past`, `--wt-marker-gloss`, `--wt-type-context`. Nothing was renamed or removed.

### Changed in 6.0.0

- **The sheet is back to half and full on a phone.** Compact (5.2.0) is gone: half, with the focus's neighbors in view and the add bar, was preferred. Half is the default again and is sized from the list's rows, as in 5.1.0.
- Removed: `.wt-sheet.is-peek` and `.is-peek-row`. A sheet is half (no class) or `.is-full`.

### Changed in 5.2.0

- **The sheet has two heights on a phone:** compact (`.is-peek`, now the default: the day bar, the focus row and the add bar) and full (`.is-full`). The half height, with no class, is gone: once compact showed the focus and the map numbered the stops, half only added the focus's neighbors.
- Compact keeps the add bar (Add stop, Edit stop and Maps, or Directions) in the layout; only the rows other than `.is-peek-row` hide. Its tap target to open the whole day is the sheet's top.
- With half gone, its height measured from the list's rows (5.1.0) goes too; 5.1.0's denser rows (one-line names and notes on a phone) make compact's row shorter instead.
- A compact sheet whose row is a drive also shows the stops before and after it, both `.is-peek-row`: the drive alone (`3 hr 26 min drive`) didn't say where it went.
- Nothing was renamed or removed.

### Changed in 5.1.0

More of the plan fits in a half sheet on a phone: three stops and the drives between them, where it used to be about one and a half.

- `.wt-tl-name` is one line, with an ellipsis.
- On a phone (`wt-trip` under 768px), an unselected stop's `.wt-tl-notes` are one line, joined with ` · `, with an ellipsis. The selected stop and wider screens show them in full.
- `--wt-tl-rail` is 40px (was 48px), so names have more room. To keep the columns lined up, `.wt-day-bar` pads 8px on the left (was 12px) and nothing below (was 8px; `.wt-sheet__top` pads it now), and `.wt-trip-head` has no left padding floating and 12px docked and in the side panel (was 4px and 16px), with no gap before `__name`.
- `.wt-sheet__grab` is laid over the day bar's top edge (16px, absolutely placed) instead of taking a 22px row of its own. `.wt-sheet__top` pads 14px on top and 8px below, and has a hairline (`--wt-border-default`) under it, between the day bar and the list.
- The trip header is quieter and smaller: `--wt-size-trip-head` is 44px (was 56px), `__name` is 15px (was 17px), its icons are 20px in `--wt-text-secondary` at every width, and floating it's frosted with `--wt-shadow-float` (was solid with `--wt-shadow-card`).
- `.wt-add-bar` pads 8px above and below Add stop, or the safe area below it if that's taller (was 12px, plus the safe area).
- Nothing was renamed or removed.

### Fixed in 5.0.1

- `.wt-field[hidden]` is hidden. `.wt-field`'s `display: block` used to override the `hidden` attribute, so the stop sheet showed a hotel's Check-out on every stop.
- `.wt-tl-time__day` is also the line under a stop's time that says when you leave ("to 4:15 PM"). No new class.
- Nothing was renamed or removed.

### Changed in 5.0.0

- **Map pins are teardrops with a number** instead of a stop's marker with its icon ([Map pin](#map-pin-wt-pin)). New: `.wt-pin__shape`, `.wt-pin__num`, `.wt-pin__dot`. `.wt-pin` is now the pin itself, 30 × 39px, placed by its tip.
- **The map carries no text.** Removed: `.wt-pin__marker` (the marker inside a pin), `.wt-pin__label` and `.wt-pin__label--below` (a selected pin's name), and `.wt-route-tag`, `.wt-route-tag__car` and `.wt-route-tag__late` (a shown drive's time). Their content is in the list.
- Removed the token `--wt-map-label`, the background of those labels, which nothing else used.
- **A peek shows one row** under the day bar, `.is-peek-row` ([Bottom sheet](#trip-header-wt-trip-head-bottom-sheet-wt-sheet-and-add-bar-wt-add-bar)), instead of the day bar alone: with no text on the map, the row is what says what you're looking at.

### Added in 4.9.0

- The add bar with a stop selected gains **Maps** (`a.wt-btn.wt-btn--secondary`) between Edit stop and `+`. No new class.
- `.wt-menu`: on a computer, a picker's options drop down under it as a menu instead of taking over the sheet. A picker with `aria-haspopup` turns its chevron down there.
- **Every choice from a list is a picker** ([Picker](#picker-wt-picker-options-wt-options-and-check-out)): a row showing the current choice that opens the options on a page of the sheet. Account's Maps app, first a list in the sheet, became one, like a stop's Type. No new class.
- In the add bar a secondary button is a pill, like the primary beside it, instead of the 12px corners it has elsewhere; the `+` stays round.
- `.wt-tl-note a`: a link in a stop's note, in blue. Stop rows are now a `div` with `role="button"` (a link can't sit in a `<button>`); `.wt-tl-stop` styles either.
- Nothing was renamed or removed.

### Fixed in 4.8.1

Icons and text line up in columns. Before, the header's home icon, the day bar's ‹ and the timeline's markers sat at three different positions, and on the Type page the back button and title sat left of the markers and names under them.

- `.wt-trip-head`: home and settings are centred on the rail and the Directions column, and `__name` starts with the stop names. Docked and in the side panel it pads by `--wt-space-4`, so its contents stay put as it docks.
- `.wt-day-bar` pads 12px on the left, centring ‹ on the rail.
- `.wt-modal__head`: Close is centred on the options' check column; `--sub` centres Back on their markers and starts the title at their names.
- `.wt-picker`: its marker and chevron are on the same columns.
- `.wt-results` no longer pulls its rows 8px past the field. Markers sit under the search icon, and the search icon's extra space starts the typed text where result names start.
- `.wt-btn--danger` has a negative left margin of `--wt-space-1`, so its text starts at the content edge.
- `.wt-tl-day` pads 16px on the right, centring its › on the Directions column.
- Nothing was renamed or removed.

### Added in 4.8.0

A quieter type hierarchy: fewer weights, and a third ink. Before, the trip name, the day, every stop name, every time, every drive time and the button were all semibold or bold, so nothing led.

- Weights (tokens 1.6.0): `title` and `heading` 700 → 600; `name` 600 → 500; `time` 600 → 400; `label` 600 → 500; `micro` 600 → 500. `display` stays 700. `.wt-btn--primary` and `.wt-avatar` set 600 themselves.
- `--wt-text-tertiary` is new, for detail you look for rather than read: drives, AM/PM, "Yesterday", the credit line, the day bar's and picker's chevrons. `--wt-text-secondary` is a step darker to make room for it (light `gray-600`, dark the new `gray-350`), which also takes notes on the highlighted row from 4.2:1 to 5.7:1.
- The highlighted timeline row steps its text up one ink: the stop's time turns primary, as the drive's duration already did, and tertiary turns secondary.
- `.wt-option__label` is regular (was 500), and its `__match` 600 (was 700). `.wt-toast__action` and a checked `.wt-kinds__item` are 500 (were 600). The drive duration `b` is 500 (was 600). `<b>` and `<strong>` are 600 in `wt-base`.
- Nothing was renamed or removed.

### Added in 4.7.0

- `.wt-tl-day`, with `__name`: a day's heading in the All days overview, which opens the day. Each day's rail stops at its heading.
- Tokens (tokens.css 1.5.0): `--wt-type-overline` and `--wt-tracking-caps`, for the day headings.
- Nothing was renamed or removed.

### Added in 4.6.0

Place search and the type list, redesigned as one system.

- `.wt-option` is now the row for every choice: `__text`, `__detail` and `__match` are new, and `aria-selected` and `aria-checked` share the grey "this one" row (the checked type is no longer bold). `.wt-options__sep` splits a list into sections.
- A search page, as in Google or Apple Maps: `.wt-search-bar` (with `__cancel`), `.wt-search` (with `__clear`), `.wt-spinner`, and `.wt-results` of options or a `__msg`. It replaces the list under the field, which pushed the form down.
- `.wt-picker--text`, with `__name` and `__detail`: a picker row with no marker and a second line, for the place.
- `.wt-modal.is-full`: the sheet at full height, while a search page is open.
- Nothing was renamed or removed. `.wt-results__item`, `__name` and `__detail` stay for the prototype.

### Fixed in 4.5.1

- Below full, `.wt-sheet__body` is `overflow: hidden`, so a wheel or trackpad can't scroll the half list either; the app scrolls it. From 768px wide it scrolls as before.
- Peeking, the list and the add bar hide once the sheet has slid down, instead of as it starts.
- Nothing was renamed or removed.

### Added in 4.5.0

- The highlighted timeline row is easier to see: `--wt-surface-current` is `gray-200` in light and the new `gray-750` primitive in dark (tokens 1.4.0).
- Drives lose their Directions icon in the app: tapping a drive puts a Directions button in the add bar instead. `.wt-tl-drive__go` stays for the prototype.
- Nothing was renamed or removed.

### Added in 4.4.0

- `.wt-map-btn` is in use again, for Whole day: it now hides with `hidden` and has a hover state.
- The `fit` icon (icons 1.2.0): a frame around a route, for showing the whole day.
- Nothing was renamed or removed.

### Added in 4.3.0

The stop sheet's fixes: Save was below the fold, and on iPhone the date and time fields ran off the sheet.

- `.wt-modal__head--sticky` and `.wt-modal__actions--sticky`, a head and actions that stay put while a long form scrolls between them.
- `.wt-input-group` and `__prefix`: a field with a fixed part before its input. Check-out uses it for its day, which used to be in the label.
- `.wt-input` on date and time inputs is drawn like any other field on iPhone, left-aligned and no wider than the sheet.
- `.wt-field-row` lines up its labels and wraps on a very narrow screen; `.wt-nights__step` is 44px, the touch size.
- Nothing was renamed or removed.

### Added in 4.2.0

- `.wt-btn--icon`, a round icon-only button, and a flex `.wt-add-bar` that fits Edit stop and a `+` side by side. Nothing was renamed or removed.

### Added in 4.1.0

- `.wt-sheet.is-peek` (the day bar only), `.wt-trip-head.is-docked` (the header card, flat across the top over a full sheet), and `--wt-shadow-card`. The header floats over the map on a phone.
- `.wt-view-toggle` is now unused.

### Renamed or removed in 4.0.0

The day list got quieter: one hairline rail, grey drives, and one highlight at most.

- `.wt-tl-body` is removed. A stop's `.wt-tl-name` sits straight in `.wt-tl-stop`, and its notes go in a new `.wt-tl-notes` after the name, so they can run across the time column.
- `.wt-tl-car` is now a grey marker (`--wt-kind-drive`) rather than a grey icon on the surface color.
- The rail uses `--wt-border-rail` at 1.5px, not `--wt-border-strong` at 2px.
- Selected rows lose their ink outline, and nothing in the list is blue: the highlighted drive's car is `--wt-kind-drive-current`.
- Added: `--wt-border-rail`, `--wt-surface-current`, `--wt-kind-drive`, `--wt-kind-drive-current`, `--wt-tl-pad`, `.wt-tl-notes`. The `car` and `directions` icons are redrawn.

### Renamed or removed in 3.0.0

The trip header became one row for every screen size, and the phone's list stopped hiding.

- `.wt-sheet__bar` and `.wt-sheet__name` are removed. Use `.wt-trip-head` and `.wt-trip-head__name`, outside the sheet; from 768px wide the header tops the side panel.
- `.wt-sheet__grab` is now a button, as wide as the sheet. Its bar is drawn by `::before`.
- The sheet's top-only height is gone; a sheet is half or full (`.is-full`).
- `.wt-map-bar` and `.wt-kinds` stay, but since 3.0.1 nothing uses them: the prototype moved to the header and the picker too. They can go in the next major version.
- Added: `--wt-size-trip-head`, `.wt-view-toggle`, `.wt-picker`, `.wt-options`, `.wt-option`, `.wt-modal__head--sub`, `.wt-modal-root--panel`, `.wt-field-row`, `.wt-route-tag`, `.wt-pin__label--below`, and the `map` and `list` icons.

### Renamed or removed in 2.0.0

The itinerary became the timeline, and checking off stops went away. Today's highlight and the dimming of past rows replace it.

- `.wt-day` is removed. The day bar (`.wt-day-bar`) shows one day at a time.
- `.wt-stop` and `.wt-stop__main` are now one button, `.wt-tl-stop`. `__time`, `__name` and `__note` are now `.wt-tl-time`, `.wt-tl-name` and `.wt-tl-note`, with the name and note inside `.wt-tl-body`.
- `.wt-stop__meridiem` is now `.wt-tl-meridiem`.
- `.wt-stop--selected` is now `.is-selected`, and `--flash` is now `.is-flash`. `--done` is removed; use `.is-past`.
- `.wt-check` is removed.
- `.wt-drive` and `__chip` are now `.wt-tl-drive`, with `.wt-tl-drive__what` and a `.wt-tl-drive__go` Directions button. `--late` is now `.is-late`, and `--active` is now `.is-active`.
- `.wt-pin__dot` is now `.wt-marker.wt-pin__marker`. `.wt-pin--done` is removed; `--muted` now means past.
- `.wt-sheet__head` and `.wt-sheet__title` are removed. Home and settings moved to `.wt-map-bar`.
- `.wt-add-bar` moved out of `.wt-sheet__body`, after it. Its button is now `wt-btn--primary`.
- `.wt-sheet` is now white (`--wt-surface-raised`), not `--wt-surface-sheet`.
- No token was renamed or removed. `--wt-action-done`, `--wt-border-control`, `--wt-pin-ring*`, `--wt-size-check` and `--wt-type-heading` are now unused. They can go in the next major version.
