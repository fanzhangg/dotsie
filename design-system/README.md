# Waythread Design System

Version 1.0.0. The design system behind Waythread, a minimal, phone-first trip planner. It's three plain files, with no build step:

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

- Color has a job. Blue means a route or link, red means "doesn't fit" or "destructive", and nothing else is colored.
- Use one way to show emphasis at a time. A card is set apart by its surface, not by surface and shadow and border together.
- Show state with what's already there. A late drive is the same chip in red; a finished stop fades. Don't add a badge.

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
| 2. Roles | `--wt-surface-*`, `--wt-text-*`, `--wt-border-*`, `--wt-action-*`, `--wt-route-*`, `--wt-pin-*`, `--wt-danger*`, `--wt-identity-*` | `--wt-route` | Named for what they're for. Each theme sets them differently. Components use these. |
| 3. Scales | `--wt-type-*`, `--wt-space-*`, `--wt-radius-*`, `--wt-size-*`, `--wt-shadow-*`, `--wt-duration-*`, `--wt-z-*` | `--wt-space-4` | The same in every theme. |

A new theme, such as high-contrast, only redefines tier 2.

### Class names

| Pattern | Meaning | Example |
| --- | --- | --- |
| `.wt-<component>` | A component | `.wt-stop` |
| `.wt-<component>__<part>` | A part of a component | `.wt-stop__name` |
| `.wt-<component>--<variant>` | A lasting variant | `.wt-stop--done`, `.wt-btn--primary` |
| `.is-<state>` | A passing state set by script | `.is-open`, `.is-dragging` |

Prefer ARIA attributes for state where one exists. The check reads `aria-pressed="true"`, not a class.

## Tokens

The values live in [`tokens.css`](tokens.css). The demo page shows each one live, in the current theme.

### Color roles

| Token | Use for |
| --- | --- |
| `--wt-surface-page` | Behind the app column on wide screens. |
| `--wt-surface-sheet` | The list sheet over the map, and sticky headings in it. |
| `--wt-surface-raised` | Stop cards, modal sheets, focused inputs. |
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
| `--wt-border-strong` | The sheet's grab handle (decorative). |
| `--wt-border-control` | The empty check ring. Meets 3:1 on cards, as control borders must. |
| `--wt-border-focus` | Focus rings, the focused input, the selected stop. |
| `--wt-action-primary`, `--wt-action-primary-text` | The one main action in a view. |
| `--wt-action-secondary`, `--wt-action-secondary-text` | Quiet actions, like Add stop. |
| `--wt-action-done`, `--wt-action-done-text` | A checked stop's check. |
| `--wt-route`, `--wt-route-active`, `--wt-route-muted`, `--wt-route-done`, `--wt-route-casing` | Route lines: normal, selected, the others while one is selected, finished, and the outline under each line. |
| `--wt-pin-fill`, `--wt-pin-ring`, `--wt-pin-ring-muted`, `--wt-pin-ring-done` | Map pins. |
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
| `--wt-type-title` | 18 / 24 | 700 | Trip names in the sheet, modal titles. |
| `--wt-type-heading` | 15 / 20 | 700 | Day headings. |
| `--wt-type-name` | 16 / 21 | 600 | Stop and trip names: the strongest text in a list. |
| `--wt-type-body` | 15 / 21 | 400 | Running text. |
| `--wt-type-time` | 15 / 21 | 600 | Stop times. Always use `tabular-nums`. |
| `--wt-type-label` | 14 / 20 | 600 | Buttons and pin labels. |
| `--wt-type-caption` | 13 / 18 | 400 | Notes, field labels, hints. |
| `--wt-type-caption-strong` | 13 / 18 | 500 | Drive times. |
| `--wt-type-micro` | 11 / 14 | 600 | AM/PM, avatar initials. |
| `--wt-type-input` | 16 / 22 | 400 | Form fields. 16px stops iPhone zooming in. |

### Space, shape, size

- **Space:** a 4px grid. `--wt-space-1` (4) · `2` (8) · `3` (12) · `4` (16) · `5` (20) · `6` (24) · `8` (32) · `10` (40). The side margin on a phone is `--wt-space-4`; the list's inner margin is `--wt-space-3`.
- **Radius:** `--wt-radius-sm` (8, pin labels) · `md` (12, cards, inputs, block buttons) · `lg` (18, sheets) · `pill` (buttons, drive chips, toasts) · `round` (avatars, checks, icon buttons).
- **Size:** `--wt-size-touch` (44, the minimum for anything tapped often) · `icon-btn` (40) · `avatar` (26) · `check` (26) · `icon` (22) · `column` (480, the app column on large screens).

### Elevation, motion, layers

- **Elevation is set by role:**
  - `--wt-shadow-hairline`: cards.
  - `--wt-shadow-sheet`: the list sheet.
  - `--wt-shadow-float`: labels over the map.
  - `--wt-shadow-pin`: pins.

  Nothing else gets a shadow.
- **Motion:**
  - `--wt-duration-fast` (150ms): color changes.
  - `--wt-duration-base` (250ms): sheets and toasts, with `--wt-ease-out`.
  - `--wt-duration-flash` (2.4s): a co-editor's change.

  All three drop to 0 when the phone asks for reduced motion.
- **Layers:** `--wt-z-raised` (sticky parts inside a scroll area) · `sheet` (500, above the map) · `modal` (1000) · `toast` (2000).

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
<button class="wt-btn wt-btn--secondary wt-btn--block">${icon('plus')}Add stop</button>
<button class="wt-btn wt-btn--danger">Delete</button>
```

| Variant | Use for |
| --- | --- |
| `--primary` | The one main action in a view: Save, Add, Create, Copy. Never more than one per view. |
| `--secondary` | A quiet, always-available action: Add stop. |
| `--ghost` | Low-emphasis actions next to content. |
| `--danger` | Destructive actions. Always leave a way back: an Undo toast or a confirmation. |
| `--block` | Full width, at the bottom of a sheet or form. |

Labels are verbs that say exactly what happens.

### Icon button `.wt-icon-btn`

```html
<button class="wt-icon-btn" aria-label="Close">${icon('close')}</button>
<button class="wt-icon-btn wt-icon-btn--sm wt-icon-btn--muted" aria-label="Edit trip">${icon('edit')}</button>
```

- Only for actions whose icon is universally understood: back, close, edit.
- Everything else gets a text label.
- `--muted` is for secondary actions next to a title.

### Avatar `.wt-avatar` and stack `.wt-avatar-stack`

```html
<button class="wt-avatar-stack" aria-label="People and sharing">
  <span class="wt-avatar" style="--wt-avatar-color: var(--wt-identity-1)">A</span>
  <span class="wt-avatar" style="--wt-avatar-color: var(--wt-identity-2)">S</span>
</button>
```

- The stack shows who's on the trip and doubles as the share button.
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

### Itinerary: `.wt-day`, `.wt-stop`, `.wt-check`, `.wt-drive`

The core of the product: three layers, each with its own look.

```html
<h3 class="wt-day">Fri, Nov 20</h3>
<div class="wt-stop">
  <button class="wt-stop__main">
    <span class="wt-stop__time">10:30<span class="wt-stop__meridiem">AM</span></span>
    <span><span class="wt-stop__name">El Paso International Airport</span>
          <span class="wt-stop__note">UA 1234 lands · rental car at Hertz</span></span>
  </button>
  <button class="wt-check" aria-pressed="false" aria-label="Mark done">${icon('check')}</button>
</div>
<a class="wt-drive" href="…maps link…" target="_blank" rel="noopener">
  <span class="wt-drive__chip">${icon('car')}1 hr 49 min${icon('external')}</span>
</a>
```

- **Day heading** (`.wt-day`): sticks to the top of the list while you scroll its day.
- **Stop** (`.wt-stop`): time, name, optional note. Nothing else.
  - Variants: `--selected` (matches a selected pin), `--done` (fades), `--flash` (a co-editor just changed it).
  - Notes are shown in full, never cut off.
- **Check** (`.wt-check`): only on trip days. State is `aria-pressed`.
- **Drive** (`.wt-drive`): a link that opens directions in the maps app.
  - Variants: `--late` (the drive is longer than the gap between the stops), `--active` (its route is selected on the map).
  - Never add distance, badges or warnings.

### Bottom sheet `.wt-sheet` and add bar `.wt-add-bar`

```html
<section class="wt-sheet" aria-label="Stops">
  <div class="wt-sheet__top">
    <div class="wt-sheet__grab"></div>
    <div class="wt-sheet__head">
      <a class="wt-icon-btn" href="#/" aria-label="All trips">${icon('back')}</a>
      <span class="wt-sheet__title">White Sands, NM</span>
      <button class="wt-icon-btn wt-icon-btn--sm wt-icon-btn--muted" aria-label="Edit trip">${icon('edit')}</button>
      <!-- avatar stack -->
    </div>
  </div>
  <div class="wt-sheet__body">
    <!-- itinerary -->
    <div class="wt-add-bar"><button class="wt-btn wt-btn--secondary wt-btn--block">${icon('plus')}Add stop</button></div>
  </div>
</section>
```

- The sheet sits over a full-screen map. Your code sets its `height` to one of three stops: header only, about half the screen, or nearly full. Add `.is-dragging` while it's being dragged.
- The sheet has one add button, pinned to the bottom.

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
<div class="wt-pin wt-pin--selected"><i class="wt-pin__dot"></i><span class="wt-pin__label">White Sands Visitor Center</span></div>
```

- Variants: `--selected` (bigger, with its name), `--done`, `--muted` (its stop is scrolled out of view in the list).
- Stops at the same place share one pin.

### Empty state `.wt-empty`

```html
<p class="wt-empty">Add a flight, a hotel, or a place to see.</p>
```

Say what can go here, in the user's words. No illustrations.

## Patterns

- **The trip screen.**
  - A full-screen map, with `.wt-sheet` over it at half height.
  - Scrolling the list mutes the pins of stops that are out of view (`.wt-pin--muted`).
  - Tapping a pin selects its stop; tapping a route marks its drive `--active`.
- **Doesn't fit.** If a drive takes longer than the gap between its two stops, the drive gets `--late`. That red text is the only warning.
- **Handing off to maps.** Every `.wt-drive` opens directions in the phone's maps app: Apple Maps on Apple devices, Google Maps elsewhere. Directions are never rebuilt in-app.
- **Changes from others.** When a co-editor changes a stop, show a toast naming them ("Sam checked off Cloudcroft") and flash the stop once with `--flash`.
- **Checking off stops.** Show `.wt-check` only on trip days. Before the trip, it's noise.
- **Deleting.** Delete right away, then show a toast with Undo. Ask first only when undo isn't possible, such as deleting a whole trip.

## Content

- **Voice:** plain and short, from the traveller's side. Name things the way people do: "stop", "drive", "trip", "people".
- **Formats:**

  | Thing | Format | Example |
  | --- | --- | --- |
  | Time | `h:mm AM` | 10:30 AM |
  | Day | `Ddd, Mmm d` | Fri, Nov 20 |
  | Trip dates | `Mmm d – d` | Nov 20 – 22 |
  | Drive | `h hr m min` | 1 hr 49 min |
  | Notice | `<Person> <did> <stop>` | Sam checked off Cloudcroft |
- **Labels:** say what happens. "Add stop", "Save", "Copy", "Delete trip". Avoid "Submit", "OK" and "Confirm".
- **Errors** say what went wrong and how to fix it, with no apology.

## Accessibility

- **Contrast:**
  - Text: 4.5:1 on its background, in both themes.
  - Large text, icons, focus rings and control borders: 3:1.
  - The demo page checks the key pairs live.
- **Focus:** everything interactive shows a 2px focus ring in `--wt-border-focus`.
- **Touch targets:** anything tapped often is at least `--wt-size-touch` (44px) high. Small icon buttons are 36–40px and never sit next to each other without space.
- **Color isn't the only signal:** a done stop fades and its check fills; a late drive also says so to screen readers (`aria-label`).
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
