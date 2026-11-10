# Dotsie Design System

Version 15.2.0. The design system behind Dotsie, a minimal, phone-first trip planner that also works on a computer. It's three plain files, with no build step, and the logo:

| File | What it holds |
| --- | --- |
| [`tokens.css`](tokens.css) | Every color, font, size, radius, shadow, duration and layer, in light and dark themes. |
| [`components.css`](components.css) | The component classes (`.wt-*`), built only from tokens. |
| [`icons.js`](icons.js) | The icon set, as `DotsieIcons.svg(name, size?, stroke?)`. |
| [`logo.svg`](logo.svg) | The logo, :D. See [Logo](#logo). |

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
- Weight is for the few things that lead. Stop names are medium (500) and the strongest text on the trip screen: the trip's name and the day above them are smaller and grey (`--wt-type-context`). Modal titles are semibold (600); only the app name on sign-in is bold. Everything else is regular, and steps down by size and ink (`--wt-text-secondary`, then `--wt-text-tertiary`, and `--wt-text-past` for what's over), never by adding weight.
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
  map.addLayer({ id: 'routes', type: 'line', source: 'routes', paint: { 'line-color': token('--wt-route') } });
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

Prefer ARIA attributes for state where one exists. The type picker reads `aria-checked="true"`, and the open day's tab `aria-selected="true"`, not a class.

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
| `--wt-border-focus` | Focus rings, the focused input. |
| `--wt-action-primary`, `--wt-action-primary-text` | The one main action in a view, like Add stop. |
| `--wt-action-danger`, `--wt-action-danger-text` | The confirm button of a dialog that destroys something (`.wt-btn--destructive`). |
| `--wt-action-secondary`, `--wt-action-secondary-text` | Quiet actions, like Copy. |
| `--wt-route`, `--wt-route-active`, `--wt-route-muted`, `--wt-route-done`, `--wt-route-casing` | Route lines: normal, selected, the others while one is selected, past (on today: the same grey as `--wt-kind-past`), and the outline under each line. |
| `--wt-pin-fill` | The outline around a map pin. |
| `--wt-kind-place`, `--wt-kind-hotel`, `--wt-kind-airport`, `--wt-kind-gas`, `--wt-kind-restaurant`, `--wt-kind-cafe`, `--wt-kind-attraction`, `--wt-kind-viewpoint`, `--wt-kind-nature`, `--wt-kind-museum`, `--wt-kind-shopping` | Stop types, one color each, so no two types look alike (see [Marker](#marker-wt-marker)). Named for the type's key, so a stop's color is `--wt-kind-<kind>`. Only on markers, pins and the type picker. Each is as vivid as its hue allows (OKLCH chroma up to .21 in light, .18 in dark) at about one lightness (L .62 in light, .74 in dark), so markers are bright and colorful and a type says what a place is, never that it matters more. Café, gas, nature and airport sit a little deeper, to stay apart from their neighbors. L .62 is as light as a type can be with `--wt-marker-ink` still at 3:1. None is blue or red. Place stays a neutral. |
| `--wt-kind-drive` | The car marker on a drive in the timeline: grey, and quieter than any stop type. |
| `--wt-kind-drive-current` | The car on the selected drive: a darker grey, never blue. |
| `--wt-kind-past` | Markers, cars and muted pins of what's over: light grey. |
| `--wt-marker-lift`, `--wt-marker-sink`, `--wt-marker-boost` | The shading on a stop's marker and pin, as on a maps app's. Each builds its own gradient from its color (`--wt-marker-fill`) with OKLCH relative colors: `lift` lighter and `boost` times the chroma at the top, `sink` darker at the bottom, one hue throughout. Not on a drive's car, which stays flat, nor on what's over. |
| `--wt-marker-ink` | The icon on a marker, the number or dot on a map pin, and the car on a drive. Meets 3:1 on every kind color, `--wt-kind-drive`, `--wt-kind-drive-current`, `--wt-now`, `--wt-danger` and `--wt-route`. Not on `--wt-kind-past`: what's over is faded on purpose. |
| `--wt-pin-faded-mix`, `--wt-pin-faded-ink-lift` | A pin stepping back while another is selected: `mix` is how much of its type color goes over `--wt-pin-fill` (45%, lighter in light mode, deeper in dark), and its number is its own type color, `ink-lift` lighter in OKLCH (negative: darker in light mode), so it stays legible. |
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

Four weights, each with a job: **700** the app name (sign-in) only; **600** headings and the one primary button; **500** names, the strongest text in a list, and other buttons; **400** everything else. A screen with lots of semibold tires the eye and makes nothing stand out, so below the names, hierarchy comes from size and ink, not weight. `<b>` and `<strong>` inside `wt-base` are 600, never 700.

| Token | Size / line | Weight | Use for |
| --- | --- | --- | --- |
| `--wt-type-display` | 28 / 34 | 700 | The app name on sign-in. Pair it with `--wt-tracking-display`. |
| `--wt-type-title` | 18 / 24 | 600 | Modal titles. |
| `--wt-type-headline` | 26 / 32 | 600 | A spot's name, at the top of its guide (`.wt-guide__name`). |
| `--wt-type-context` | 15 / 20 | 500 | Where you are: the trip's name, in `--wt-text-secondary`, and the day tabs, in `--wt-text-tertiary` (the open one primary). Smaller and lighter than a stop's name, so the plan leads. |
| `--wt-type-heading` | 15 / 20 | 600 | Section titles in trip settings and Account (`.wt-section__title`). |
| `--wt-type-name` | 16 / 21 | 500 | Stop and trip names: the strongest text in a list. |
| `--wt-type-body` | 15 / 21 | 400 | Running text. |
| `--wt-type-time` | 15 / 21 | 400 | Stop times, in `--wt-text-secondary`. Always use `tabular-nums`. |
| `--wt-type-label` | 14 / 20 | 500 | Buttons and pin labels. A primary button is 600. |
| `--wt-type-caption` | 13 / 18 | 400 | Notes, drives, field labels, hints. |
| `--wt-type-caption-strong` | 13 / 18 | 500 | A late drive's "Arrives 13 min late". |
| `--wt-type-overline` | 12 / 16 | 600 | Day headings on the overview. Set in capitals, with `--wt-tracking-caps`. |
| `--wt-type-micro` | 11 / 14 | 500 | AM/PM (in `--wt-text-tertiary`), avatar initials (600). |
| `--wt-type-input` | 16 / 22 | 400 | Form fields. 16px stops iPhone zooming in. |

### Space, shape, size

- **Columns:** icons and text line up down the screen, the way the timeline's rail does.
  - **Trip screen:** home and every marker and car are centred on the rail (36px in from the screen edge on a phone). Settings, the day tabs' calendar and Directions share a column on the right. The trip's name starts where stop names do. The header card, docked header and side panel all keep these positions, so nothing shifts as the sheet docks.
  - **Sheets:** two icon columns measured from the content edge: the options' markers on the left (23px), and their checks on the right (17px). The search icon, a picker's marker, a sub-page's back button, Close and a picker's chevron all sit on these columns. The typed search, a picker's value and a sub-page's title start where option names do.
- **Space:** a 4px grid. `--wt-space-1` (4) · `2` (8) · `3` (12) · `4` (16) · `5` (20) · `6` (24) · `8` (32) · `10` (40). The side margin on a phone is `--wt-space-4`; the list's inner margin is `--wt-space-3`.
- **Radius:** `--wt-radius-sm` (8, pin labels) · `md` (12, cards, inputs, block buttons, timeline rows) · `lg` (18, sheets) · `pill` (buttons, toasts) · `round` (avatars, markers, icon buttons).
- **Size:** `--wt-size-touch` (44, the minimum for anything tapped often) · `icon-btn` (40) · `avatar` (26) · `icon` (22) · `column` (480, the app column on large screens) · `panel` (360–440, 30% of the window: the plan's side panel from 768px wide) · `trip-head` (56, the trip header, below the top safe area).

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

`back` `forward` `close` `plus` `edit` `check` `car` `external` `link` (a stop has links) `search` `pin` `home` `settings` `chevron-down` `chevron-up-down` `calendar` (jump to a day) `directions` `map` `list` `fit` `alert` (something failed) `trash` (take something off a list: a place off Want to go)

Offline: `download` (saving, and Save for offline), `saved` (saved on this device) and `cloud-off` (no connection).

Stop types: `plane` `bed` `utensils` `cup` `star` `museum` `tree` `camera` `bag` `fuel` (with `pin` for a plain place).

How you get there: `car` `walk` `bike` `train` `plane` (Drive, Walk, Bike, Transit, Flight).

```js
DotsieIcons.svg('car');           // the size the product uses
DotsieIcons.svg('check', 16, 3);  // custom size and stroke
```

- An icon next to a label is decoration (`aria-hidden`).
- An icon-only button needs an `aria-label`.
- `external` means "opens another app or site". Use it only for that.
- `chevron-up-down` means "tap for a list to choose from". `forward` and `back` step or go to another page; don't put two controls that look alike but do different things next to each other.

## Logo

<img src="logo.svg" width="96" alt="Dotsie's logo, :D">

The logo is **:D**, the emoticon, typed upright: a colon of two stops and a capital D. It reads as a grin, and it starts the name.

- **The D** is Inter Bold, as an outline, in the first ink (`--wt-text-primary`: `gray-950`, `gray-100` in dark). Inter is open source (OFL), so it can be a logo; the phone's system font isn't licensed for one.
- **The colon** is two stops: an attraction's color on top and a restaurant's below (`--wt-brand-dot-top`, `--wt-brand-dot-bottom`), set about the D's middle, not on its baseline, so the face is level. Each dot is 30% of the D's height across, the two 58% of it apart, and 16% of it before the D.
- **On one color**, both dots take the D's ink.
- **Files:** [`logo.svg`](logo.svg) is the mark on a clear background and follows the light or dark theme. The app's icons (`favicon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, in `app/web` and `prototype`) are the mark on white, inside the middle 80% so a phone can crop them to any shape.
- **The name** is the wordmark ([`.wt-wordmark`](#wordmark-wt-wordmark)): Dotsie, with the logo's orange stop for the i's dot. The colon is the icon's alone: before a word it reads as a typo.

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
| `--secondary` | Every other action: white with a hairline outline. Copy, Share, Save for offline, Make a new link, Remove from this device, Sign out, Continue with Google. |
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
```

- Only for actions whose icon is universally understood: add, back, close, edit, home, settings, the day arrows and Directions.
- Everything else gets a text label.

### Avatar `.wt-avatar` and stack `.wt-avatar-stack`

```html
<button class="wt-avatar-stack" aria-label="People and sharing">
  <span class="wt-avatar" style="--wt-avatar-color: var(--wt-identity-1)">A</span>
  <span class="wt-avatar" style="--wt-avatar-color: var(--wt-identity-2)">S<img class="wt-avatar__img" src="…" alt="" referrerpolicy="no-referrer"></span>
</button>
```

- The stack shows who's on the trip. Trip settings lists everyone by name (`.wt-people`), with "(you)" in `.wt-people__meta`.
- A photo (`.wt-avatar__img`) goes inside the avatar, after the initial, and covers it. Keep the initial and the identity color: they show while the photo loads, and if it fails, remove the `<img>`. The name is always next to it or in a label, so `alt` stays empty.
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
  <div class="wt-copy-row"><input class="wt-input" readonly …><button class="wt-btn wt-btn--secondary">Copy</button><button class="wt-btn wt-btn--secondary">Share</button></div>
  <button class="wt-btn wt-btn--secondary">Make a new link</button>
</section>
<div class="wt-section"><button class="wt-btn wt-btn--danger">Delete trip</button></div>
```

- **Trip settings and Account are a column of sections**, one thing each, divided by `--wt-border-default` hairlines. Every section reads in the same order: the title (`__title`, `--wt-type-heading`), a line on what it does (`__text`, body in `--wt-text-secondary`), its controls, then a hint under a control (`__hint`, caption) or a button. The spacing between them is set by the section, so each one has the same rhythm.
- **A section that is one field** is the field's `<form>`, with its title as the `<label>`. A picker goes in a `.wt-field` inside the section, so its menu drops down under it.
- **No primary button.** Every change saves on its own (a name when you leave the field), so nothing in a settings sheet is black. Every button is the same white `--secondary` button (Copy, Share, Save for offline, Make a new link, Remove from this device, Sign out), and the destructive one (Delete trip) is `--danger`, the same button with a red label, last, in a section of its own. Sign out is `--secondary`: it destroys nothing, and a guest is asked first.
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
- **A list of links** (`.wt-link-list`, a stop's Links): a `.wt-link-edit` row each, drawn like an input, with `.wt-link-edit__label` over `.wt-link-edit__url` (both 16px, so a phone doesn't zoom in) and a `.wt-icon-btn.wt-link-edit__remove`; then a `.wt-link-add` button, `plus` and "Add link" in link blue. Add link focuses the new row's address. Once there's an address, the label's placeholder is the site the button will show without one. The list hides itself when empty.

  ```html
  <div class="wt-field"><span class="wt-field__label" id="links-label">Links</span>
    <div class="wt-link-list" role="group" aria-labelledby="links-label">
      <div class="wt-link-edit"><span class="wt-link-edit__fields">
        <input class="wt-link-edit__label" type="text" aria-label="Label" placeholder="Label" value="UA 1234">
        <input class="wt-link-edit__url" type="text" inputmode="url" aria-label="Link" placeholder="Paste a link" value="https://…"></span>
        <button type="button" class="wt-icon-btn wt-link-edit__remove" aria-label="Remove link">${icon('close')}</button></div>
    </div>
    <button type="button" class="wt-link-add">${icon('plus')}Add link</button></div>
  ```
- **A field picked by searching works as in Google or Apple Maps**, and their calendars' Location field. The form shows the choice as a row: its name, and under it a detail (a place's address, so two places with the same name can be told apart). Tapping the row opens a search page in place of the form, with the current name in the field and the cursor at its end, so you edit it rather than retype it. Results fill the page. Tapping one fills it in and comes back; **Cancel** (or Esc) comes back with nothing changed. Nothing typed is ever kept: only a picked result is. A choice that's required (a stop's place) can open on this page, and Cancel there closes the sheet.
- **While the search page is open** the sheet takes the whole screen on a phone (`.wt-modal.is-full`), as a maps app's sheet rises when you search, so the results show above the keyboard. The search bar stays at the top as the results scroll.
- **Results are options** (`.wt-option`, below), the same rows as the type list. Each shows the marker of the type the place would get, so the type's guess is never a surprise. The part of the name that matches what's typed is `.wt-option__match`.
- **Before anything's typed**, the page can suggest places under a `.wt-results__head` that says why (*On the way to Joshua Tree Inn*). No suggestion is the grey row until you move to it, so Return on an empty field picks nothing. Under the results, outside the listbox, `.wt-results__more` links to more in another app (*Places to eat nearby*, with `external`), in link blue.
- **A result that's set apart** (on the way) says so first in its detail, with `.wt-option__tag`: in the name's ink and weight 500, then ` · ` and the address. Never a color: a highlight is grey or ink.
- **A sheet that opens on the search page** with its field focused (a new stop) takes `.wt-modal--in-place`: on a phone it fades in where it'll stay instead of sliding up. Focus the field in the tap, so the keyboard comes up; on an iPhone a field focused while it's still below the screen pans the page down to it, and the field is left out of view above a blank screen.
- **Keyboard:** ↑ ↓ move the grey row (`aria-selected`, with `aria-activedescendant` on the input), Return picks it, Esc is Cancel. Keep focus in the input while a result is tapped: `preventDefault()` on the results' `mousedown`.
- **While it searches**, the spinner shows in the field and the last results stay on the page, so the list doesn't flash.

### Marker `.wt-marker`

A stop's type icon on its type's color, shaded from that color (lighter at the top, darker at the bottom, the same hue throughout), so it reads as a solid, tappable object like a maps app's marker. The same marker sits on the timeline's rail, on a trip card, in the Type picker and in place search. On the map, a stop's [pin](#map-pin-wt-pin) has the same color but carries its number instead of the icon.

```html
<i class="wt-marker" role="img" aria-label="Restaurant" style="--wt-kind-color: var(--wt-kind-restaurant)">${icon('utensils')}</i>
<i class="wt-marker wt-marker--sm" role="img" aria-label="Restaurant" style="--wt-kind-color: var(--wt-kind-restaurant)">${icon('utensils')}</i>
```

Every type has its own color, so no two look alike. The colors follow maps apps where they can; where those use blue (airports, gas), Dotsie uses the nearest hue that isn't the route's.

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
- `--sm` (20px) is for a trip card's now and next. The default is 30px.
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

- **Rows touch.** Put them straight inside `.wt-tl`, with nothing between, so the rail is one solid hairline (`--wt-border-rail`, 2px, `--wt-tl-line`) from the first marker to the last. Rows have no top or bottom padding of their own, which would break the rail.
- **Surface:** put the timeline on `--wt-surface-raised`. Stop markers are ringed in that color.
- **Stop** (`.wt-tl-stop`): marker, name, time, and optional notes. Nothing else.
  - Set `--wt-kind-color` on the row and the marker.
  - Notes go in one `.wt-tl-notes`, one `.wt-tl-note` per line of meaning ("2 nights", then the stop's note). They sit under the name and run across the time column too, so a long note wraps to the row's full width and its right edge lines up with the times.
  - **The name is one line.** A long one ends in an ellipsis.
  - **On a phone, notes are one line** (inside the `wt-trip` container, under 768px wide): they run together with ` · ` and end in an ellipsis. The selected stop (`is-selected`) shows them in full, with their line breaks; so does every stop on a wider screen.
  - Leave out `.wt-tl-notes` when there are none.
  - **Links in a note can be tapped.** Each shows only its site (`booking.com`), in blue, so a long link doesn't fill the row; tapping it opens the page and doesn't select the stop. Since a link can't sit inside a `<button>`, the row is a `div` with `role="button"`, `tabindex="0"` and `aria-pressed`, like a drive, and Enter or Space selects it.
  - **A stop's links** (`.wt-tl-links`, after `.wt-tl-notes`): one `a.wt-tl-link` each, with `target="_blank"`, its label in `.wt-tl-link__label` (or the page's site when it has none) and the `external` icon. They're outlined pills in `--wt-text-link`, 34px tall, and wrap onto more lines. Tapping one opens the page without selecting the stop.

    ```html
    <span class="wt-tl-notes"><span class="wt-tl-links-hint" aria-hidden="true">${icon('link')}</span><span class="wt-tl-note">Drop bags</span></span>
    <span class="wt-tl-links"><a class="wt-tl-link" href="…" target="_blank" rel="noopener"><span class="wt-tl-link__label">Booking</span>${icon('external')}</a></span>
    ```

    **On a phone only the selected stop shows them**, like its full notes. Put `.wt-tl-links-hint` (the `link` icon) first in `.wt-tl-notes`: the CSS shows it, in tertiary grey, on any other stop with links, so the half list keeps its height. Leave both out when a stop has no links.
- **Hotel:** at the start or end of a day, a hotel is a stop row with an empty `.wt-tl-time`. Only check-out morning gets a note ("Check out").
- **Time zones:** where the clocks change (a stop whose zone isn't the one before it, or a trip's first stop not in this device's zone), the time ends with the zone's short name, `<span class="wt-tl-zone">EST</span>` after the AM/PM, in the same small tertiary type. Anywhere else, leave it out: a time is in the same zone as the one above it.
- **Duration:** how long you're at a stop (`1 hr 30 min`) is its first note, where a hotel's nights go.
- **The day before's last stop:** with no hotel the night before, a day opens with that stop. In place of a time, `.wt-tl-time__day` says which day it was: "Yesterday", or the weekday ("Sat").
- **Drive** (`.wt-tl-drive`): a car on the rail and "1 hr 49 min drive". The same row is any leg: put the way's icon in `.wt-tl-car` in place of the car and finish the sentence with it ("12 min walk", "25 min bike ride"); a leg with no time (transit, a flight) is just its name in the `<b>`: `<b>Flight</b>`. Tapping it shows its route; Directions to the maps app goes in the add bar (see [the add bar](#trip-header-wt-trip-head-bottom-sheet-wt-sheet-and-add-bar-wt-add-bar)), not in the row.
  - **Hierarchy:** the drive's text is 13px in `--wt-text-tertiary`, its duration medium in `--wt-text-secondary`. Stop names are the only strong text in the list, so the day reads as its stops, with drives as the links between them. The drive you're on darkens its duration to primary and its car to black; a late drive turns both red.
  - **Spacing:** stops get `--wt-tl-pad` (12px) above and below their text; drives are a 32px row. The rail column (`--wt-tl-rail`) is 40px. Change `--wt-tl-pad` on `.wt-tl` to tighten or loosen the list; the markers follow.
  - The car (`.wt-tl-car`) is a marker like a stop's: a 22px circle in `--wt-kind-drive` grey with the `car` icon in `--wt-marker-ink`. Smaller and greyer than any stop, so drives never outrank them. On the selected drive it turns a darker grey (`--wt-kind-drive-current`), on the drive you're on black (`--wt-now`), on a late drive red (`--wt-danger`), and once it's over light grey (`--wt-kind-past`). Never blue: blue is for routes on the map.
  - Give the row `role="button"` and `aria-pressed` while its route is shown.
  - `__late`: "Arrives 13 min late", with `is-late`.
  - Never add distance or badges.
- **A place on Want to go** (`.wt-tl-idea`, with `.wt-tl-stop`): a trip's places with no day yet, as stop rows with their address and note for notes, an empty `.wt-tl-time`, and no rail between them, since they're in no order but the one they were saved in.
- **Day heading** (`.wt-tl-day`): the **Overview** puts every day in one timeline, each day's stops under its name. See [Overview](#overview-wt-tl-day).
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

### Overview `.wt-tl-day`

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

- **The heading** is a row in the timeline with **View day** on the right (`.wt-tl-day__open`, caption size in `--wt-text-link`; secondary ink on a past day): tapping it opens that day. It's in words, not a `forward` icon. It's a label, not a name: `--wt-type-overline` in grey capitals (`text-transform` and `--wt-tracking-caps`; the text stays "Fri, Nov 20" for screen readers), starting at the list's left edge, where the markers start. Stop names are larger, black and indented past the rail, so a date never reads as a stop. It's at least `--wt-size-touch` tall, with its text at the bottom, next to the day's first stop.
- **It isn't on the rail.** Each day's rail runs from its first stop's marker to its last; a day with one stop has no rail.
- **Stops and the drives between them,** as on a day: marker, name, time, and `1 hr 36 min drive`. Notes are left to the day's own page, and so are the hotel you wake up at and go back to, with the drives to and from it (the map still draws every drive). A day's rows start and end with a place, never a drive, so its rail runs from marker to marker. A hotel keeps its nights on its check-in day, and check-out morning is a row with `Check out`. A day with no stops of its own, in the middle of a stay, shows the hotel you wake up at.
- `is-selected`, `is-now` and `is-past` work as on a day. A past day's heading gets `is-past` and turns `--wt-text-past` with its stops.

### Day tabs `.wt-day-bar` and day calendar `.wt-day-cal`

The day tabs sit at the top of the sheet: Overview, then every day of the trip. The open page's tab is in primary ink with a short bar under it; the rest are quiet. A calendar button at the end opens the day calendar between the tabs and the list, to jump to any day of a long trip.

```html
<div class="wt-day-bar">
  <div class="wt-day-tabs" role="tablist" aria-label="Days">
    <button class="wt-day-tab" role="tab" aria-selected="false" aria-label="Overview">Overview</button>
    <button class="wt-day-tab" role="tab" aria-selected="false" aria-label="Fri, Nov 20">Fri 20</button>
    <button class="wt-day-tab" role="tab" aria-selected="true" aria-label="Today, Nov 21">Today</button>
    <!-- … every day of the trip -->
    <span class="wt-day-tabs__bar" aria-hidden="true"></span>
  </div>
  <button class="wt-icon-btn wt-day-bar__cal" aria-expanded="false" aria-label="Jump to a day">${icon('calendar')}</button>
</div>

<div class="wt-day-cal">   <!-- hidden unless the calendar is open; between .wt-sheet__top and .wt-sheet__body -->
  <div class="wt-day-cal__head">
    <span class="wt-cal__month">November 2026</span>
    <button class="wt-day-cal__overview" aria-pressed="false">Overview</button>
  </div>
  <div class="wt-cal__grid" role="group" aria-label="The trip's days">
    <!-- the weekdays' letters (.wt-cal__wd), then whole weeks: -->
    <span class="wt-cal__day" aria-hidden="true"><span class="wt-cal__n">19</span></span>   <!-- not on the trip -->
    <button class="wt-cal__day has-stops" aria-pressed="false" aria-label="Fri, Nov 20"><span class="wt-cal__n">20</span></button>
    <span class="wt-day-cal__month">December 2026</span>   <!-- before a later month's first week -->
  </div>
</div>
```

- **A tab says as little as it can:** "Overview", "Today", "Sat 21", or the month on the 1st ("Dec 1"). Its `aria-label` says the whole day ("Today, Nov 21", "Sat, Nov 21"). `--wt-type-context` in `--wt-text-tertiary`; the open tab (`aria-selected="true"`) is `--wt-text-primary`. No fills, no outlines: the day says where you are, so it stays below the plan.
- **The bar** (`__bar`, 24 × 2px of `--wt-text-primary`) is placed under the open tab by script, with `transform`, and slides there on `--wt-duration-base`. While the list is swiped sideways, the script moves it toward the next tab with the finger.
- **The row scrolls sideways** with no scrollbar, and fades out at either edge, so a long trip fits. Keep the open tab in the middle of the row whenever it changes. It sits on the hairline under the sheet's top (`.wt-sheet__top` has no bottom padding with day tabs in it).
- **The calendar button** (`__cal`) stays at the row's end. `aria-expanded="true"` while the calendar is open, with a `--wt-surface-hover` disc.
- **The day calendar** uses the month's days (`.wt-cal__day`, 36px here): the open day `aria-pressed="true"` in black, today `aria-current="date"` with a ring, `has-stops` with a dot for a day with stops of its own. Days off the trip are spans in `--wt-text-past`. Show only the weeks with days of the trip in them; `__month` names a later month before its first week. **Overview** (`__overview`) is in link ink, primary and semibold when it's the open page. It takes the room it needs, up to all of the list's, and scrolls past that.
- **Swiping:** the list turns the page when swiped sideways. The page coming in is `.wt-sheet__peek`, a copy of the next page's rows beside the list; `.wt-sheet.is-full .wt-sheet__body` is `touch-action: pan-y` so the sideways swipe is the script's at full height too, as it is below full (`none`) and in the side panel.

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

<div class="wt-field">   <!-- hidden unless it's a hotel; see When, below -->
  <span class="wt-field__label wt-field__label--split"><span id="out-label">Check-out</span><span class="wt-field__aside">2 nights</span></span>
  <div class="wt-when">
    <button class="wt-picker wt-picker--text wt-when__date" aria-describedby="out-label">Sun, Nov 22</button>
    <button class="wt-picker wt-picker--text wt-when__time" aria-describedby="out-label">11:00 AM</button></div></div>
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
- In the app, `optionHTML`, `choicePageHTML` and `choicePage` in `app/web/stopsheet.js` build and wire any picker, as a page on a phone and a menu on a computer; use them for a new one.
- Type starts as a guess from the place's name and category, until someone picks one.
- **Option** (`.wt-option`) is one row for every choice in a list: marker, label over an optional detail, and a check. The type list and search results are both made of it. The grey row means "this one", as a selected row does in the timeline: the set type in a radiogroup (`aria-checked`, with its check), the one Return picks in a listbox (`aria-selected`). Rows are at least 44px tall.
- **The types** come in sections a traveler thinks in, split by `.wt-options__sep`: Place; Hotel, Airport, Gas; Restaurant, Café; Attraction, Viewpoint, Nature, Museum, Shopping. A detail line only where a type changes the form: Hotel's "Check-in and check-out". ↑ ↓ move between types.
- **One time for a stop: Arrive**, when you get there. There's no leave time: the drive after a stop sets off just in time for the next one.
- **Check-out** shows only for a hotel, under Check-in, and is a day and time like it ([When](#when-wt-when-month-wt-cal-and-wheels-wt-wheels)). Arrive becomes Check-in: 3:00 PM for a new hotel. The nights are the days between the two, so there's no separate Nights field: pick the day you leave. The count shows on the right of Check-out's label (`.wt-field__label--split` with a `.wt-field__aside`: `2 nights`, or `Same day`). Check-out is after check-in, as early as the same day (0 nights, for a stay that starts after midnight), and at most 30 nights later: its month offers only those days, and a time before check-in on the same day comes up to it. 11:00 AM unless someone sets another time. Moving check-in keeps the check-out day while that still leaves 0–30 nights.
- **Date and time fields** (`.wt-input` on `date`, `time` and `datetime-local`) are drawn like any other field on iPhone, so they read from the left and stay inside the sheet, rather than Safari's centred control, which is wider than the sheet. The stop sheet no longer uses them (see When).
- **`.wt-input-group`** is a `.wt-input` box with something fixed before a bare `<input>`, such as the search field's icon. Make the box a `<label>` so a tap anywhere opens the input.

### When `.wt-when`, month `.wt-cal` and wheels `.wt-wheels`

A day and a time, picked in that order, as in Google Calendar: a stop's Arrive, and a hotel's Check-in and Check-out.

```html
<div class="wt-field"><span class="wt-field__label wt-field__label--split"><span id="arrive-label">Arrive</span></span>
  <div class="wt-when">
    <button class="wt-picker wt-picker--text wt-when__date" aria-describedby="arrive-label" aria-haspopup="true" aria-expanded="false">Fri, Nov 20</button>
    <button class="wt-picker wt-picker--text wt-when__time" aria-describedby="arrive-label" aria-haspopup="true" aria-expanded="false">1:00 PM</button></div>
  <!-- Arrive only: the clock the times are on, opening a picker of every zone -->
  <button class="wt-when__zone" aria-describedby="zone-label"><span class="wt-visually-hidden" id="zone-label">Time zone</span>
    <span class="wt-when__zone-name">Local time · Mountain Standard Time</span>${icon('forward')}</button>
  <input type="hidden" name="time" value="2026-11-20T13:00"></div>

<!-- The day: in place of the form on a phone (.wt-when-page), under the row on a computer (.wt-when-page.wt-menu) -->
<div class="wt-when-page">
  <div class="wt-modal__head wt-modal__head--sub">
    <button class="wt-icon-btn" aria-label="Back">${icon('back')}</button><h2 class="wt-modal__title">Arrive</h2></div>
  <div class="wt-cal">
    <div class="wt-cal__head"><span class="wt-cal__month">November 2026</span>
      <button class="wt-icon-btn" aria-label="Previous month">${icon('back')}</button>
      <button class="wt-icon-btn" aria-label="Next month">${icon('forward')}</button></div>
    <div class="wt-cal__grid" role="group" aria-label="November 2026">
      <span class="wt-cal__wd" aria-hidden="true">S</span> …    <!-- the weekdays, Sunday first -->
      <span></span> …                                        <!-- a blank for each day before the 1st -->
      <button class="wt-cal__day has-stops" aria-pressed="true" tabindex="0" aria-label="Fri, Nov 20, has stops">
        <span class="wt-cal__n">20</span></button> …
    </div></div></div>

<!-- The time: the head's title is the day picked -->
<div class="wt-when-page">
  <div class="wt-modal__head wt-modal__head--sub">…<h2 class="wt-modal__title">Fri, Nov 20</h2></div>
  <div class="wt-wheels" role="group" aria-label="Time">
    <div class="wt-wheel" tabindex="0" role="spinbutton" aria-label="Hour" aria-valuetext="1">
      <div class="wt-wheel__item">12</div><div class="wt-wheel__item is-on">1</div> …</div>
    <!-- Minute: 00, 05 … 55; AM or PM -->
  </div>
  <button class="wt-btn wt-btn--primary wt-btn--block wt-when-page__done">Done</button></div>
```

- **The row** (`.wt-when`) is two pickers side by side, `.wt-picker--text` with no chevron: the day (`__date`) takes the room, the time (`__time`) follows it. The day reads `Fri, Nov 20`, with the year when it isn't this one; the time `1:00 PM`. The value lives in a hidden input. The picker that's open (`aria-expanded="true"`) has the focus border.
- **A day, then a time.** Tapping the day opens the month; picking a day goes straight on to the time, since a new day usually wants a new time too. Tapping the time goes there alone. Back on the time goes back to the month it came from, and from the month to the form. **Nothing changes until Done**, which sets both; Back from the month, or Esc, leaves the field as it was.
- **The page** (`.wt-when-page`) takes the place of the form, like a picker's options: a sub-head with Back, then the month or the wheels. The month's title is the field's label; the time's is the day picked. On a computer it's a menu under the row (`.wt-menu`), with no head, and the row shows the draft as it changes.
- **The month** (`.wt-cal`): its name with ‹ › after it (disabled at the edge of what can be picked), the weekdays' letters, then its days, Sunday first. The day set is black (`aria-pressed="true"`), like the one primary button; today has a black ring (`aria-current="date"`), like now in the timeline; a day with stops has a dot under its number (`.has-stops`), so a trip's days are easy to find. Days that can't be picked are `disabled`, in light grey. One day is in the tab order (`tabindex="0"`): ← → ↑ ↓ move a day or a week, Page Up and Page Down a month.
- **The wheels** (`.wt-wheels`, one `.wt-wheel` per column): hour, minute and AM/PM, each a column that scrolls and snaps into the grey band across the middle (`--wt-surface-current`, the grey of a selected row). The value in the band is `.is-on`, in primary ink; the rest are tertiary. Minutes go in fives, plus the value's own minute when it's between, so a 10:42 flight keeps its 42. Tap a value to bring it to the band; each wheel is a `spinbutton` with its value in `aria-valuetext`, stepped by ↑ ↓.
- **The time zone** (`.wt-when__zone`), under Arrive only, is a quiet caption-sized line, not a field: `Local time · Mountain Standard Time`, or a zone picked by hand with its city (`Pacific Standard Time · Los Angeles`), and a small ›. It opens a picker like Type (a page on a phone, a menu on a computer) with a search field over the options (`.wt-input-group.wt-search.wt-zone-search`): Local time first, then every zone, each its city over its name and offset (`Pacific Standard Time · GMT-8`). With nothing found, a `.wt-results__msg` says so.
- In the app, `whenHTML` and `whenPicker` in `app/web/stopsheet.js` build and wire one.

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
    <div class="wt-day-bar">…</div>   <!-- the day tabs -->
  </div>
  <div class="wt-day-cal" hidden>…</div>   <!-- the day calendar, while open -->
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
- **Moving it is dragging,** as in a maps app: the grab handle, the day tabs, or the list itself (a sideways swipe on the list turns the page instead). Below full, dragging the list moves the sheet rather than scrolling it, and the list can't be scrolled by hand at all (`touch-action: none` and `overflow: hidden`): your code scrolls it, to keep the focused row in its middle. At full, the list scrolls; pulled down from its top, it shrinks the sheet. A flick goes on to the other height; a slower drag settles at the nearer. Add `.is-dragging` while a finger is moving it.
- **Taps:** the grab handle is a button that switches between half and full. Choosing a stop or a drive on the whole day brings the sheet down to half. No other tap resizes the sheet.
- **The map:** a new height re-frames the map for what's left of it, unless the map has been touched since it was last framed. Selecting a pin or showing a route opens the sheet to half. Zooming doesn't move the sheet.
- The top holds the grab handle and the day tabs, with a 1px `--wt-border-default` line under it that divides the tabs from the list (left out when they're hidden, on an empty trip). The handle is laid over the tabs' top edge rather than taking a row of its own; the tabs and the calendar button sit above it and take their own taps, and a tap anywhere else on that strip is the handle's. People live in trip settings.
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

### Map credit `.wt-credit`

```html
<p class="wt-credit">Map © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors</p>
```

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
  </span>
  <span class="wt-trip-card__body">
    <span class="wt-trip-card__text"><span class="wt-trip-card__name">White Sands, NM</span><span class="wt-trip-card__dates">Nov 20 – 22, 2026 · <span class="wt-trip-card__when">In 2 weeks</span></span></span>
    <span class="wt-avatar-stack wt-trip-card__people" aria-hidden="true">${avatars}</span>
    <span class="wt-visually-hidden">, with Alex, Sam</span>
  </span>
  <!-- under way: what it's at now and what's next -->
  <span class="wt-trip-card__now">
    <span class="wt-trip-card__step is-now"><i class="wt-marker wt-marker--sm" role="img" aria-label="Museum" style="--wt-kind-color: var(--wt-kind-museum)">${icon}</i>
      <span class="wt-trip-card__step-name">New Mexico Museum of Space History</span><span class="wt-trip-card__step-time">Now</span></span>
    <span class="wt-trip-card__step"><i class="wt-marker wt-marker--sm" …>${icon}</i>
      <span class="wt-trip-card__step-name">Cloudcroft</span><span class="wt-trip-card__step-time">12:30 PM</span></span>
  </span>
</a>
<!-- photos of its places, in place of __map -->
<span class="wt-trip-card__photos" aria-hidden="true">
  <img class="wt-trip-card__photo" src="…" alt="" title="Photo: Jane Doe · CC BY-SA 4.0"><img class="wt-trip-card__photo" src="…" alt="" title="…">
</span>
<!-- no stops yet -->
<span class="wt-trip-card__map wt-trip-card__map--empty">No stops yet</span>
```

What you need to pick a trip: where it goes, its name and dates, and who's on it.

Put cards on `--wt-surface-sheet`, as the list is: the card is white and set apart by its surface alone, with no border or shadow.

- `__map` is the route, across the top of the card: a 5:2 box on `--wt-surface-map`.
  - The `svg` is a sketch of the route. Draw it in any units with `preserveAspectRatio="xMidYMid meet"`: lines and dots keep their pixel widths at any card size (`vector-effect: non-scaling-stroke`).
  - `__casing` then `__route`: the drives, in `--wt-route` over `--wt-route-casing`, like routes on the map. Add `.is-estimate` to both for drives not looked up yet: dotted, as on the map.
  - `__ring` then one `__stop` per place, like the map's pins: a dot is a path of no length (`M x y h0`), drawn by its round cap. `__ring` holds every dot, in `--wt-pin-fill` with `--wt-shadow-pin`; each `__stop` sets `--wt-kind-color`.
- `__photos`, in place of `__map` when the trip's places have photos: one to three `__photo`s side by side in the same 5:2 box, each cut to fill its share (`object-fit: cover`), with a 2px gap of the card between them. A photo tells you where a trip goes faster than its route does, so use them when you have them, and the sketch when you don't. Say who took each one and its license in its `title`, as `.wt-about` does.
- `__body`: the name (`--wt-type-name`, as a stop's; one line, cut off with an ellipsis), the dates and `__when` (how soon), and the people as a `.wt-avatar-stack` on the right. The stack's ring follows the card's surface, hovered too. Hide the stack from screen readers and say the names in a `.wt-visually-hidden` span, so the link reads "White Sands, NM, Nov 20 – 22, 2026, with Alex, Sam".
- `.is-now`: the trip is under way. `__when` ("Day 2 of 3") is in primary ink, like the row happening now.
- `__now`, at the foot of a card that `.is-now`, under a hairline: what the trip is at now and what's next. One `__step` each, like a row of the timeline: the stop's `.wt-marker--sm`, `__step-name` (one line, cut off with an ellipsis), and `__step-time` on the right, which says "Now" for the first and when it is for the next ("12:30 PM", "Tomorrow, 11:00 AM", "Tonight"). The time column already says which is which, so there's no Now or Next label. `.is-now` on the first puts it in primary ink, its time in semibold; the next stays secondary. Leave out a step there's nothing for.
- `.is-past`: the trip is over. Its route turns `--wt-route-done`; give its dots `--wt-kind-past`, as past pins have. Its photos lose most of their color.

### App bar `.wt-app-bar` and nav `.wt-nav`

```html
<header class="wt-app-bar">
  <h1 class="wt-visually-hidden">Plan</h1>
  <nav class="wt-nav" aria-label="Pages">
    <a class="wt-nav__link" href="#/" aria-current="page">${mapIcon}Plan</a>
    <a class="wt-nav__link" href="#/spots">${starIcon}Spots</a>
  </nav>
  <div class="wt-app-bar__end">${accountButton}</div>
</header>
```

The top of Home and Spots, in one row: the app's pages on the left, the account on the right. Actions on the page (New trip) go in the page, not here.

- **The bar** stays at the top as the page scrolls (`position: sticky`), 64px high (80px from 768px wide), frosted over what passes under it in the page's color (`--wt-surface-sheet`, or set `--wt-app-bar-surface`). Add `.is-scrolled` once the page has scrolled, for a hairline under it. The page's name is a hidden `h1`: the nav already shows it.
- **On a phone it tucks away** while the page scrolls down, and comes back as soon as it scrolls up: add `.is-tucked` (it slides up out of view on `--wt-duration-base`). Anything else stuck under it moves up to the top meanwhile. From 768px wide it stays.
- **`.wt-nav`** is the app's pages, as pills of an icon (18px) and a word, in `--wt-type-context`. The page you're on (`aria-current="page"`) is raised white with `--wt-shadow-hairline`, in primary ink, set apart by its surface as a card is; the others are in secondary ink, a grey pill when pointed at. Plan is `map`, Spots is `star`. For pages, not filters. Sign-in shows it under the wordmark.

### Filter `.wt-filter`

```html
<label class="wt-filter is-set">
  <span class="wt-filter__value">Washington</span>${chevronDownIcon}
  <select aria-label="State"><option value="">All states</option><option value="WA" selected>Washington</option></select>
</label>
```

One choice of a list's, as a chip, in a row of them over the list it narrows (Country, State, City over the spots).

- It says its name ("State") while it's every one, and what it's set to ("Washington") once it's set, with `.is-set`: primary ink on `--wt-surface-current`, the grey of a highlighted row. So the row says at a glance what the list is narrowed to.
- The `select` covers the whole chip, unseen: a tap opens the phone's own picker (a menu on a computer), and its 16px type keeps an iPhone from zooming in. Keep the `select`'s first option "All states": that's what the picker lists. Set `__value` from the `select` whenever it changes.
- 36px high, a pill with a hairline. A row of them can scroll sideways rather than wrap.

### Pager `.wt-pager`

```html
<nav class="wt-pager" aria-label="Pages of spots">
  <button class="wt-pager__step" data-page="0" aria-label="Previous page" disabled>${backIcon}</button>
  <button class="wt-pager__page" aria-label="Page 1" aria-current="page">1</button>
  <button class="wt-pager__page" aria-label="Page 2">2</button>
  <span class="wt-pager__gap" aria-hidden="true">…</span>
  <button class="wt-pager__page" aria-label="Page 9">9</button>
  <button class="wt-pager__step" aria-label="Next page">${forwardIcon}</button>
</nav>
```

Pages of a long grid, on a computer. On a phone, use Show more under a list instead: a list you scroll through should grow where you are.

- Up to seven pages, all of them; past that, the first, the last, and this one with its neighbours, with `__gap` between.
- This page is a white pill (`aria-current="page"`), like the nav's; the others are their numbers in secondary ink. A `__step` that goes nowhere is `disabled`, in `--wt-text-past`.

### Spot card `.wt-spot-card`

```html
<a class="wt-spot-card" href="#/spots/seattle/wikidata/Q1">
  <img class="wt-spot-card__photo" src="…" alt="" title="Photo: Jane Doe · CC BY-SA 4.0">
  <!-- no photo, or it won't load: -->
  <span class="wt-spot-card__photo wt-spot-card__photo--none" aria-hidden="true">${pinIcon}</span>
  <span class="wt-spot-card__body">
    <span class="wt-spot-card__name">Space Needle</span>
    <span class="wt-spot-card__line">The 1962 World’s Fair tower, with the city at your feet.</span>
    <span class="wt-spot-card__where">Seattle, WA</span>
  </span>
</a>
```

A place worth a trip, in a list of them, on `--wt-surface-sheet`, set apart by its surface alone like a [trip card](#trip-card-wt-trip-card).

- **On a phone, a row:** `__photo` is a 96px square on the left, and the text beside it. **From 768px wide, a card** in a grid, `__photo` across the top at 3:2.
- With no photo, `__photo--none` holds its place with a pin on `--wt-surface-map`, so the rows line up. Say who took a photo and its license in its `title`.
- `--loading`: grey bars (`__bar`, three) where the text goes and a sunken square for the photo, until the list comes, so it doesn't jump. Hidden from screen readers; say it's loading elsewhere.
- `__where` (the city and state) shows first, though it comes last in the markup, so a screen reader starts with the name: small capitals (`--wt-type-overline`) in tertiary ink. Then `__name` in `--wt-type-name`, then `__line`, the guide's one line, a sentence in secondary ink, at most two lines. Capitals and a sentence look nothing alike, so the eye goes from the name to the line.

### Guide entry `.wt-guide`

```html
<article class="wt-guide">
  <div class="wt-guide__top wt-guide__top--photo">
    <a class="wt-guide__back" href="#/spots" aria-label="All spots">${backIcon}</a>
    <img class="wt-guide__hero" src="…" alt="The dunes at sunset">
  </div>
  <header class="wt-guide__head">
    <p class="wt-guide__where">Alamogordo, New Mexico</p>
    <h1 class="wt-guide__name">White Sands National Park</h1>
    <p class="wt-guide__lede">Waves of white gypsum, the largest field of such dunes on Earth.</p>
  </header>
  <div class="wt-guide__body"><p>…</p><figure class="wt-guide__figure"><img …><figcaption>The boardwalk</figcaption></figure><p>…</p></div>
  <section class="wt-guide__section"><h2>Before you go</h2>
    <dl class="wt-guide__facts"><div><dt>Bring</dt><dd>Water and a sled.</dd></div></dl></section>
  <section class="wt-guide__section"><h2>Sources and links</h2>
    <ul class="wt-guide__links"><li><a class="wt-guide__link" href="…">
      <span class="wt-guide__link-text"><span class="wt-guide__link-label">Wikipedia</span><span class="wt-guide__link-detail">White Sands National Park</span></span>${externalIcon}</a></li></ul></section>
  <footer class="wt-guide__foot"><p>Written by AI from the sources above, and published under CC BY-SA 4.0.</p><p>Photos: …</p></footer>
</article>
```

One spot as a guidebook has it: a page to read, on `--wt-surface-raised`, with nothing else on the page (no app bar), in a column about 40em wide at most.

- `__top` holds the way back. With `--photo`, `__hero` runs across it (4:3 on a phone, 16:9 from 768px wide; let it reach the column's edges), and `__back` is a round button frosted over its top left corner, with `--wt-shadow-float`. Without a photo, `__back` is the same round button on `--wt-surface-sunken`, on its own above the name.
- `__head`: `__where` an overline (small capitals, tertiary), `__name` in `--wt-type-headline`, `__lede` the one line in secondary ink, a little larger than body.
- `__body` is the text: paragraphs at 16px with room between lines (1.65), and a `__figure` after the paragraph it shows, with its caption under it. Credits go in `__foot`, not under the photos.
- `__section`s follow, each a heading (`--wt-type-heading`) and rows between hairlines, set apart by space, not panels:
  - `__facts`: one row per fact, its label (caption, secondary) over it.
  - `__links`: every page it was written from, and the others about the place, once each. Each `__link` is a row at least 56px high: `__link-label`, what it is (Wikipedia, Official website, Google Maps), over `__link-detail`, where it goes (the article's title, the site's host), and the external icon on the right in tertiary ink.
- `__foot`: what it was written from and its license, and every photo's caption, author and license, in tertiary caption. Its links are `--wt-text-link`.

### Map pin `.wt-pin`

```html
<div class="wt-pin wt-pin--selected" role="img" aria-label="3. White Sands Visitor Center, Attraction" style="--wt-kind-color: var(--wt-kind-attraction)">
  <b class="wt-pin__num">3</b>
</div>
<!-- pins that crowd, merged: the first one's pin in front, with its number; the next ones' stacked behind -->
<div class="wt-pin wt-pin--cluster wt-pin--deep" role="img" aria-label="1–3. 3 stops here: Pecos Trail Inn, Sun Mountain Trail, Tia Sophia's"
  style="--wt-kind-color: var(--wt-kind-hotel); --wt-pin-behind-1: var(--wt-kind-nature); --wt-pin-behind-2: var(--wt-kind-restaurant)">
  <b class="wt-pin__num">1</b>
</div>
```

- **A round dot, centered on its place,** like a stop on a transit map: place the element at the place and its center lands there. 24px, ring included (`--wt-pin-size`). It covers its place and little else, so the routes running into it stay visible.
- **Its color is the stop's type** (`--wt-kind-color`, as on a [marker](#marker-wt-marker)), shaded like a marker, in a 2px `--wt-pin-fill` ring that keeps it apart from the route under it.
- **It holds one thing: its number,** in `--wt-marker-ink`. **Every pin has one: its row's in the list,** in the order the list reads, so the hotel you wake up in is 1. On the overview, the trip's stops. Numbers change only when the list does, never as the map zooms. Only a stop that isn't saved yet, with no row, has `.wt-pin__dot` instead.
- **Rows at one place share one pin, with the first one's number** (the hotel you wake up in and go back to is 1: the route comes back to it).
- **Where pins crowd, they merge** into one `--cluster` pin, at the first one's place. It's the first one's pin, round and with its own number, with the next ones' pins stacked behind it, up and to the right, each in its own color and `--wt-pin-fill` ring, like a fanned deck: one behind for two stops, two behind (`--deep`) for more. Set their colors in `--wt-pin-behind-1` and `-2` (`--wt-kind-past` for one that's over). Behind, they're flat and faded, half their color over `--wt-pin-fill` (`--wt-pin-behind-soft`, 50%), so the pin in front leads. The stack says there are several, and of what kinds; one shadow goes around the whole. The numbers it holds are the ones missing from the map, and its `aria-label` gives them all ("1–3", or "2, 6" for numbers not in a row).
  - Pins merge when they would come within 4px of each other, each into the first pin before it in the list's order that it would touch, and merged pins that touch merge again. Zoom in and it comes apart; tap it and the map zooms in to its stops. A selected pin, and both ends of a route on show, never merge.
  - Round, like every pin: a pill with all its numbers ("3–4") was tried, and it was the one pin on the map that wasn't round. The first pin alone, with a rim or a "+1" on its corner, didn't say clearly what was under it; the stack does.
  - Don't hide numbers instead: shrinking crowded pins to dots without numbers (all at once, then each by its own room) left stray numbers among dots that said nothing.
  - Never show a count: on this map a number means a row, so a "3" would read as the third.
- **Nothing else.** No name label and no time tag: the list has them. The `aria-label` gives the number, the name and the type, so color is never the only signal; a merged pin's gives all its numbers and names its stops.
- Variants: `--selected` (32px, with `--wt-shadow-pin-selected`: the selected stop, and both ends of a route on show) and `--muted` (20px and grey, `--wt-kind-past`: on today, a stop that's over; the day before's last stop, where a day with no hotel starts; or, while a route is shown, a stop it doesn't start or end at). A merged pin is muted only when all its stops are. The pins still in color are the ones that matter now.
- **A tap target of 36px**, centered on the pin (`::after`).
- **Put the pins in a `.wt-pins` element** (in the app, the map, which holds its markers). While one of them is `--selected`, the rest step back: still solid, flat, in a lighter version of their color (`--wt-pin-faded-mix` of it over `--wt-pin-fill`; deeper in dark mode), with the number in their own color, so the selected pin stands out among pins of every type. Not see-through, so the route and the map don't show through them (they used to fade to 55% opacity, which muddied them). They keep their colors rather than turn grey, since grey means over; a pin that's over stays as it is.
- The map shows only the open day, or the whole trip on the overview. Framing a day or a route leaves half a selected pin clear at the edges.

### Sight `.wt-sight`

```html
<div class="wt-sight" style="--wt-kind-color: var(--wt-kind-nature)">
  <i class="wt-sight__marker"><!-- DotsieIcons.svg('tree', 12) --></i>
  <span class="wt-sight__name">White Sands National Park</span>
</div>
```

- **A place worth seeing, on the map**, as a maps app shows its places once you zoom in. It's part of the map, not of the plan, so it's the plan's pin turned inside out: a 22px disc in `--wt-pin-fill`, the type's icon at 14px in the type's color (`--wt-kind-color`), a 1.5px ring of that color around the edge, and the pin's light shadow, so it reads over the light and the dark map. Its name is in the markup but hidden: the icon says what kind of place it is, and its card says the rest.
- **Placed by its marker's center**, at the place, like a [pin](#map-pin-wt-pin).
- **Pointed at with a mouse, or focused** (it, or the element holding it), it's the solid marker: 24px in the type's color, the icon at 14px in `--wt-marker-ink`, a `--wt-pin-fill` ring and the pin's shadow, the same about its center. On its own, outside a `.wt-sight` (as in a sight's card), `.wt-sight__marker` is that solid marker.
- **Its name shows while it's hovered with a mouse:** to the marker's right, in 12px ink with a halo in `--wt-pin-fill`, so it reads over the light and the dark map. A long name stops at 160px with an ellipsis. Bring that marker in front of the others while its name shows. Not while it's selected: its card is open, with the name at the top.
- **The plan comes first.** A stop's pin is a solid color with a white number, standing off the map; a sight is the pin's ring color with a colored ring and icon, smaller and never numbered, so the pins and the routes read first. Put sights in a layer over the map's own names, so no name hides them, and under the pins; leave a place for a sight only where its marker clears the pins, the routes and the other sights, so the day's line runs unbroken from stop to stop. (They used to be solid 20px markers with a shadow, as strong as the pins, and sat on the routes, breaking the line. Then 16px tinted discs with a 10px icon and no shadow, which were too faint to see on the map.)
- **While a pin is `--selected`,** the other pins step back to a lighter solid color and the sights to 70%, so none outshines the plan; they still read, since a selected stop is where you look around. This works for sights inside the element that holds the `.wt-pins` element (in the app, the map's parent).
- **It's a button.** Give it (or the element holding it) `role="button"`, a tab stop and an `aria-label` that says its name and what tapping does ("Alameda Park Zoo, Attraction. Show more"). Its tap target is 42px square, around the marker.
- **`.is-selected`** while its card is open: the solid marker grows to 32px (its icon to 18px) about the same center, with the selected pin's shadow, and no name beside it (its card says it). Bring it in front of the other sights.
- It fades in on `--wt-duration-base` when it appears.

### About `.wt-about`

```html
<div class="wt-about">                                  <!-- --compact: small photo beside the lines -->
  <img class="wt-about__photo" src="…" alt="">          <!-- only when there's a free picture -->
  <div class="wt-about__body">
    <p class="wt-about__text">White Sands National Park is …</p>
    <div class="wt-about__src">
      <a class="wt-about__credit" href="(its Commons page)">Photo: Jane Doe · CC BY-SA 4.0</a>
      <a class="wt-about__more" href="(the article)">Wikipedia <!-- icon('external', 12) --></a>
    </div>
  </div>
</div>
```

- **What a place is, from Wikipedia:** the article's lead picture, its first lines, and where both are from. A [sight](#sight-wt-sight)'s card has it under the name and type, and a stop at a sight's place has it at the top of its sheet.
- **The photo** is 144px tall across the card, cropped to fill (`object-fit: cover`), on `--wt-surface-sunken` until it loads, with `--wt-radius-md` corners. Leave it out when there's no free picture: nothing takes its place.
- **The lines** are body type in secondary ink, four at most, then an ellipsis: the card is for deciding, the article is a tap away.
- **Under them,** in caption type: the photo's author and license in tertiary ink, linking to its Commons page (a CC license asks for the credit), cut with an ellipsis when long; and **Wikipedia ↗** in link blue at the right, which never shrinks. With no photo, only the link.
- **`--compact`:** a 72px square photo beside the lines, three at most, in caption type. For the top of a stop's sheet, where the fields matter more.
- **`--loading`:** grey blocks where the photo and three lines will be (`.wt-about__line`, the last one shorter), so the card doesn't jump when they come. If nothing comes, take it out.

### Wordmark `.wt-wordmark`

```html
<h1 class="wt-wordmark">
  <span aria-hidden="true">Dots<span class="wt-wordmark__i">ı</span>e</span>
  <span class="wt-visually-hidden">Dotsie</span>
</h1>
```

The app's name, with a stop for the i's dot, where the app names itself: the sign-in page. Set it in whatever bold type that place uses (the display type on sign-in); the dot is sized from the type and follows it.

- **The i** is a dotless ı (`.wt-wordmark__i`) with the logo's orange stop (`--wt-brand-dot-i`) for its dot, a little bigger than a letter's, where Inter Bold puts its own.
- **No colon.** The :D colon is the icon's; before a word it reads as a typo.
- **What's read** is the hidden "Dotsie": the drawn name, "Dotsıe" with its dot, is `aria-hidden`, so a screen reader doesn't spell it out.

### Empty state `.wt-empty`

```html
<p class="wt-empty">Add a flight, a hotel, or a place to see.</p>
```

Say what can go here, in the user's words. No illustrations.

## Patterns

- **The trip screen.**
  - On a phone: `.wt-trip-head` across the top, the map under it, and `.wt-sheet` over the map, at half height or the whole day.
  - From 768px wide: the header and the sheet are a side panel on the left, and the map fills the rest. Modal sheets cover the panel. Fit the map with even padding: nothing covers it.
  - One day at a time, after the overview. The day tabs go to any of them (or swipe the list sideways), and the map shows only the open day; on the overview, the whole trip.
  - A pin is a dot in its marker's color with its row's number in the list; where pins crowd, they merge into the first one's pin, with the others' pins stacked behind it. The map has no text. The list says what each pin is: the half list keeps the row in focus in its middle.
  - Tapping a pin selects its stop (`is-selected`). Tapping a route, or its drive in the list, marks the drive `is-active` and shows the route: both ends' pins larger, the map fitted to it, and the drive in the middle of the half list, between its two stops. Tapping the drive again goes back to the whole day.
  - Editing a stop leaves the map in view (a panel), with the stop's pin showing the edit as it happens.
- **Today.** During the trip, the trip opens on today. On any other day, it opens on the overview.
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

### Added in 15.2.0

- New: `.wt-tl-idea`, a row on a trip's Want to go list: a `.wt-tl-stop` with no rail, since its places are in no order yet. See [Timeline](#timeline-wt-tl).
- New icon: `trash` (icons 4.2.0), on the button that takes a place off Want to go.

### Added in 15.1.0

- New: `.wt-filter` (`.is-set`), with `__value`. See [Filter](#filter-wt-filter).
- New: `.wt-app-bar.is-tucked`, the bar out of view on a phone while the page scrolls down. See [App bar](#app-bar-wt-app-bar-and-nav-wt-nav).

### Changed in 15.0.0

The guide entry is a page to read, with its sources and links at the end, and no buttons in it.

- `.wt-guide`: new `__top` (`--photo`), `__hero`, `__body`, `__section`, `__links`, `__link`, `__link-text`, `__link-label` and `__link-detail`. `__back` is a round icon button (was a text link with an icon), frosted over the photo. `__name` is `--wt-type-headline` and an `h1`. `__facts` is a list of rows (a `div` per fact) between hairlines, inside a `__section` (was a sunken panel with its own heading).
- Removed: `.wt-guide__credit` (credits go in `__foot`), `__para` (paragraphs are `p` in `__body`), `__facts h3` and `.wt-guide a` (only `__foot`'s links are link-colored).
- New token: `--wt-type-headline` (600 26/32), a spot's name (tokens 2.2.0).

### Added in 14.1.0

The app has a second page, Spots, for anyone, and Home and Spots share an app bar.

- New: `.wt-app-bar` with `__end` and `.is-scrolled`, and `.wt-nav` with `__link` (an icon and a word; `aria-current="page"`). See [App bar](#app-bar-wt-app-bar-and-nav-wt-nav).
- New: `.wt-pager`, with `__page`, `__step` and `__gap`. See [Pager](#pager-wt-pager).
- New: `.wt-spot-card` (`--loading`), with `__photo` (`--none`), `__body`, `__name`, `__line`, `__where` and `__bar`. See [Spot card](#spot-card-wt-spot-card).
- New: `.wt-guide`, with `__back`, `__figure`, `__credit`, `__head`, `__where`, `__name`, `__lede`, `__para`, `__facts` and `__foot`. See [Guide entry](#guide-entry-wt-guide).
- The wordmark is now on sign-in only.

### Changed in 14.0.0

The day bar is a row of day tabs: Overview, then every day, with a calendar to jump to any day. The list turns the page when swiped sideways.

- New: `.wt-day-tabs`, `.wt-day-tab` and `.wt-day-tabs__bar`, and `.wt-day-bar__cal`, in `.wt-day-bar`. See [Day tabs](#day-tabs-wt-day-bar-and-day-calendar-wt-day-cal).
- New: `.wt-day-cal`, with `__head`, `__overview` and `__month`, built on `.wt-cal`'s days.
- New: `.wt-sheet__peek`, the page coming in while the list is swiped. The list is `touch-action: pan-y` at full height and in the side panel (was `auto`).
- New icon: `calendar` (icons 4.1.0).
- Removed: `.wt-day-bar__step`, `.wt-day-bar__title` and `.wt-day-bar__label` (the ‹ day › bar), and `.wt-day-list` with `__item`, `__name` and `__kinds` (the list of days in a modal sheet).
- "All days" is now "Overview". Tokens are unchanged.

### Changed in 13.0.0

Waythread is now Dotsie, with a logo.

- Renamed: the icons' global `WaythreadIcons` is `DotsieIcons` (icons.js 4.0.0).
- New: the logo, [`logo.svg`](logo.svg), and the wordmark, `.wt-wordmark` with `__i`. See [Logo](#logo).
- New tokens: `--wt-brand-dot-top`, `--wt-brand-dot-bottom` (the logo's colon) and `--wt-brand-dot-i` (the wordmark's i) (tokens 2.1.0).

### Added in 12.3.0

Home groups trips under Current, Upcoming and Past, and a trip under way says what it's at now and what's next.

- New: `.wt-trip-card__now`, with `__step` (`.is-now`), `__step-name` and `__step-time`. See [Trip card](#trip-card-wt-trip-card).
- Tokens are unchanged.

### Added in 12.2.0

A day and a time are picked as in a calendar app, a day and then a time, rather than in the browser's date-and-time field. Stops also have a time zone, the place's own unless someone picks another, and an optional duration.

- New: `.wt-when` (with `__date` and `__time`), `.wt-when-page` (and `__done`), the month `.wt-cal` (`__head`, `__month`, `__grid`, `__wd`, `__day`, `__n`, `.has-stops`) and the wheels `.wt-wheels`, `.wt-wheel` and `.wt-wheel__item` (`.is-on`).
- New: `.wt-when__zone` (with `__zone-name`), the line under Arrive that says which clock its times are on and opens the zones; `.wt-zone-search`, the search field over them.
- New: `.wt-tl-zone`, a stop's zone after its time in the timeline, where the clocks change.
- New: `.wt-field__label--split` and `.wt-field__aside`, for something on the right of a field's label (a hotel's nights beside Check-out).
- Duration is a picker (`.wt-picker--text`, with when it ends as its detail) and a note in the timeline: no new classes.
- Fixed: `.wt-modal__head--sticky` sticks at the sheet's very top, over its top padding, so fields no longer show above the title as they scroll.
- Tokens are unchanged.

### Changed in 12.1.0

Sights were too faint to see: 16px pale discs with a 10px icon, at 40% while a stop was selected, which is now where the map zooms in to and they show.

- **`.wt-sight`'s marker is now a 22px disc in `--wt-pin-fill`** with its icon at 14px in the type's color, a 1.5px ring of that color and the pin's shadow. Hovered or focused, the solid marker is 24px (icon 14px); selected, 32px (icon 18px). The tap target is 42px. The markup is unchanged.
- While a `.wt-pin--selected` is in the `.wt-pins` element, the sights step back to 70% (was 40%).
- Tokens are unchanged.

### Changed in 12.0.0

A clear-out: everything the app and the prototype no longer use, which earlier versions kept until a major version.

- Removed classes: `.wt-kinds` (and `__item`, `__icon`), `.wt-nights` (and `__row`, `__step`, `__n`, `__out`), `.wt-field-row`, `.wt-input-group__prefix`, `ul.wt-results` with `.wt-results__item`, `__name` and `__detail`, `.wt-tl-drive__go`, `.wt-view-toggle`, `.wt-map-bar`, `.wt-pin--compact`, `.wt-pin--dot`, `.wt-icon-btn--sm`, `.wt-icon-btn--muted`, `.wt-avatar--lg`, and the faded look of a `disabled` `.wt-option`, which only the stop sheet's Folder picker used.
- Removed icon: `person-add` (icons v3.0.0). Nothing shows it since the trip header lost its people.
- Removed tokens (tokens v2.0.0): `--wt-border-control`, `--wt-action-done`, `--wt-action-done-text`, `--wt-pin-ring`, `--wt-pin-ring-muted`, `--wt-pin-ring-done`, `--wt-kind-travel`, `--wt-kind-stay`, `--wt-kind-food`, `--wt-kind-sight`, `--wt-kind-shop`, `--wt-marker-gloss` and `--wt-size-check`.
- `.wt-input-group` stays: the search field uses it for its icon.
- The demo page's stop sheet shows Check-out as a day and time, as the app does, and its drives no longer have a Directions icon.

### Changed in 11.0.0

Folders are gone. Where pins crowd on the map, they already merge (`--cluster`), so grouping stops by hand only added a second way of saying "several stops here", in the list and on the map.

- Removed: `.wt-tl-stop--folder`, `.wt-tl-stop--in`, `.wt-tl-drive--in`, `.wt-tl-thread`, `.wt-marker--stack`, `.wt-marker--none`, `.wt-tl-note--quiet`, `.wt-pin--folder`, and `--wt-stack-tint` and `--wt-stack-ground`.
- Removed: swiping a row, `.wt-tl-swipe` (and `__in`, `__out`, `is-in`, `is-out`, `is-new`, `is-armed`), `is-swiping`, `is-settling`, `is-swipe-target` and `is-swiping-row`. Stop rows no longer set `touch-action`.
- Removed: `.wt-pin--open` and `is-folder-open` on `.wt-pins`, unused since 9.5.1.
- Removed icons: `indent`, `outdent` and `stack-add` (icons v2.0.0).
- Tokens are unchanged.

### Added in 10.6.0

Place search's suggestions were only sights; for somewhere to eat, it now points to the maps app.

- New: `.wt-results__more`, a link under the results to more in another app, in link blue with the `external` icon.
- Tokens are unchanged.

### Changed in 10.5.0

While a pin was selected, the other pins faded to 55% opacity: the route and the map showed through them, and they looked muddy.

- **The pins beside a selected one are now solid,** flat, in a lighter version of their color (deeper in dark mode), with the number in their own color. A pin that's over (`--muted`) is unchanged. The markup is unchanged.
- New tokens: `--wt-pin-faded-mix` and `--wt-pin-faded-ink-lift`.

### Changed in 10.4.0

Sights were as loud as the trip's own pins: solid 20px markers in the type's color with a shadow, sitting on the routes. Zoomed in to a town, they crowded out the stops and broke up the day's line.

- **`.wt-sight`'s marker is now a 16px tinted disc** with its icon in the type's color, a hairline edge and no shadow. Hovered, focused or selected, it's the solid marker it was. `.wt-sight__marker` on its own (a sight's card) is unchanged. The markup is unchanged.
- New: while a `.wt-pin--selected` is in the `.wt-pins` element, the sights beside it fade to 40%.
- Tokens are unchanged.

### Added in 10.3.0

Adding a stop on an iPhone opened a blank screen: the search field was focused while the sheet was still sliding up from below the screen, so Safari panned the page down to it. Place search also now suggests what's on the way.

- New: `.wt-modal--in-place`, a phone's sheet that fades in where it'll stay. For a sheet that opens on a search page with its field focused.
- New: `.wt-results__head`, a heading over suggestions shown before anything's typed.
- New: `.wt-option__tag`, a word at the start of an option's detail that sets it apart (*On the way*).
- Tokens are unchanged.

### Added in 10.2.0

A trip's card showed only the sketch of its route, and a line on a blank map doesn't say where a trip goes. Now it shows photos of its places when they have them.

- New: `.wt-trip-card__photos` and `__photo`, up to three photos across the top of a card, in place of `__map` (see [Trip card](#trip-card-wt-trip-card)). `.is-past` drains their color.
- The sketch's markup is unchanged. Tokens are unchanged.

### Changed in 10.1.1

A selected sight's name showed beside its marker, cut short, while its card said it in full right below.

- **`.wt-sight.is-selected` no longer shows its name;** only its marker grows. Hovering it with a mouse doesn't show the name either. The markup is unchanged.

### Added in 10.1.0

Tapping a sight on the map opened Add stop straight away: you couldn't see what a place was before starting to add it. Now it opens a card that says.

- New: `.wt-about` (and `--compact`, `--loading`), a place's photo, first lines from Wikipedia, and their credit (see [About](#about-wt-about)).
- New: `.wt-sight.is-selected`, the sight whose card is open. It shows its name.
- **A sight's name is hidden** unless it's selected or hovered, and its tap target is a 36px square: sights go over the map's own names now, and their names covered them. The markup is unchanged.
- Tokens are unchanged.

### Changed in 10.0.0

Home's cards no longer show a map picture from Stadia over the route sketch: each one cost 2,000 credits from the Stadia plan, and another whenever the trip changed or the theme did. The sketch, drawn by the app, is the card's route.

- Removed: `.wt-trip-card__photo` and its `.is-loaded`. Take the `<img>` out of `__map`. The sketch's markup is unchanged.

### Changed in 9.8.1

An open folder had two lines side by side: the day's rail and its stops' thread.

- **One line:** beside an open folder's stops, the day's rail bends into their `.wt-tl-thread` at the first stop and back out after the last, with rounded corners, instead of running on beside it. The markup is unchanged.
- **The rail is 2px** (`--wt-tl-line`, new), and the rail, the thread and the bends are all borders. At 1.5px the bends looked thinner than the rail: browsers round a 1.5px border down to 1px but snap a 1.5px background (the rail's, then) to 2px on a 3x screen. A whole pixel draws the same everywhere, and on a 3x phone the rail looks as it did.

### Added in 9.8.0

The map still hid numbers where pins crowded, and the hotel at either end of a day and an open folder's stops had none, so a day read as a few numbers among dots. A folder's pin, a disc with another peeking out above it, looked like two pieces.

- **Every pin has a number,** its row's in the list: the hotel you wake up in and go back to, and an open folder's stops, too.
- New: `.wt-pin--cluster` (and `--deep`), pins merged where they crowd: the first one's pin in front, with its number, and the next ones' stacked behind it in their colors (`--wt-pin-behind-1`, `-2`). It replaces `--compact` and `--dot`, which are unused (see [Map pin](#map-pin-wt-pin)).
- **`.wt-pin--folder` is one badge:** 28px, with a rim of their color inside the `--wt-pin-fill` edge, instead of a second disc piled behind. `--wt-stack-tint` on a pin now mixes with `--wt-pin-fill`. The list's folder marker (`.wt-marker--stack`) is unchanged.
- Tokens are unchanged.

### Added in 9.7.0

A stop's links (a booking, a flight, tickets) were addresses in its note: crowded, all alike, and small to tap.

- New: `.wt-tl-links`, `.wt-tl-link` and `.wt-tl-link__label`, a stop's links as buttons under its notes, and `.wt-tl-links-hint`, the link icon a phone shows in their place on an unselected stop ([Timeline](#timeline-wt-tl)).
- New: `.wt-link-list`, `.wt-link-edit` (with `__fields`, `__label`, `__url`, `__remove`) and `.wt-link-add`, for editing them ([Field](#field-wt-field-input-wt-input-search-page-wt-search-bar-wt-search-results-wt-results)).
- `.wt-tl-stop` has a third content row, for its links, before its bottom padding.
- New icon: `link` (icons v1.8.0).
- Tokens are unchanged.

### Added in 9.6.0

One pair of crowded pins turned every pin on the map into a dot, so a day zoomed out had no numbers at all.

- New: `.wt-pin--compact`, an 18px pin with a smaller number (16px when `--muted`), for a pin close to another numbered pin.
- **Map pins:** `--compact` and `--dot` go on each pin by its own room, no longer on every pin or none (see [Map pin](#map-pin-wt-pin)).
- Tokens are unchanged.

### Changed in 9.5.1

- `.wt-pin--folder.wt-pin--selected`: a folder's pin can be selected (an end of the route on show), and its piled disc grows with it.
- `.wt-pin--open` and `is-folder-open` on `.wt-pins` are unused: an open folder's stops are pins like any others, and nothing fades around them. They stay until the next major version.
- Tokens are unchanged.

### Added in 9.5.0

- New: `.wt-sight`, `.wt-sight__marker` and `.wt-sight__name`, a place worth seeing on the map with its name ([Sight](#sight-wt-sight)).
- Tokens are unchanged.

### Added in 9.4.0

Folders: stops that follow each other, grouped under a name.

- New: `.wt-tl-stop--folder`, a folder's row, and `.wt-tl-stop--in`, `.wt-tl-drive--in` and `.wt-tl-thread` for its stops and drives.
- New: `.wt-marker--stack` (a folder's marker), `.wt-marker--none`, `.wt-tl-note--quiet`.
- New: `.wt-pin--folder`, `.wt-pin--open` and `.is-folder-open` on `.wt-pins`.
- New: swiping a row, `.wt-tl-swipe` with `__in`, `__out`, `is-in`, `is-out`, `is-new`, `is-armed`; `is-swiping`, `is-settling` and `is-swipe-target` on rows; `is-swiping-row` on the root. `.wt-tl` is now `position: relative`, and `.wt-tl-stop` has `touch-action: pan-y`.
- New: a `disabled` `.wt-option`.
- New icons: `indent`, `outdent`, `stack-add` (icons v1.7.0).
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
