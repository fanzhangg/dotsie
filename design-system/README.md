# Waythread Design System

Version 4.6.0. The design system behind Waythread, a minimal, phone-first trip planner that also works on a computer. It's three plain files, with no build step:

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
2. **The plan and the route lead.** Stop names are the strongest text, and routes are the only blue. Controls stay quiet.
3. **Built for sharing.** Everyone on a trip can edit. People are always visible, and their changes show up as they happen.
4. **Hand off what others do best.** Navigation opens in Apple Maps or Google Maps. Never rebuild it.

Each principle comes with a rule you can check:

- Color has a job. Blue means a route or link, and red means "doesn't fit" or "destructive". A stop's type color marks its marker, in the list and on the map. Nothing else is colored.
- Use one way to show emphasis at a time. A card is set apart by its surface, not by surface and shadow and border together.
- Show state with what's already there. A late drive is the same row in red; a past row dims. Don't add a badge.

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
| `--wt-surface-current` | The one highlighted timeline row: the selected one, or else the one happening now. The same for stops and drives. A clear step darker than `--wt-surface-raised` in both themes, so the highlight is easy to find. |
| `--wt-surface-inverse` | Toasts. |
| `--wt-surface-map` | The map before its tiles load. |
| `--wt-text-primary` | Names, titles and running text. |
| `--wt-text-secondary` | Times, notes, drive times, labels. |
| `--wt-text-placeholder` | Placeholder text only. |
| `--wt-text-inverse`, `--wt-text-inverse-action` | Text and the action on a toast. |
| `--wt-text-link` | Links in running text. |
| `--wt-text-danger` | A late drive, destructive buttons. |
| `--wt-border-subtle` | Card hairlines. |
| `--wt-border-default` | Input borders, list dividers. |
| `--wt-border-strong` | The sheet's grab handle (decorative). |
| `--wt-border-rail` | The timeline's rail: a quiet hairline, dimmer than `--wt-border-strong`. |
| `--wt-border-control` | Control borders that must meet 3:1 on cards. No component uses it since 2.0.0. |
| `--wt-border-focus` | Focus rings, the focused input. |
| `--wt-action-primary`, `--wt-action-primary-text` | The one main action in a view, like Add stop. |
| `--wt-action-secondary`, `--wt-action-secondary-text` | Quiet actions, like Copy. |
| `--wt-action-done`, `--wt-action-done-text` | Unused since 2.0.0, when checks were removed. Kept until the next major version. |
| `--wt-route`, `--wt-route-active`, `--wt-route-muted`, `--wt-route-done`, `--wt-route-casing` | Route lines: normal, selected, the others while one is selected, past (on today), and the outline under each line. |
| `--wt-pin-fill` | The ring around a pin's marker. |
| `--wt-pin-ring`, `--wt-pin-ring-muted`, `--wt-pin-ring-done` | Unused since 2.0.0, when pins became markers. Kept until the next major version. |
| `--wt-kind-place`, `--wt-kind-travel`, `--wt-kind-stay`, `--wt-kind-food`, `--wt-kind-sight`, `--wt-kind-nature`, `--wt-kind-shop` | Stop types, one color per group: a plain place; airports and gas; hotels; restaurants and cafés; attractions, museums and viewpoints; nature; shopping. Only on markers, pins, the type picker and the ring on today's stop. None is blue or red. |
| `--wt-kind-drive` | The car marker on a drive in the timeline: grey, and quieter than any stop type. |
| `--wt-kind-drive-current` | The car on the highlighted drive: a darker grey, never blue. |
| `--wt-marker-ink` | The icon on a marker, and the car on a drive. Meets 3:1 on every kind color, `--wt-kind-drive`, `--wt-kind-drive-current` and `--wt-route`. |
| `--wt-map-label` | The background of a pin's name label. |
| `--wt-danger`, `--wt-danger-surface` | "Doesn't fit" and destructive states. |
| `--wt-highlight` | Flashing a co-editor's change once. |
| `--wt-overlay` | The dimmed backdrop behind modal sheets. |
| `--wt-identity-1` … `--wt-identity-6`, `--wt-identity-text` | A person's color and their initial. Give each person on a trip a fixed color in order. |

### Type

The system font throughout, so the app feels native on every phone. Each token is a full `font` shorthand. Use it as `font: var(--wt-type-name);`.

| Token | Size / line | Weight | Use for |
| --- | --- | --- | --- |
| `--wt-type-display` | 28 / 34 | 700 | The app name on Home. Pair it with `--wt-tracking-display`. |
| `--wt-type-title` | 18 / 24 | 700 | The day bar, modal titles. |
| `--wt-type-heading` | 15 / 20 | 700 | Unused since 2.0.0, when day headings became the day bar. |
| `--wt-type-name` | 16 / 21 | 600 | Stop and trip names: the strongest text in a list. |
| `--wt-type-body` | 15 / 21 | 400 | Running text. |
| `--wt-type-time` | 15 / 21 | 600 | Stop times. Always use `tabular-nums`. |
| `--wt-type-label` | 14 / 20 | 600 | Buttons and pin labels. |
| `--wt-type-caption` | 13 / 18 | 400 | Notes, drives, field labels, hints. |
| `--wt-type-caption-strong` | 13 / 18 | 500 | A late drive's "Arrives 13 min late". |
| `--wt-type-micro` | 11 / 14 | 600 | AM/PM, avatar initials. |
| `--wt-type-input` | 16 / 22 | 400 | Form fields. 16px stops iPhone zooming in. |

### Space, shape, size

- **Space:** a 4px grid. `--wt-space-1` (4) · `2` (8) · `3` (12) · `4` (16) · `5` (20) · `6` (24) · `8` (32) · `10` (40). The side margin on a phone is `--wt-space-4`; the list's inner margin is `--wt-space-3`.
- **Radius:** `--wt-radius-sm` (8, pin labels) · `md` (12, cards, inputs, block buttons, timeline rows) · `lg` (18, sheets) · `pill` (buttons, toasts) · `round` (avatars, markers, icon buttons).
- **Size:** `--wt-size-touch` (44, the minimum for anything tapped often) · `icon-btn` (40) · `avatar` (26) · `check` (26, unused since 2.0.0) · `icon` (22) · `column` (480, the app column on large screens) · `panel` (360–440, 30% of the window: the plan's side panel from 768px wide) · `trip-head` (56, the trip header, below the top safe area).

### Elevation, motion, layers

- **Elevation is set by role:**
  - `--wt-shadow-hairline`: cards.
  - `--wt-shadow-sheet`: the list sheet.
  - `--wt-shadow-float`: labels and buttons over the map.
  - `--wt-shadow-card`: the trip header, a card floating over the map.
  - `--wt-shadow-popover`: a popover (search suggestions) over a sheet. It carries a hairline too, since in dark the popover and the sheet are the same surface.
  - `--wt-shadow-pin`: pins.

  Nothing else gets a shadow.
- **Motion:**
  - `--wt-duration-fast` (150ms): color changes.
  - `--wt-duration-base` (250ms): sheets and toasts, with `--wt-ease-out`.
  - `--wt-duration-flash` (2.4s): a co-editor's change.

  All three drop to 0 when the phone asks for reduced motion.
- **Layers:** `--wt-z-raised` (sticky parts inside a scroll area) · `sheet` (500, above the map; also the map buttons) · `modal` (1000) · `toast` (2000).

## Icons

Line icons on a 24px grid with a 2px stroke and round ends, drawn in the text color:

`back` `forward` `close` `plus` `edit` `check` `car` `external` `person-add` `search` `pin` `home` `settings` `chevron-down` `directions` `map` `list` `fit`

Stop types: `plane` `bed` `utensils` `cup` `star` `museum` `tree` `camera` `bag` `fuel` (with `pin` for a plain place).

```js
WaythreadIcons.svg('car');           // the size the product uses
WaythreadIcons.svg('check', 16, 3);  // custom size and stroke
```

- An icon next to a label is decoration (`aria-hidden`).
- An icon-only button needs an `aria-label`.
- `external` means "opens another app or site". Use it only for that.

## Components

Each entry shows the minimum markup. Your code supplies the content and the behavior; the system supplies the look.

### Button `.wt-btn`

```html
<button class="wt-btn wt-btn--primary">Save</button>
<button class="wt-btn wt-btn--primary wt-btn--block">${icon('plus')}Add stop</button>
<button class="wt-btn wt-btn--secondary">Copy</button>
<button class="wt-btn wt-btn--secondary wt-btn--icon" aria-label="Add stop">${icon('plus')}</button>
<button class="wt-btn wt-btn--danger">Delete</button>
```

| Variant | Use for |
| --- | --- |
| `--primary` | The one main action in a view: Save, Add, Create. On the trip screen, Add stop, or Edit stop while a stop is selected. Never more than one per view. |
| `--secondary` | A quiet action next to content, like Copy beside the trip link. |
| `--ghost` | Low-emphasis actions next to content. |
| `--danger` | Destructive actions. Always leave a way back: an Undo toast or a confirmation. |
| `--block` | Full width, at the bottom of a sheet or form. |
| `--icon` | Icon only: a round button as tall as the others, for an action that sits beside a bigger one, like the `+` beside Edit stop. Needs an `aria-label`. |

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
  <span class="wt-avatar" style="--wt-avatar-color: var(--wt-identity-2)">S</span>
</button>
```

- The stack shows who's on the trip. Trip settings lists everyone by name (`.wt-people`).
- With only one person on the trip, show the `person-add` icon instead.
- Set `--wt-avatar-ring` to the surface behind the stack.

### Field `.wt-field`, input `.wt-input`, search `.wt-search`, popover `.wt-popover`, results `.wt-results`

```html
<div class="wt-field">
  <label class="wt-field__label" for="place">Place</label>
  <label class="wt-input wt-input-group wt-search">${icon('search')}
    <input id="place" type="text" role="combobox" aria-autocomplete="list" aria-expanded="true"
           aria-controls="place-results" aria-activedescendant="opt-0" placeholder="Search a place">
    <span class="wt-spinner" hidden></span>
    <button type="button" class="wt-search__clear" aria-label="Clear">${icon('close')}</button></label>
  <p class="wt-field__hint">${icon('pin', 14)}<span>6554 Park Blvd, Joshua Tree, CA</span></p>   <!-- what it's set to -->
  <p class="wt-field__error" id="place-error" hidden></p>                                      <!-- what to fix -->
</div>

<!-- A child of the modal root, not of the sheet, placed by script with position: fixed -->
<div class="wt-popover wt-results" id="place-results" role="listbox" aria-label="Places">
  <div class="wt-option" role="option" id="opt-0" aria-selected="true">
    <i class="wt-marker" style="--wt-kind-color: var(--wt-kind-stay)">${icon('bed')}</i>
    <span class="wt-option__text"><span class="wt-option__label"><mark class="wt-option__match">Joshua</mark> Tree Inn</span>
      <span class="wt-option__detail">61259 29 Palms Hwy, Joshua Tree, CA</span></span></div>
  <!-- one per result; or, when there's nothing to pick -->
  <div class="wt-results__msg"><b>No places match “zzq”</b>Try adding the town, or check the spelling.</div>
</div>
```

- Every field has a visible label.
- Placeholders show an example, never the label.
- Messages say what happened and what to do next, for example "Pick a place from the suggestions, so the stop can go on the map". A field's error goes under it in `.wt-field__error`, with `aria-invalid` on the input (its box turns red) and `aria-describedby` pointing at the message.
- `textarea.wt-input` works the same way.
- **The search field holds what was picked.** Its text is the picked place's name, and editing that text is how you search again, starting from what's there. Only picking a suggestion changes what's picked; leave the field without picking (Esc, tapping away, saving) and its text goes back to the name. There's no separate name to keep in step. The hint line under it gives the address, to tell two places with the same name apart.
- **Search** suggestions open in a `.wt-popover` over the form, not in the form, so nothing below the field moves while you type. The popover is a child of the modal root, placed with `position: fixed` under the field, so the sheet's scrolling can't clip it. It opens above the field when there's more room there, and its `max-height` keeps it on the visible screen (`visualViewport`, so a phone's keyboard counts).
- **Results are options** (`.wt-option`, below), the same rows as the type list. Each shows the marker of the type the place would get, so the type's guess is never a surprise. The part of the name that matches what's typed is `.wt-option__match`.
- **Keyboard:** ↑ ↓ move the grey row (`aria-selected`, with `aria-activedescendant` on the input), Return picks it (with the text untouched it submits the form; mid-search with nothing to pick, it waits), Esc closes the popover, then puts the name back. Only then does Esc close the sheet. Keep focus in the input while an option is tapped: `preventDefault()` on the popover's `mousedown`.
- **While it searches**, the spinner shows in the field and the last results stay in the popover, so the list doesn't flash.
- `.wt-results__item`, `__name` and `__detail` (the list under the field before 4.6.0) are still in the stylesheet for the prototype. They can go in the next major version.

### Marker `.wt-marker`

A stop's type icon on its type's color. The same marker sits on the timeline's rail, on the map pin and in the day list, so a stop reads the same everywhere.

```html
<i class="wt-marker" role="img" aria-label="Restaurant" style="--wt-kind-color: var(--wt-kind-food)">${icon('utensils')}</i>
<i class="wt-marker wt-marker--sm" role="img" aria-label="Restaurant" style="--wt-kind-color: var(--wt-kind-food)">${icon('utensils')}</i>
```

| Type | Icon | Color |
| --- | --- | --- |
| Place | `pin` | `--wt-kind-place` |
| Airport, gas | `plane`, `fuel` | `--wt-kind-travel` |
| Hotel | `bed` | `--wt-kind-stay` |
| Restaurant, café | `utensils`, `cup` | `--wt-kind-food` |
| Attraction, museum, viewpoint | `star`, `museum`, `camera` | `--wt-kind-sight` |
| Nature | `tree` | `--wt-kind-nature` |
| Shopping | `bag` | `--wt-kind-shop` |

- Set `--wt-kind-color` on the marker or on a parent. Without one, the marker is grey.
- `--sm` (20px) is for the day list. The default is 30px.
- The `aria-label` names the type, so color is never the only signal.

### Timeline `.wt-tl`

The core of the product: one day of the plan, down a single rail. Stops and drives alternate.

```html
<div class="wt-tl">
  <button class="wt-tl-stop" style="--wt-kind-color: var(--wt-kind-food)">
    <span class="wt-tl-rail"><i class="wt-marker wt-tl-marker" role="img" aria-label="Restaurant">${icon('utensils')}</i></span>
    <span class="wt-tl-name">Cloudcroft</span><span class="wt-tl-notes"><span class="wt-tl-note">Lunch</span></span>
    <span class="wt-tl-time">12:30<span class="wt-tl-meridiem">PM</span></span>
  </button>
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
  - Set `--wt-kind-color` on the row, not only on the marker. The ring on the stop happening now uses it.
  - Notes go in one `.wt-tl-notes`, one `.wt-tl-note` per line of meaning ("2 nights", then the stop's note). They sit under the name and run across the time column too, so a long note wraps to the row's full width and its right edge lines up with the times.
  - Notes are shown in full, never cut off. Line breaks in a note are kept.
  - Leave out `.wt-tl-notes` when there are none.
- **Hotel:** at the start or end of a day, a hotel is a stop row with an empty `.wt-tl-time`. Only check-out morning gets a note ("Check out").
- **The day before's last stop:** with no hotel the night before, a day opens with that stop. In place of a time, `.wt-tl-time__day` says which day it was: "Yesterday", or the weekday ("Sat").
- **Drive** (`.wt-tl-drive`): a car on the rail and "1 hr 49 min drive". Tapping it shows its route; Directions to the maps app goes in the add bar (see [the add bar](#trip-header-wt-trip-head-bottom-sheet-wt-sheet-and-add-bar-wt-add-bar)), not in the row.
  - **Hierarchy:** the drive's text is 13px and all grey, its duration semibold. Stop names are the only strong text in the list, so the day reads as its stops, with drives as the links between them. The drive you're on darkens its duration; a late drive turns it red.
  - **Spacing:** stops get `--wt-tl-pad` (14px) above and below their text; drives are a fixed 44px row. Change `--wt-tl-pad` on `.wt-tl` to tighten or loosen the list; the markers follow.
  - The car (`.wt-tl-car`) is a marker like a stop's: a 22px circle in `--wt-kind-drive` grey with the `car` icon in `--wt-marker-ink`. Smaller and greyer than any stop, so drives never outrank them. On the highlighted drive it turns a darker grey (`--wt-kind-drive-current`). Never blue: blue is for routes on the map.
  - Give the row `role="button"` and `aria-pressed` while its route is shown.
  - `.wt-tl-drive__go`, a small Directions icon in the time column, is no longer used by the app (since 4.5.0); the prototype still has it. It can go in the next major version.
  - `__late`: "Arrives 13 min late", with `is-late`.
  - Never add distance or badges.
- **States:**

  | State | On | Means |
  | --- | --- | --- |
  | `is-selected` | a stop | Its pin was tapped, or the row was. Highlighted. |
  | `is-active` | a drive | Its route was tapped, or the row was. Highlighted, like a selected stop. |
  | `is-now` | either | On today, what's happening now: the latest row that has started. Highlighted only while nothing in the list is selected; then a stop's marker also gets a ring in its type color. |
  | `is-past` | either | On today, every row before `is-now`. On an earlier day, every row. Dims. |
  | `is-late` | a drive | The drive is longer than the gap between its two stops. The drive time turns red. |
  | `is-flash` | a stop | A co-editor just changed it. Flashes once. |

  **One highlighted row at most.** A selection takes the highlight; with none, the row happening now has it (the CSS works this out with `:has()`, so scripts set the classes as before). The highlight is the same for stops and drives: `--wt-surface-current` behind the row, no outline, no blue. A highlighted drive's car turns `--wt-kind-drive-current`, and its duration and Directions icon turn `--wt-text-primary`. Color stays on the rail, where the map's colors already are.

### Day bar `.wt-day-bar` and day list `.wt-day-list`

The day bar sits at the top of the sheet and steps through the trip one day at a time. Tapping the day opens the day list in a modal sheet.

```html
<div class="wt-day-bar">
  <button class="wt-icon-btn wt-day-bar__step" aria-label="Previous day">${icon('back')}</button>
  <button class="wt-day-bar__title" aria-label="Today, Nov 21. Pick a day">
    <span class="wt-day-bar__label">Today, Nov 21${icon('chevron-down')}</span>
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

- The title says "Today, Nov 21" on today, so it's easy to find your way back. Other days are "Sat, Nov 21".
- Disable the previous arrow on the first day and the next arrow on the last.
- The day list shows every day, with up to six small markers: the day's stops in order, then the hotel you sleep at. `aria-current="date"` marks the open day.

### Picker `.wt-picker`, options `.wt-options`, nights `.wt-nights` and check-out

All live in the stop sheet.

```html
<div class="wt-field"><span class="wt-field__label" id="kind-label">Type</span>
  <button class="wt-picker" aria-describedby="kind-label">
    <i class="wt-marker" style="--wt-kind-color: var(--wt-kind-stay)">${icon('bed')}</i>
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
    <i class="wt-marker" style="--wt-kind-color: var(--wt-kind-stay)">${icon('bed')}</i>
    <span class="wt-option__text"><span class="wt-option__label">Hotel</span>
      <span class="wt-option__detail">Adds nights and check-out</span></span>${icon('check', 18)}</button></li>
  <li class="wt-options__sep" role="presentation"></li>   <!-- between sections -->
  <!-- one per type -->
</ul>

<div class="wt-field-row">   <!-- hidden unless it's a hotel -->
  <div class="wt-field wt-nights"><span class="wt-field__label">Nights</span>
    <div class="wt-nights__row">
      <button class="wt-icon-btn wt-nights__step" aria-label="One night fewer">−</button>
      <output class="wt-nights__n" aria-live="polite">2</output>
      <button class="wt-icon-btn wt-nights__step" aria-label="One more night">+</button>
    </div>
  </div>
  <div class="wt-field"><span class="wt-field__label" id="checkout-label">Check-out</span>
    <label class="wt-input wt-input-group">
      <span class="wt-input-group__prefix">Sun, Nov 22</span>
      <input type="time" value="11:00" aria-labelledby="checkout-label"></label></div>
</div>
```

- **Type** is one row that shows the current type. Tapping it slides the sheet to the types; picking one, or Back, slides back. It keeps the sheet short, so the map stays in view above it. Focus the checked option when the page opens, and the picker when it closes.
- Type starts as a guess from the place's name and category, until someone picks one.
- **Option** (`.wt-option`) is one row for every choice in a list: marker, label over an optional detail, and a check. The type list and search results are both made of it. The grey row means "this one", as a selected row does in the timeline: the set type in a radiogroup (`aria-checked`, with its check), the one Return picks in a listbox (`aria-selected`). Rows are at least 44px tall.
- **The types** come in sections a traveler thinks in, split by `.wt-options__sep`: Place; Hotel, Airport, Gas; Restaurant, Café; Attraction, Viewpoint, Nature, Museum, Shopping. A detail line only where a type changes the form: Hotel's "Adds nights and check-out". ↑ ↓ move between types.
- **Nights and Check-out** show only for a hotel. When becomes check-in: 3:00 PM for a new hotel. Nights is at least 1, so disable the minus at 1. Check-out's day comes from the nights, so only its time is an input, but the day shows inside the field, before the time (`.wt-input-group`), so it reads as one value: `Sun, Nov 22  11:00 AM`. 11:00 AM unless someone sets another. The two sit side by side with their labels level; on a very narrow screen Check-out wraps below Nights.
- **Date and time fields** (`.wt-input` on `date`, `time` and `datetime-local`) are drawn like any other field on iPhone, so they read from the left and stay inside the sheet, rather than Safari's centred control, which is wider than the sheet.
- **`.wt-input-group`** is a `.wt-input` box with a fixed `__prefix` and a bare `<input>` after it. Make the box a `<label>` so a tap anywhere opens the input, and label the input with `aria-labelledby`.
- `.wt-kinds`, a grid of every type, is no longer used: the app and the prototype both use the picker. It can go in the next major version.

### Trip header `.wt-trip-head`, bottom sheet `.wt-sheet` and add bar `.wt-add-bar`

```html
<header class="wt-trip-head">
  <a class="wt-icon-btn" href="#/" aria-label="All trips">${icon('home')}</a>
  <h1 class="wt-trip-head__name">White Sands, NM</h1>
  <button class="wt-icon-btn" aria-label="Trip settings and sharing">${icon('settings')}</button>
</header>
<section class="wt-sheet" aria-label="Plan">   <!-- .is-peek or .is-full; neither is half -->
  <div class="wt-sheet__top">
    <button class="wt-sheet__grab" aria-label="Show the whole day"></button>
    <div class="wt-day-bar">…</div>
  </div>
  <div class="wt-sheet__body wt-tl"><!-- the day's timeline --></div>
  <div class="wt-add-bar"><button class="wt-btn wt-btn--primary wt-btn--block">${icon('plus')}Add stop</button></div>
</section>
```

With a stop selected, the add bar holds Edit stop and a round `+` beside it:

```html
<div class="wt-add-bar">
  <button class="wt-btn wt-btn--primary wt-btn--block">${icon('edit')}Edit stop</button>
  <button class="wt-btn wt-btn--secondary wt-btn--icon" aria-label="Add stop">${icon('plus')}</button>
</div>
```

- **The header** is one row: home, the trip's name, settings. The name is always in view. On a phone it's a card floating over the map, like a maps app's from/to card, and the map runs under it. Add `.is-docked` when the sheet is full: it goes flat across the top and joins the list. Its bottom edge is the same either way, so the full sheet's height doesn't change when it docks.
- **The sheet** is white (`--wt-surface-raised`) and sits over the map. On a phone it has three heights, like a maps app's sheet:
  - **Peek** (`.is-peek`): the day bar only, so the map has the screen. The list and the add bar are hidden (the add bar keeps its place, so its bottom padding and the safe area sit under the day bar): Add stop alone under an empty sheet read as if the day had no stops.
  - **Half** the screen, the default, but tall enough for the list to fit three stops and two drives (never more than about 60% of the screen).
  - The list (`.wt-sheet__body`) fades out at an edge with more past it: `.is-more-above` and `.is-more-below`, which the app sets from the scroll position.
  - **Full** (`.is-full`): the whole day, up to the header's bottom edge. The sheet goes square and flat, and the docked header and the list read as one page.
  - It never hides.
- **Moving it is dragging,** as in a maps app: the grab handle, the day bar, or the list itself. Below full, dragging the list moves the sheet rather than scrolling it (`touch-action: none` on the list), so dragging up grows the sheet first. At full, the list scrolls; pulled down from its top, it shrinks the sheet. A flick goes on to the next height its way; a slower drag settles at the nearest. Add `.is-dragging` while a finger is moving it.
- **Taps:** the grab handle is a button: half goes to full, peek and full go to half. Peeking, the day bar's buttons still work, and a tap anywhere else on the sheet opens it to half. No other tap resizes the sheet.
- **The map:** zooming it (pinch, double-tap, wheel) means you're looking at the map, so a half sheet goes down to peek. A new height re-frames the map for what's left of it, unless the map has been touched since it was last framed. Selecting a pin opens the sheet to half; showing a route from the whole day goes to half.
- The top holds the grab handle and the day bar. People live in trip settings.
- The add bar comes after `.wt-sheet__body`, not inside it. It's static, not sticky.
- **The add bar follows the selection.** With nothing selected it's Add stop. Tapping a stop in the list selects it rather than opening it, and the bar becomes Edit stop with a round `+` beside it, so adding is always one tap away. Tapping a drive shows its route, and the bar becomes Directions (a link to the maps app, `<a class="wt-btn wt-btn--primary wt-btn--block" target="_blank">`) with the same `+`. It's still one primary button.
- Tapping a selected stop or a shown drive again keeps it selected.
- On today, scroll the list so the `is-now` row sits a little above the middle.

**On a wide screen it's a side panel.** Make the element that holds the header, map and sheet a size container named `wt-trip`:

```css
.trip { position: relative; height: 100dvh; container: wt-trip / inline-size; }
#map { position: absolute; inset: 0; }   /* under the header card on a phone */
@container wt-trip (min-width: 768px) { #map { left: var(--wt-size-panel); } }   /* the map sits beside the panel */
```

Pad the top when you fit the map on a phone, so pins stay clear of the header card. From 768px wide, the header and the sheet stack into a full-height panel on the left, `--wt-size-panel` wide, and the map fills the rest. Your code clears the sheet's `height` there: no snapping, no dragging, and the grab handle hides. Without the `wt-trip` container, the header floats and the sheet is a bottom sheet at every width.

`.wt-view-toggle` (Map/List in the header) is unused since 4.1.0: the three heights are reached by dragging, as in a maps app. It can go in the next major version.

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
- Show it only while it would do something; hide it with `hidden`. Whole day is hidden while the map already shows the whole day, over the whole-day list, and while a stop is open.

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
```

- Shows at the top of the screen, for news: a co-editor's change, a confirmation, an undo.
- Stays about 3 seconds, or 5 with an action.
- One at a time. A new toast replaces the old one.

### Trip card `.wt-trip-card`

```html
<a class="wt-trip-card" href="#/trip/white-sands">
  <span class="wt-trip-card__name">White Sands, NM</span><span class="wt-trip-card__dates">Nov 20 – 22</span>
</a>
```

The name and dates only: enough to pick a trip.

### Map pin `.wt-pin`

```html
<div class="wt-pin wt-pin--selected">
  <i class="wt-marker wt-pin__marker" role="img" aria-label="Attraction" style="--wt-kind-color: var(--wt-kind-sight)">${icon('star')}</i>
  <span class="wt-pin__label">White Sands Visitor Center</span>
</div>
```

- The pin is the stop's marker, ringed in `--wt-pin-fill`. No numbers.
- Variants: `--selected` (bigger, with its name) and `--muted` (past: on today, a stop that's over; or the day before's last stop, where a day with no hotel starts; or, while a route is shown, a stop it doesn't start or end at).
- **A route on show** names both its ends: each end's pin is `--selected`, and the lower one's label gets `.wt-pin__label--below`, so the two don't meet. Its time sits halfway along it:

  ```html
  <div class="wt-route-tag"><i class="wt-route-tag__car">${icon('car', 14)}</i>34 min<span class="wt-route-tag__late">· 12 min late</span></div>
  ```

  The late part shows only when the drive doesn't fit. Showing a route moves the map to fit it, with room for the labels; from a tap on the route itself, only when an end is out of view.
- The map shows only the open day.
- Stops at the same place, like a hotel in the morning and at night, share one pin.

### Empty state `.wt-empty`

```html
<p class="wt-empty">Add a flight, a hotel, or a place to see.</p>
```

Say what can go here, in the user's words. No illustrations.

## Patterns

- **The trip screen.**
  - On a phone: `.wt-trip-head` across the top, the map under it, and `.wt-sheet` over the map at half height, or the whole day.
  - From 768px wide: the header and the sheet are a side panel on the left, and the map fills the rest. Modal sheets cover the panel. Fit the map with even padding: nothing covers it.
  - One day at a time. The day bar steps through the days, and the map shows only the open day.
  - A stop's marker is its pin: same icon, same color. The list and the map read as one without numbers.
  - Tapping a pin selects its stop (`is-selected`). Tapping a route, or its drive in the list, marks the drive `is-active` and shows the route: both ends named, its time on it, the map fitted to it. Tapping the drive again goes back to the whole day.
  - Editing a stop leaves the map in view (a panel), with the stop's pin showing the edit as it happens.
- **Today.** During the trip, the trip opens on today.
  - The row happening now is highlighted (`is-now`), unless another row is selected.
  - Rows before it dim (`is-past`), their routes turn grey (`--wt-route-done`), and their pins mute (`.wt-pin--muted`).
  - The hotel you go back to tonight stays bright.
- **Doesn't fit.** If a drive takes longer than the gap between its two stops, the drive gets `is-late` and says "Arrives 13 min late". That red text is the only warning.
- **Handing off to maps.** Every drive's Directions button opens the phone's maps app: Apple Maps on Apple devices, Google Maps elsewhere. Directions are never rebuilt in-app.
- **Changes from others.** When a co-editor changes a stop, show a toast naming them ("Sam updated Cloudcroft") and flash the stop once with `is-flash`.
- **Deleting.** Delete right away, then show a toast with Undo. Ask first only when undo isn't possible, such as deleting a whole trip.

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
- **Errors** say what went wrong and how to fix it, with no apology.

## Accessibility

- **Contrast:**
  - Text: 4.5:1 on its background, in both themes.
  - Large text, icons, focus rings and control borders: 3:1.
  - The demo page checks the key pairs live.
- **Focus:** everything interactive shows a 2px focus ring in `--wt-border-focus`.
- **Touch targets:** anything tapped often is at least `--wt-size-touch` (44px) high. Small icon buttons are 36–40px and never sit next to each other without space.
- **Color isn't the only signal:** a stop's type has an icon and a label as well as a color. A late drive also says "Arrives 13 min late". Past rows dim, and past pins shrink as well as fade.
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

### Added in 4.6.0

Place search and the type list, redesigned as one system.

- `.wt-option` is now the row for every choice: `__text`, `__detail` and `__match` are new, and `aria-selected` and `aria-checked` share the grey "this one" row (the checked type is no longer bold). `.wt-options__sep` splits a list into sections.
- `.wt-popover`: a floating card anchored to a field. Search results open in one (`.wt-results` of options, or a `__msg`) instead of a list that pushed the form down.
- `.wt-search` (a search field, with `__clear`) and `.wt-spinner`.
- `.wt-field__hint` and `.wt-field__error`, the line under a field. A `.wt-input-group` whose input has `aria-invalid` gets a red border.
- `--wt-shadow-popover` (tokens 1.5.0).
- Nothing was renamed or removed. `.wt-results__item`, `__name` and `__detail` stay for the prototype.

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
