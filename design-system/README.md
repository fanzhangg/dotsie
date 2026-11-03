# Waythread Design System

Version 2.0.0. The design system behind Waythread, a minimal, phone-first trip planner. It's three plain files, with no build step:

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
| `--wt-border-strong` | The sheet's grab handle and the timeline's rail (decorative). |
| `--wt-border-control` | Control borders that must meet 3:1 on cards. No component uses it since 2.0.0. |
| `--wt-border-focus` | Focus rings, the focused input, the selected row's outline. |
| `--wt-action-primary`, `--wt-action-primary-text` | The one main action in a view, like Add stop. |
| `--wt-action-secondary`, `--wt-action-secondary-text` | Quiet actions, like Copy. |
| `--wt-action-done`, `--wt-action-done-text` | Unused since 2.0.0, when checks were removed. Kept until the next major version. |
| `--wt-route`, `--wt-route-active`, `--wt-route-muted`, `--wt-route-done`, `--wt-route-casing` | Route lines: normal, selected, the others while one is selected, past (on today), and the outline under each line. |
| `--wt-pin-fill` | The ring around a pin's marker. |
| `--wt-pin-ring`, `--wt-pin-ring-muted`, `--wt-pin-ring-done` | Unused since 2.0.0, when pins became markers. Kept until the next major version. |
| `--wt-kind-place`, `--wt-kind-travel`, `--wt-kind-stay`, `--wt-kind-food`, `--wt-kind-sight`, `--wt-kind-nature`, `--wt-kind-shop` | Stop types, one color per group: a plain place; airports and gas; hotels; restaurants and cafés; attractions, museums and viewpoints; nature; shopping. Only on markers, pins, the type picker and today's highlight. None is blue or red. |
| `--wt-marker-ink` | The icon on a marker, and the car of the drive you're on. Meets 3:1 on every kind color and on `--wt-route`. |
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
- **Size:** `--wt-size-touch` (44, the minimum for anything tapped often) · `icon-btn` (40) · `avatar` (26) · `check` (26, unused since 2.0.0) · `icon` (22) · `column` (480, the app column on large screens).

### Elevation, motion, layers

- **Elevation is set by role:**
  - `--wt-shadow-hairline`: cards.
  - `--wt-shadow-sheet`: the list sheet.
  - `--wt-shadow-float`: labels and buttons over the map.
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

`back` `forward` `close` `plus` `edit` `check` `car` `external` `person-add` `search` `pin` `home` `settings` `chevron-down` `directions`

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
<button class="wt-btn wt-btn--danger">Delete</button>
```

| Variant | Use for |
| --- | --- |
| `--primary` | The one main action in a view: Save, Add, Create. On the trip screen, Add stop. Never more than one per view. |
| `--secondary` | A quiet action next to content, like Copy beside the trip link. |
| `--ghost` | Low-emphasis actions next to content. |
| `--danger` | Destructive actions. Always leave a way back: an Undo toast or a confirmation. |
| `--block` | Full width, at the bottom of a sheet or form. |

Labels are verbs that say exactly what happens.

### Icon button `.wt-icon-btn`

```html
<button class="wt-icon-btn" aria-label="Close">${icon('close')}</button>
<button class="wt-icon-btn wt-icon-btn--sm wt-icon-btn--muted" aria-label="Edit trip">${icon('edit')}</button>
```

- Only for actions whose icon is universally understood: back, close, edit, home, settings, the day arrows and Directions.
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

### Field `.wt-field`, input `.wt-input`, search results `.wt-results`

```html
<label class="wt-field">
  <span class="wt-field__label">Place</span>
  <input class="wt-input" type="search" placeholder="Search a place">
</label>
<ul class="wt-results">
  <li><button class="wt-results__item"><span class="wt-results__name">White Sands Visitor Center</span>
      <span class="wt-results__detail">US-70, Alamogordo, New Mexico</span></button></li>
  <li class="wt-results__msg">No places found</li>
</ul>
```

- Every field has a visible label.
- Placeholders show an example, never the label.
- Messages say what happened and what to do next, for example "Pick a place from the search results".
- `textarea.wt-input` works the same way.

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
    <span class="wt-tl-body"><span class="wt-tl-name">Cloudcroft</span><span class="wt-tl-note">Lunch</span></span>
    <span class="wt-tl-time">12:30<span class="wt-tl-meridiem">PM</span></span>
  </button>
  <div class="wt-tl-drive is-late">
    <span class="wt-tl-rail"><i class="wt-tl-car">${icon('car', 14)}</i></span>
    <span class="wt-tl-drive__body">
      <span class="wt-tl-drive__what"><b>58 min</b> drive</span>
      <span class="wt-tl-drive__late">Arrives 13 min late</span>
    </span>
    <a class="wt-icon-btn wt-tl-drive__go" href="…maps link…" target="_blank" rel="noopener"
       aria-label="Directions to Oliver Lee Memorial State Park in your maps app">${icon('directions')}</a>
  </div>
  <!-- more stops and drives -->
</div>
```

- **Rows touch.** Put them straight inside `.wt-tl`, with nothing between, so the rail is one solid line from the first marker to the last.
- **Surface:** put the timeline on `--wt-surface-raised`. The marker and the car are cut out of the rail in that color.
- **Stop** (`.wt-tl-stop`): marker, name, optional note, time. Nothing else.
  - Set `--wt-kind-color` on the row, not only on the marker. The `is-now` tint uses it.
  - Notes are shown in full, never cut off.
- **Hotel:** at the start or end of a day, a hotel is a stop row with an empty `.wt-tl-time`. Only check-out morning gets a note ("Check out").
- **Drive** (`.wt-tl-drive`): a car on the rail, "1 hr 49 min drive", and a Directions button that opens the phone's maps app.
  - `__from`: the first drive of a day with no hotel the night before says where it starts ("from White Sands Visitor Center").
  - `__late`: "Arrives 13 min late", with `is-late`.
  - Never add distance or badges.
- **States:**

  | State | On | Means |
  | --- | --- | --- |
  | `is-selected` | a stop | Its pin was tapped, or the row was. Grey with an ink outline. |
  | `is-active` | a drive | Its route was tapped. Same look as `is-selected`. |
  | `is-now` | either | On today, what's happening now: the latest row that has started. Tinted with its map color, a stop's type or a drive's route. |
  | `is-past` | either | On today, every row before `is-now`. On an earlier day, every row. Dims. |
  | `is-late` | a drive | The drive is longer than the gap between its two stops. The drive time turns red. |
  | `is-flash` | a stop | A co-editor just changed it. Flashes once. |

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

### Type picker `.wt-kinds` and nights `.wt-nights`

Both live in the stop sheet.

```html
<div class="wt-field"><span class="wt-field__label" id="kind-label">Type</span>
  <div class="wt-kinds" role="radiogroup" aria-labelledby="kind-label">
    <button class="wt-kinds__item" role="radio" aria-checked="true" style="--wt-kind-color: var(--wt-kind-stay)">
      <i class="wt-kinds__icon">${icon('bed', 18)}</i>Hotel</button>
    <!-- one per type -->
  </div>
</div>
<div class="wt-field wt-nights"><span class="wt-field__label">Nights</span>
  <div class="wt-nights__row">
    <button class="wt-icon-btn wt-nights__step" aria-label="One night fewer">−</button>
    <output class="wt-nights__n" aria-live="polite">2</output>
    <button class="wt-icon-btn wt-nights__step" aria-label="One more night">+</button>
    <span class="wt-nights__out">check out Sun, Nov 22</span>
  </div>
</div>
```

- **Type** starts as a guess from the place's name and category, until someone picks one. The checked item fills with its `--wt-kind-color`.
- **Nights** shows only for a hotel; hide it with `hidden` otherwise. When becomes check-in, and the stepper sets check-out. Nights is at least 1, so disable the minus at 1.

### Bottom sheet `.wt-sheet` and add bar `.wt-add-bar`

```html
<section class="wt-sheet" aria-label="White Sands, NM">
  <div class="wt-sheet__top">
    <div class="wt-sheet__grab"></div>
    <div class="wt-day-bar">…</div>
  </div>
  <div class="wt-sheet__body wt-tl"><!-- the day's timeline --></div>
  <div class="wt-add-bar"><button class="wt-btn wt-btn--primary wt-btn--block">${icon('plus')}Add stop</button></div>
</section>
```

- The sheet is white (`--wt-surface-raised`) and sits over a full-screen map.
- Your code sets its `height` to one of three stops: the top only, about half the screen, or nearly full. Add `.is-dragging` while it's being dragged.
- The top holds the grab handle and the day bar. Nothing else: home and settings float over the map, and people live in trip settings.
- The add bar comes after `.wt-sheet__body`, not inside it. It's static, not sticky. The sheet hides what overflows, so a pulled-down sheet shows only its top.
- On today, scroll the list so the `is-now` row sits a little above the middle.

### Map buttons `.wt-map-bar` and credit `.wt-credit`

```html
<nav class="wt-map-bar">
  <a class="wt-icon-btn wt-map-btn" href="#/" aria-label="All trips">${icon('home')}</a>
  <button class="wt-icon-btn wt-map-btn" aria-label="Trip settings and sharing">${icon('settings')}</button>
</nav>

<p class="wt-credit">Map © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors</p>
```

- Home and settings float over the map's top corners. Nothing else floats over the map.
- Pad the top when you fit the map to a day, so pins stay clear of the buttons.
- The map's credits go at the bottom of trip settings, not on the map.

### Modal sheet `.wt-modal`

```html
<div class="wt-modal-root is-open">
  <div class="wt-modal__backdrop"></div>
  <div class="wt-modal" role="dialog" aria-modal="true">
    <div class="wt-modal__head"><h2 class="wt-modal__title">Edit stop</h2>
      <button class="wt-icon-btn" aria-label="Close">${icon('close')}</button></div>
    <!-- fields -->
    <div class="wt-modal__actions">
      <button class="wt-btn wt-btn--danger">Delete</button>
      <button class="wt-btn wt-btn--primary">Save</button>
    </div>
  </div>
</div>
```

- Slides up from the bottom, for editing one thing.
- **Actions:** destructive on the left, the main action on the right.
- **Closing:** a tap on the backdrop or the Escape key closes it.

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
- Variants: `--selected` (bigger, with its name) and `--muted` (past: on today, a stop that's over; or the day before's last stop, where a day with no hotel starts).
- The map shows only the open day.
- Stops at the same place, like a hotel in the morning and at night, share one pin.

### Empty state `.wt-empty`

```html
<p class="wt-empty">Add a flight, a hotel, or a place to see.</p>
```

Say what can go here, in the user's words. No illustrations.

## Patterns

- **The trip screen.**
  - A full-screen map, with `.wt-sheet` over it at half height, and `.wt-map-bar` over the map's top corners.
  - One day at a time. The day bar steps through the days, and the map shows only the open day.
  - A stop's marker is its pin: same icon, same color. The list and the map read as one without numbers.
  - Tapping a pin selects its stop (`is-selected`); tapping a route marks its drive `is-active`.
- **Today.** During the trip, the trip opens on today.
  - The row happening now is highlighted (`is-now`).
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
