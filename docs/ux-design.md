# Dotsie UX Design

This document describes the UX of Dotsie, the reasoning behind it, and what was left out on purpose. The app in [`app/web`](../app/web) and the prototype in [`prototype/`](../prototype) look and behave the same: the prototype is the app's frontend with the server swapped for the browser (see [CLAUDE.md](../CLAUDE.md)). It builds on the [proposal](proposal.md).

## Principles

The proposal set three principles. This is how each one shows up in the design:

| Principle | In practice |
| --- | --- |
| **Less is more** | Show information only when it is essential, isn't shown elsewhere on screen, and can't be inferred at a glance. Each element earns its place. |
| **The route and the plan are the focus** | The map fills the screen and the plan sits on top of it. The most prominent things are the stops and the routes between them, not controls. |
| **Co-editing is the default** | Every trip is shared. Everyone on it can edit, and the people on a trip are one tap away, in trip settings. The only role is the owner, who made the trip and is the only one who can delete it. |

One more rule came out of the iterations: **don't rebuild what Google Maps and Apple Maps already do.** Dotsie plans the trip and hands off to the phone's maps app for navigation.

## Screens

### Home

Home looks like the trip screen's list: the same grey as the plan sheet, the same day-heading capitals, the same pins and routes, and the main action in the same place.

- **The app bar**, one row across the top: the logo (:D, a link home), the nav, and on the right the account (and New trip, from 768px wide). It stays at the top as the page scrolls, frosted over what passes under it, with a hairline under it once something has. On a phone, **New trip** is a black bar at the bottom, where Add stop is on the trip screen, so it's always in reach; from 768px wide it's in the app bar. (It was the wordmark, big, over the account, with the nav on a row of its own; one row leaves more of the screen to the trips.)
- The trips, under **CURRENT**, **UPCOMING** and **PAST**, in capitals like the day headings on the trip's Overview. Current is a trip under way today; Upcoming goes by date, soonest first, and trips with no dates yet last. Past goes from the latest back.
- One card per trip, white on the grey, set apart by its surface alone like the list's rows: **photos of where it goes**, or its **route**, across the top, then its **name**, **dates and when**, and **who's on it**. Where a trip goes and who's going are how people tell trips apart, more than a name they typed in a hurry.
  - The photos are of the trip's first places that have one, up to three side by side, in the plan's order: the photo of the place's English Wikipedia article. A place added from a sight on the map (or at one) has its article already, as its stop sheet shows; any other, found by place search or added by an assistant, is looked up by its name near where it is ("White Sands National Park" for its visitor center). Airports, hotels and places to eat are left out: their photos don't say where a trip goes. A photo of the dunes says "White Sands" at a glance, where a line on a blank map doesn't. Each one says who took it and its license when you point at it. A trip none of whose places has a photo shows its route instead, and so does every card offline, as the photos aren't saved for offline. The route shows until the photos come in; Home asks about a trip's first places only, a card's worth at a time, so a long list of trips can't use up the per-person limit place search shares with them.
  - The route is a small sketch of the trip's drives, every day, like the trip's Overview map: a line for each drive and a dot for each place, in its type's color, on the plain map color. The app draws it, as the trip's map draws them: pins as dots in a ring, a drive along the roads as a line, and one not looked up yet dotted. A drive follows the roads once anyone on the trip has looked it up (opening the trip does that); until then it's a straight line. Home never looks routes up itself, so a long list of trips can't use up the per-person limit that place search shares with routes. There's no map picture under it: a picture from Stadia cost 2,000 credits from its plan each time a trip changed. A trip with no stops says so instead.
  - The dates, always with the year ("Nov 20 – 22, 2026"; one over New Year says both), then when the trip is: "In 2 weeks", "Tomorrow", or while it's under way, "Day 2 of 3", in black like the row happening now.
  - While it's under way, the foot of the card says what the trip is at now and what's next, as the trip screen has today, in two rows like the timeline's: the stop's marker, its name, and on the right where the time goes, **Now** for the row happening now (where you woke up, a stop, or tonight's hotel), then when the next one is ("12:30 PM", "Tomorrow, 11:00 AM", or "Tonight" for tonight's hotel). The time column says which is which, so there are no Now and Next labels beside the names. Before the day's first stop there's only the next one; after the trip's last, only now. Opening the app mid-trip answers "what are we doing now?" without opening the trip. Both move on by themselves while Home is open.
  - The people are avatars, as in trip settings, up to four; past that, three and a "+N".
  - A trip that's over drains of color, like what's over on the trip screen: its route and pins go grey, and its photos lose most of theirs.
- **The nav**, beside the logo: **Plan** (this page) and **[Spots](#spots)**, as pills. The page you're on is a white pill with a hairline, in black; the other is only its word, in grey. The sign-in screen has it too, under the app's name, so Spots is a tap away without an account.
- The cards leave out stop counts, and a trip not under way leaves out its next stop: you can see those after opening a trip, and they don't help you pick one.
- With no trips yet, the page says how to start one.

### Spots

Places worth a special trip, each with a short guide, open to anyone: signed in or not, from the nav on Home or sign-in, or at `#/spots`. It looks like Home: the same app bar, the same grey with white rows or cards on it.

- **A search, then filters** for country, state and city. The search looks in each spot's name and its one line, as you type. The filters narrow from the widest: the states are those of the country chosen, the cities those of the state. Picking a city sets its state; picking another country drops a state or city it doesn't have. With only one country in the guide so far there's nothing to choose, so Country stays out of the way until there's a second.
- **One row per spot on a phone**: a square photo on the left (a pin on the map's color when it has none, or it won't load), and beside it where it is with how many views it has, in small grey capitals (`SEATTLE, WA · 1.9M VIEWS`), the name, and the guide's one line on it in grey, at most two lines. Where and the one line look nothing alike, so the eye goes from the name to the sentence. **From 768px wide, a grid of cards**, like trip cards, the photo across the top.
- **Most viewed first.** A spot's views are how often its English Wikipedia article was read over the last 12 months: the one measure of how much people care about a place that nearly every spot has, and steady through the seasons. A National Park Service place with no article takes the views of its Wikidata item. Ties go by the guide's own order for the city. A line under the list says what the order is, and that the guides are written by AI.
- **A spot's page** (`#/spots/<city>/<source>/<id>`) reads like a guidebook: **All spots** back to the list (where you left it, scrolled as it was), the lead photo with its caption and credit, the city and state in small capitals, the name, its one line, two or three paragraphs, **Before you go** (the practical facts) on a grey panel, **Open in Maps** (the maps app picked in Account) and the place's **Website**, and at the foot, what it was written from, its license (CC BY-SA 4.0), how often it's read, and every photo's author and license.
- **On a phone, 30 at a time, with Show more** under them: a list you scroll through grows where you are. **On a computer, pages of 24** (rows of 2, 3 or 4) with a pager under them (‹ 1 2 3 … 9 ›): a grid that kept growing would lose your place, and a pager says how many there are and lets you go back to one.
- Spots needs a connection: it isn't saved for offline. Without one, the list says so.
- Left out for now: adding a spot to a trip (open it in Maps, then add it from place search), a map of the spots, and trending (what's read more now than usual): only the year's total is loaded so far.

### Trip

The trip is a single screen: a **header** with the trip's name, the **map**, and the **stop list** in a sheet over the map. There are no List/Map tabs. On a phone you drag the sheet between two heights: half the screen and the whole day.

```
┌──────────────────────────────┐
│╭ ⌂  White Sands, NM       ⚙ ╮│  ← header card: home · trip · settings
│  map: numbered pins + routes │  ← what's over is grey
├──────────────────────────────┤  ← grab handle
│ Overview  Fri 20  Today  Sun 22 📅│  ← day tabs: tap one, or swipe the list
│                  ‾‾‾‾‾       │  ← the open one, in black
│ (🛏) Holiday Inn              │  ← last night's hotel
│  ⊖   10 min drive            │  ← car on the rail; tap it for the route
│ (🏛) Museum of Space   9:30 AM│  ← marker · stop · time
│  ⊖   34 min drive            │  ← highlighted: you're on it now
│ (🍴) Cloudcroft       12:30 PM│
│      Lunch                   │
│  ⊖   35 min drive            │
│ (🛏) Holiday Inn              │  ← tonight's hotel
│ [████████ + Add stop ███████]│  ← black, pinned to bottom
└──────────────────────────────┘
```

With a stop selected, the bottom button becomes `[████ ▢ Open in Maps ████] (✎) (+)`: the place in your maps app, then Edit stop as a round white pencil, and a small round + so adding is still one tap away. With a drive's route on show, it becomes `[██████ ◇ Directions ██████] (🚗) (+)`: the round button in the middle shows how you're getting there, and changes it (see [How you get there](#how-you-get-there)). Changing from one to another morphs rather than swaps: Add stop shrinks to the right into the +, and Open in Maps and Edit stop grow in beside it (see [Adding and editing a stop](#adding-and-editing-a-stop)).

**The header** is one row: **home** (back to the trip list), the **trip's name**, and **trip settings**. Between the name and settings, a small grey icon shows the trip's [offline](#offline) status, and tapping it explains what it means in a toast. On a phone it's a card floating over the top of the map, like the from/to card in Google Maps' directions, and the map runs under it. It replaced two buttons that floated over the map's corners: with them, nothing on a phone said which trip you were in. People and sharing stay in trip settings. It's kept quiet, since the plan is what you read: a 44px row, the name at 15px in grey, below the stop names, grey icons, and over the map a frosted, slightly see-through card with a light shadow. (It started as a 56px solid white card with a 17px name, which competed with the list.)

**The sheet** is white and, on a phone, has two heights:
- **Half**: the default. One fixed height, the same on every day: the list fits exactly three stops and the drives between them, a selected stop with the stops before and after it, each stop counted with its one line of notes. On a short screen it's never more than about 60% of it. (It used to be at least half the screen and measured from each day's own rows, so it changed height from one day to the next; a fixed height is steadier and leaves more of the map.) Selecting a stop opens its notes without resizing the sheet. Drive rows are compact for the same reason: the stops are what you read, the drives join them. **The half list is about one row, kept in its middle** (see [The focused row](#the-focused-row)), and you can't scroll it by hand: a finger moves the sheet, and a wheel or trackpad does nothing. To browse the day, pull it up to the whole day, or tap a pin.
- **The whole day:** the sheet fills the screen up to the header, and the header card docks, flat across the top, so the two read as one page. Home and settings stay in reach.
- **It never hides.**

**The grab handle sits over the top edge of the day tabs,** not on a row of its own, as in a maps app's sheet; the tabs and the calendar button take the taps over it. A hairline under the tabs divides them from the list, and the open tab's bar sits on it. That and a tighter add bar (8px around Add stop, or the phone's safe area below it if that's taller) leave more of the half sheet to the list.

**Moving the sheet is dragging,** as in Google Maps, from anywhere on it: the grab handle, the day tabs, or the list. A sideways swipe on the list turns the page instead (see [Days](#days)).
- Dragging the list up grows the sheet; once it's the whole day, the list scrolls. Below the whole day it never scrolls by hand.
- With the whole day showing, pulling the list down from its top shrinks the sheet. A swipe up from its top always scrolls the list: the sheet takes a touch only once the finger has clearly gone down, and the list doesn't bounce at its top. (A pull down used to be claimed at the first pixel. On an iPhone that stopped the scroll for the whole touch, and a finger setting off up the list often moves a pixel down first, so the first swipe up from the top often did nothing.)
- A flick goes on to the other height; a slower drag settles at the nearer one.
- **Taps:** tapping the grab handle switches between half and the whole day. Choosing a stop or a drive on the whole day brings the sheet down to half. No other tap resizes the sheet, so a missed day-bar button can't hide the list.
- **Zooming the map** doesn't move the sheet.

Why: the sheet used to have three heights reached by taps, and any tap on its top that missed a button pulled it down, so it was easy to hide the list by accident. Then it had two heights and a Map/List button in the header, which felt unlike any maps app. Dragging between three heights, the way Google Maps does it, gave a map view, a half view and the whole day, with nothing to mis-tap. Then the lowest height, a peek, was dropped twice over: first it became a compact sheet (the day bar, the row in focus and the add bar) and replaced half; half, with the focus's neighbors in view, was preferred, so it's back, and the peek is gone. Two heights, dragged.

#### The focused row

The half list is about one row, its **focus**: the selected stop; or else the drive whose route is on show; or else, on today, the row happening now. With none of these (another day, nothing selected), the list starts at the top.
- **Tapping the focus again changes nothing:** no animation, in the list or on the map, unless what it shows has gone out of view.
- **The focus sits in the middle of the half list,** so the rows before and after it are in view and one tap away. At the ends of the day the list can't scroll past its first or last row, so those stay near the edge. A stop taller than the list (a long note) shows from its top, so its name stays in view.
- **It's put there whenever it changes or the sheet comes to half:** opening a day, tapping a stop, a pin, a drive or a route, clearing the selection (the focus falls back to the row happening now), saving or adding a stop (the stop you saved is selected, wherever its time put it), the row happening now moving on, a co-editor's change that moves it, coming to half from the whole day, and turning the phone. The whole day doesn't pull the list back while you scroll it; going back to half does.
- **It moves once.** When the sheet changes height and the list has to scroll, both move together, in the same quarter second, so the row goes straight to the middle and never leaves the screen. (The list used to scroll after the sheet had settled, so a stop tapped on the whole day slid off the list and back.) A second tap while it's moving starts it again from where it is, with a whole quarter second of its own; it used to get only what was left of the first, so a quick second tap jumped. And the quarter second starts with the first frame drawn, after the tap has redrawn the list and the map, so on a slow phone the sheet doesn't jump most of the way in its first frame.
- **Nothing scrolls on its own, even at the ends of the day.** A taller list has less room to scroll, so near the last row the browser used to cut the list's scroll back part way through a drag or a change of height: the rows rode with the sheet and then stopped dead, as if the list had scrolled by itself. Now the scroll comes down evenly with the height, to where it can be at the new one. A day shorter than the whole-day list moves from the first frame too, instead of waiting for the sheet to come down to its rows. And a tap scrolls the list from where it is, as a real scroll would: the app keeps where the list is scrolled to, rather than reading it back from the page. On an iPhone, redrawing the list's rows could leave it at its end for a moment, and the movement set off from there, so a tap near an edge sent the list to the end of the trip and back.
- **The list fades out at an edge with more of the day past it,** top or bottom, so it's clear there are stops you can't see.
- The map zooms to fit the day's stops in what's left above the sheet and below the header, in quarter zoom levels so the day fills that space (whole levels only left it up to half the size it could be). When the sheet changes height, or the screen does (turning the phone), the map re-fits for the new space, unless you've moved the map yourself or it's on a stop you chose: then it keeps its zoom, and the selected stop stays in view. (Turning the phone used to throw the zoom away.) **Whole day** (see [The map](#the-map)) brings the day back.
- **When the day's stops change** (a stop added, moved or taken off, by you or a co-editor), the map re-fits only while it shows the whole day, so the new stop is in the picture. Anywhere else, on a stop, a drive or where you've moved it, it stays: a co-editor's edit never moves the map from under you. (It used to fly back out to the whole day.)

**On a computer or tablet** (768px wide and up), the header and the sheet become a side panel: the plan down the left, about a third of the window (360–440px), and the map filling the rest. There's nothing to drag: the header tops the panel, above the day tabs. Opening a stop or settings covers the panel, so the map stays in view beside it, with the stop being edited in the middle.

```
┌─────────────────────┬──────────────────────────────────┐
│ ⌂  White Sands, NM ⚙│                                  │
│Overview Fri 20 Today 📅│                                  │
│ (🛏) Holiday Inn     │        map: pins + routes        │
│  ⊖  10 min drive   ◇│                                  │
│ (🏛) Museum   9:30 AM│                                  │
│  …                  │                                  │
│ [██ + Add stop ████]│                                  │
└─────────────────────┴──────────────────────────────────┘
```

#### Days

**One day at a time, after the Overview.** The list and the map show a single day: a day is the unit you plan and travel by. Before the first day comes the **Overview** of the whole trip.
- **The day tabs** top the sheet, so they stay in view when the sheet is pulled down: **Overview**, then every day of the trip, as short as they can be (`Fri 20`, `Today`, `Dec 1` on the first of a month; a screen reader hears the whole day). Like the trip's name, they're context, not the plan: 15px, grey, with no fills or outlines. The open one is black, with a short black bar under it on the hairline.
- **Tap a tab, or swipe the list sideways,** to change page. The list follows the finger with the next page coming in beside it, and the bar under the tabs slides along with it; let go more than a quarter of the way across, or flick, and it carries on to that page, otherwise it slides back. Past the first or last page it gives a little and comes back. A swipe has to be clearly sideways, so a drag up that wobbles still moves the sheet. On a computer, ← → step through the pages too.
- **The tabs scroll sideways,** fading out at either edge, so a trip of any length fits, and **the open day stays in the middle**: whenever the page changes, its tab slides there.
- **Jump to any day:** the calendar at the end of the tabs opens the trip's weeks between the tabs and the list, as a month does in the stop sheet: the open day in black, today with a ring, and a dot under each day with stops of its own, so the days still to plan stand out. Days off the trip are light grey, weeks with none of the trip's days are left out, and **Overview** is at its top. Picking a day (or Overview) opens it and closes the calendar; so do the calendar button and Esc. It's for long trips, where the day you want can be a dozen tabs away.
- (This replaced a day bar: `‹ Today, Nov 21 ⌃⌄ ›`, with arrows that stepped a day at a time and a list of days in a modal sheet. One day showed, the others were two taps away, and there was no swipe. Before the bar, swiping between days was tried and dropped because nothing on screen said it was there; the tabs say it now.)
- **Which day opens:** today, when it's one of the trip's days; otherwise the Overview, so a trip you're planning or looking back on opens on the whole of it. Saving a stop switches to that stop's day (on the Overview, it stays there). If a day loses its last stop, the list moves to the next day.
- **The Overview** lists every day under its name, with each day's stops and their times, and the drives between them, as on a day (`1 hr 36 min drive`). The date is a small grey label in capitals (`FRI, NOV 20`) at the list's left edge, so it reads as a heading and never as one of the stops, which are larger, black and indented past the rail. Notes are left out, so the trip reads at a glance, and so are the hotel you wake up at and go back to, with the drives to and from it: they're on each day's page, and the map still draws every drive. A hotel says how many nights on its check-in day, and check-out morning has its `Check out` row; a day in the middle of a stay with no stops of its own shows the hotel. **Tapping a day's name opens that day**: its heading says **View day** in blue, in words rather than with a ›. Tapping a stop selects it, as on a day, and the bottom button becomes Open in Maps, with Edit stop beside it; tapping a drive shows its route and offers Directions. The map shows the whole trip: every stop and every drive, and Whole day becomes **Whole trip**. Tapping a route shows it and offers Directions, as on a day. Add stop starts two hours after the trip's last stop. (A whole trip on one page was tried early on and dropped as too much to take in, when it was the only page; as an overview next to the days, without the notes, it gives the shape of the trip a day can't. It first left out the drives too; they came back, since how long you drive between stops is part of that shape. It was called All days until the day tabs came.)

```
│ Overview  Fri 20  Today  Sun 22 📅│  ← the first tab
│ ‾‾‾‾‾‾‾‾                     │
│ FRI, NOV 20         View day │  ← tap to open the day
│ (✈) El Paso Airport   10:30 AM│
│ (🛏) Holiday Inn       3:00 PM│
│      2 nights                │
│ SAT, NOV 21         View day │
│ (🏛) Museum of Space   9:30 AM│
│ …                            │
```
- **Each day starts and ends at the hotel** (see [Hotel stays](#hotel-stays)). With no hotel the night before, the day starts from the day before's last stop: the list opens with that stop, and it's a faded pin on the map. Tapping that pin goes back to the day before.

**Trip settings** holds the trip's name, the people on it (the owner marked `Owner`), the share link (with **Copy**, and **Share**, which opens the phone's own share sheet to send it to a chat or post; it's left out where the browser has none), **Offline** (see below), and **Delete trip** for the owner or **Leave trip** for everyone else, one section each, then the map's credits. Trip settings and Account are built the same way (see [Settings section](../design-system/README.md#settings-section-wt-section)): each section has a title, a line on what it does, its controls, and a hint or a button, with a hairline between sections. There's no Save and no black button, since every change saves on its own. Every button is the same white, outlined button (Copy, Share, Save for offline, Make a new link, Remove from this device), and Delete trip (or Leave trip) is that button with a red label, last, on its own. (They started as a run of fields with small grey labels over bigger paragraphs, and a black Copy button, so the explanations outranked what they explained. Then Make a new link and Remove from this device were grey text and Delete trip red text, which made three kinds of button in one sheet.)

#### Offline

A trip can be saved on the device so it's there with no signal: on the road, in a park, on a plane. In trip settings, **Offline** has one button, **Save for offline**, which saves:
- the plan, as the server last sent it;
- every drive's route;
- the map around each day, a zoom level in and out, and a street-level patch around each stop;
- the app itself.

A phone saves about 0.5–2 MB a day (more in a city), a few tiles at a time, and the field shows how far it has got ("Saving the map: 40%"). Once saved, the field says how much space it takes and when it was last updated, and offers **Remove from this device**. A saved trip keeps itself up to date: while it's open with a connection, every change is saved again, and each visit fetches any map it now needs. Only what's missing is downloaded, so this costs little, and the map around places taken out of the trip is removed.

The header shows the trip's status:

| Icon | When | A tap says (heading, then detail) |
| --- | --- | --- |
| Tick on a line (`saved`) | Saved on this device | **Available offline** · The plan and map are saved on this device, so they open without a signal. |
| Arrow down (`download`) | Saving | **Saving for offline** · 40% done. Keep the app open until it finishes. |
| Crossed-out cloud (`cloud-off`) | No connection, or the server didn't answer and this is the saved copy | **You're offline** · Showing the plan saved 2 hr ago. To add or change stops, reconnect. |

These notices are two-line toasts (`.wt-toast--rich`): the status's icon, a short heading saying what's happening, and a quieter line saying what still works and what to do. One line of text squeezed into the usual pill wrapped to three lines and covered the header.

When the trip isn't saved and there's a connection, the header has no status icon.

With no connection, Home lists the saved trips and a saved trip opens from its copy. A weak signal counts too: if the server hasn't answered after 4 seconds, the saved copy shows, and the server's copy replaces it when it comes. Offline, the plan is read-only: **Add stop**, the round **+** and **Edit stop** turn grey, and tapping one shows the **You're offline** notice above instead of opening the stop sheet (so deleting a stop, which is in that sheet, waits too). They come back as soon as the connection does. Other edits, such as renaming the trip, still try and get the usual "Couldn't save" toast. When the connection comes back, the trip reloads from the server. Signing out removes everything saved on the device.

On iPhone, Safari clears a site's saved data after about a week without a visit, but not for an app added to the Home Screen. The field says so in a Safari tab. An app added to the Home Screen has its own storage, so you sign in there and save the trip again.

**Account** (your picture on the trip list) holds your name (with a hint: people on your trips see it), **Maps app** (Google Maps or Apple Maps, for every place and directions, on this device), **AI assistant**, and **Sign out**, one section each, as in trip settings. For a guest, **Keep your trips** comes right after the name, with the sign-in steps in it, and AI assistant isn't there. Sign out is grey text, not red: it destroys nothing, and a guest, who would lose their trips, is asked first. AI assistant connects Claude or another MCP client, so it can list your trips' stops and add, change or remove them for you, like someone else on the trip. It shows Dotsie's server address with Copy, and says where it goes in Claude (a custom connector), then lists the assistants you've connected, each with when and **Disconnect**. There's nothing to paste back: adding the connector in Claude opens Dotsie to sign in (titled **Connect your assistant**, without the guest option) and then an Allow page, styled like sign-in, that names the assistant, what it will be able to do, where access goes, and who you're signed in as, with **Allow** and **Cancel**. Guests don't see the field, and a guest who reaches the Allow page is asked to sign in first: their trips are only reachable from their own browser. Maps app is a picker, like a stop's Type: a row with the current app that opens the two on a page of the sheet. Every choice from a list works this way, however few the options, so they all look and behave the same. On a computer (768px and up) the options drop down under the row as a menu instead: one click to open, one to pick, Esc or a click outside to close. A page with a Back button suits a thumb and a phone's small screen, but it's slow with a mouse, and a computer has room to show the menu beside everything else.

## The list

### A timeline

The list is a timeline with three columns: a **rail**, the **stop**, and its **time** on the right. There are no cards: rows sit straight on the white sheet and touch, so the rail is one unbroken line down the day. Spacing is even; times are written out, not drawn to scale.

```
 (✈)  El Paso International Airport      10:30 AM
      UA 1234 lands · rental car at Hertz
  ⊖   1 hr 49 min drive                         ◇
 (🛏)  Holiday Inn Express Alamogordo      1:00 PM
      2 nights
```

- **Rail:** a thin, light grey line down the day, unbroken from the first stop to the last. It's quiet so the markers and names stand out. Each stop sits on it as a **type marker**: the stop's [type](#stop-types) icon on its type's color. Its color is the stop's pin's color on the map, so you can match the list to the map at a glance. Drives sit on it as a smaller grey marker with a car, so stops and drives read as one family of icons.
- **Stop:** the name in medium weight, the largest text in the list, on one line: a long name ends in `…`. The note is under it in grey. On a phone the notes are one line, run together with ` · ` (`2 nights · Drop bags · conf # in email`) and cut off with `…`, so a half list fits a stop with its neighbors; **the selected stop shows them in full**, since notes hold things like confirmation numbers. On a computer, with room to spare, notes are always in full. A link in a note can be tapped too: it shows just its site, `booking.com`, in blue, and opens the page without selecting the stop. But pages that belong to a stop go in its [links](#links). A note runs across the time column too, so a long one (shown in full) wraps to the row's full width: its lines start under the name and end in line with the times. Tapping a stop selects it and shows it on the map (see [Adding and editing a stop](#adding-and-editing-a-stop)); it doesn't open it.
- **Time:** on the right, in grey, with a small AM/PM. The name leads the row, and the time is where a glance down the right edge finds it. Hotel rows at either end of the day have no time, so the right edge stays empty instead of leaving a gap before the name.

A selected row (a stop or a drive, tapped or picked on the map) gets a grey background, with no border. It's a clear step darker than the sheet (`gray-200` on white; a lighter grey on the dark sheet): the first, paler grey was hard to see, above all in dark mode. A selected drive's car turns a darker grey. **Only one row is ever highlighted:** while something is selected, the row happening now loses its grey background but keeps its black ring or car (see [Today](#today)). A hotel that starts and ends the day highlights only the row you tapped; picked on the map, it's the first one.

### Drives

A drive is a row between two places: a small grey car marker on the rail and **`1 hr 49 min drive`**. The right edge, where stops have their time, is empty.

- **Tapping the row** shows that route on the map (see [How the map and the list work together](#how-the-map-and-the-list-work-together)) and turns the bottom button into **Directions** (a turn arrow in a rounded road sign), which opens the drive in the phone's maps app (see [Handing off navigation](#handing-off-navigation)). A small round **+** beside it still adds a stop. Tapping the row again keeps the route on show; tapping empty map, changing the day or pressing Esc goes back to the whole day. On a computer, hovering it previews the route without moving the map.
- **No Directions icon in the row.** Every drive used to carry a small grey Directions icon on the right. Seven of them down a day's right edge competed with the stop times, and the icon was a small target right next to the row's own tap. Now navigation is one tap further away (tap the drive, then Directions), with the route on the map first to confirm it's the right one, and Directions is a full-width button. (Before that, every drive had a pale grey circle; then a `Directions` label on the drive that matters, dropped because it made the row jump.)
- **The highlighted drive** (the one you tapped, or the one you're on) gets the grey row background and a dark duration. The one you tapped gets a darker grey car; the one you're on, a black car.
- **When a drive doesn't fit** between getting to one stop and getting to the next, its time and its car turn red and a second line says by how much: `Arrives 49 min late`. The red car shows the problem on the rail as you run your eye down the day. Red outranks everything, including now; once the drive is over it turns grey like the rest, since there's nothing left to fix.

### How you get there

Not every leg is a drive: you walk from the hotel to dinner, ride a bike along the river, take the train into town, or fly home. Each leg can say how, and it changes what its row, the map and Directions show.

```
  ⊖   1 hr 49 min drive         car: a route, a time, Directions by car
  🚶  12 min walk                walking: a route on foot, its time, Directions on foot
  🚲  25 min bike ride           a bike: a route by bike, its time, Directions by bike
  🚆  Transit                    no time; Directions by transit
  ✈   Flight                     no time, no Directions
```

- **The ways:** **Drive** (every leg, until someone changes it), **Walk**, **Bike**, **Transit** and **Flight**.
- **Changing it.** Tap the leg; the bottom button becomes `[◇ Directions] (🚗) (+)`. The round white button in the middle shows the leg's way and changes it, where Edit stop's pencil is for a stop: tapping it opens **Getting to Cloudcroft**, the five ways one per row, each with its icon in a flat grey marker like the car on the rail, the current one grey with a check, as in Type. **Each way that has a route says how long it takes**, on the right (`Drive 17 min`, `Walk 4 hr 45 min`, `Bike 1 hr 22 min`), so you can compare before you pick, as a maps app's ways do; they're looked up as the list opens, with `…` until each comes in. Transit and Flight have no time to show, so they keep their line saying so. Picking one saves it at once, for everyone on the trip, and closes the list. There's nothing to fill in, so there's no Save. Offline it's greyed out like Edit stop.
- **It's saved with the stop the leg goes to**, as how you get there: moving a stop to another time keeps it, and a stop added in between starts as a drive.
- **Every leg to or from a hotel is its own.** Getting to the hotel on check-in day, each night's way back, and each morning's way out are separate legs, each with its own way: drive in on the first day, walk back from dinner on the second, take a taxi (a drive) on the third. The way out in the morning is the day's first stop's, like any stop. The way back at night is saved on the hotel by the night (`back`), and its list says **Getting back to** the hotel. Every night starts as a drive. (At first a hotel had one way for check-in and every night back, since the night's leg ends at the hotel too; that made "drive in, walk back" impossible.)
- **Not in the stop sheet.** It's about the leg, not the place, and the sheet has to stay short enough to leave the map in view. The leg is where you see it, so that's where you change it.
- **The row** says it in the same sentence as a drive, with its icon on the rail in place of the car: `12 min walk`, `25 min bike ride`. Everything a drive's row does (highlight, now, past, red when it won't make it) a walk's and a ride's do too.
- **Transit and flights have no time.** Dotsie can't look up timetables, and the stops either side already say when you leave and land: an airport stop at 10:30 AM and the next one at 2:15 PM is the flight. So the row is just `Transit` or `Flight`, it can never be late, and with nothing to time, it counts as starting when you get to the next stop.
- **The map** draws walks and rides along their paths like a drive, in the same blue: blue means a way to get somewhere, whatever it is. Transit and flights have no path, so they're a straight dashed line from one stop to the next. (A route that hasn't loaded yet is dotted, so the two don't look alike.)
- **Directions** open in the maps app in the leg's way: walking, cycling or transit directions. Apple Maps has no link for cycling directions, so a ride opens in its default mode. A flight has no directions to give: its button is **Open in Maps** for where it lands.
- **An AI assistant** can set it too (`travel` on a stop), so "we'll fly from El Paso" changes the leg as the list would.

### Stop times

A stop has one time: **Arrive**, when you get there. It's required, and it orders the day. A hotel, the one stop you stay at overnight, has two: **Check-in** and **Check-out** (see [Hotel stays](#hotel-stays)). Any other stop can also say how long you're there: **Duration**.

- **The drive to a stop sets off just in time to get there.** `Arrives 20 min late` checks the drive against the time between the two stops: from when the first one ends (its time, plus its duration if it has one) to when you get to the next.
- **Duration** is optional, and picked from a list, like Type: None, 15 min up to 8 hr. Its row says when that ends (`Until 11:00 AM`). In the list it's the first thing under the stop's name (`1 hr 30 min · Lunch`), where a hotel says its nights, and it shows on the Overview too, as nights do: how long you're somewhere is part of the plan's shape. A hotel has no Duration: its stay is its nights and check-out. Without one, a stop lasts until you have to leave for the next.
- **No leave time.** Every stop used to have an optional **Leave** too, shown in the list as `to 4:15 PM` under the time, and the drive after it set off then. It was taken out: a plan is where you'll be and when, and when you leave follows from when you need to be at the next stop, so it added a field to fill in without telling you anything new. A leave time saved before then is ignored, and dropped the next time the stop is saved. (Before Leave, every stop showed a hotel's Check-out field, filled with the hotel's day and never saved: `.wt-field`'s `display: block` beat the `hidden` attribute. That fix stays.)

### Time zones

A stop's times are the clock time where it is, the way a ticket, a booking or an opening time says them. A flight that leaves Los Angeles at 10:00 AM and lands in New York at 6:30 PM is two stops at those times, and it takes 5½ hours, not 8½.

- **Each stop's zone is its place's own,** found from where it is, in the browser (a [lookup](../app/web/tz-lookup.js) of the world's zones by their borders, so it works offline too). Nothing is saved for it, so every stop, an assistant's and those saved before zones, is on local time.
- **What happens when goes by the moment each time is:** the order of the stops, a drive that won't make it (`Arrives 47 min late` across a border), and what's now and what's past on today.
- **The list says the zone only where the clocks change:** after the time of a stop whose zone isn't the one before it (`6:30 PM EST`), and on the trip's first stop when it isn't this device's. Elsewhere a time is in the same zone as the one above it, and a trip in one zone, planned there, never shows one.
- **In the stop sheet,** a quiet line under Arrive says which clock it's on: `Local time · Mountain Standard Time`. Tapping it opens every zone, Local time first, each with its city, its name and its offset at the stop's time (`Los Angeles · Pacific Standard Time · GMT-8`), and a search by city or name. Picking another zone keeps the clock time and moves the moment: for a time someone gave you in another zone, such as a call. Picking the place's own is Local time again. A stop moved to another place keeps a zone picked by hand.

### Hotel stays

A hotel isn't just a stop: you sleep there, and the next morning starts there. Before this, Saturday's first drive started at Friday's last stop (the boardwalk), and so did its Directions link.

- **A hotel has nights.** On its check-in day it shows as a normal stop at its check-in time, with `2 nights` under the name.
- **Every day of the stay starts and ends there.** The day opens with the hotel and, after the day's last stop, a drive back to it. These rows look like any stop, with the same solid marker, and no time. Only the last morning has a note, `Check out`, with the check-out time where the time goes, since that's the one with something to do. Tapping one selects the hotel.
- **Nights, by default, follow the trip:** until the next hotel, or the trip's last day. In the stop sheet, a hotel's **Arrive** becomes **Check-in**, and **Check-out** follows it, a day and time like it. The nights are the days between them, so you pick the day you leave rather than counting nights; the count shows on the right of Check-out's label (`2 nights`, or `Same day`). There used to be a Nights stepper beside a check-out time; picking the date says the same thing in one field. Left alone, check-out follows the trip, and changing only its time keeps it that way. Moving check-in keeps the check-out day while that still leaves 0–30 nights.
- **Same-day stays:** check-out can be the check-in day, for a late arrival after midnight that leaves in the morning (in at 12:30 AM, out at 7:00 AM), or a room for the afternoon. That's 0 nights: the hotel shows at its check-in time with no nights under it, and its `Check out` row follows that day, among the day's stops at its time. It used to have to be at least a night later, which made a stay that starts after midnight end a day late.
- **Usual times:** a new hotel's check-in starts at **3:00 PM**, and check-out is **11:00 AM** until someone sets another time. Hotels saved before check-out times existed show 11:00 AM too.
- The drive back to the hotel has no times: the day's last stop has no end.

### Where the day starts without a hotel

With no hotel the night before, the day opens with the day before's last stop, so you can see where you're driving from before the first drive. It looks like any stop, with `Yesterday` where the time goes, or the weekday (`Sat`) when there's a day with no stops in between. Its time isn't shown: a `3:00 PM` above a `10:00 AM` reads as a mistake, and what matters this morning is where you are, not when you got there. Tapping it selects that stop, and its faded pin is highlighted. It's left out when the day's first stop is the same place. This replaces a second line on the first drive (`from Interdune Boardwalk`), which was easy to miss and couldn't be tapped.

### Today

On trip days, today's page shows where you are without a clock in the list:

- **Now is highlighted.** The row you're in (the latest thing that has started: the stop you're at, or the drive you're on) gets the same light grey background as a selected row, whether it's a stop or a drive. A stop's marker also gets a black ring, and a drive's car turns black: the blackest ink in the list. When you select another row, the grey background moves there, but the ring or black car and the dark time stay, so where the day is never gets lost. (Tinting the whole row with its map color was tried first; a different color for every type made the highlight look inconsistent. A dark outline on selected rows was dropped too: it pulled the eye away from the plan. So were blue cars and icons on drive rows, and highlighting the selected row and the row happening now at once: two grey rows, sometimes touching, read as one block. A pale blue background, blue time and blue ring for now were tried with the 6.1 palette and dropped: a colored highlight looked cheap and noisy, louder than what it marked. The ring around the marker was in the stop's type color until then; black says "now" the same way for every type.)
- **Past turns grey, in the list and on the map.** Everything before it, and every earlier day, loses its color: text turns the lightest ink, and markers and cars turn light grey. The rail stays solid. On the map, past drives turn grey and sit under the rest, and a stop you're done with gets a small grey pin. What's still in color is what's still ahead. A hotel stays strong until the night is over.
- **Today opens at now.** When today's page shows, it scrolls so the highlighted row sits a little above the middle.
- **On the Overview** the same holds among its rows: the latest stop that has started is highlighted, and everything before it dims, along with every earlier day.

### Stop types

Every stop has a type, shown as its icon in the list, and as its pin's color on the map:

| Type | Color |
| --- | --- |
| Hotel | Purple |
| Airport | Indigo |
| Gas | Petrol |
| Restaurant | Orange |
| Café | Coffee brown |
| Attraction | Teal |
| Viewpoint | Lime |
| Nature | Green |
| Museum | Pink |
| Shopping | Yellow |
| Place: anything else | Grey |

- Every type has its own bright color, so no two look alike: a café no longer looks like a restaurant, nor a museum like a viewpoint. The colors follow maps apps (food orange, hotels purple, parks green, shopping yellow), so they read at a glance. They're about as light as each other, so a type says what a place is and never that it matters more: a magenta sight used to outshine a grey place. The colors leave out blue (routes) and red (a drive that doesn't fit), so airports and gas, blue in maps apps, are indigo and petrol. Each has a light and a dark version.
- **Choosing a type:** the stop sheet has one **Type** row under the place, showing the type's marker and name. Tapping it slides the sheet to a page with every type, one per row; picking one slides back. The types come in sections a traveler thinks in: Place; Hotel, Airport, Gas; Restaurant, Café; Attraction, Viewpoint, Nature, Museum, Shopping. Hotel says *Check-in and check-out*, the one type that changes the form. The rows are the same as place search's suggestions, and the set type is a grey row with a check, as a selected stop is grey in the list. (It used to be a grid of all eleven types, the tallest thing in the stop sheet; on a phone the sheet now has to stay short enough to leave the map in view.) When you pick a place from search, the type starts as a guess from the place's category and its name (an "Inn" is a hotel, a "Visitor Center" an attraction). Choose a type yourself and the guess leaves it alone after that.
- Stops saved before types existed get the guess from their name, or are a restaurant when the note says breakfast, brunch, lunch or dinner ("Cloudcroft", note "Lunch").

### Links

A stop can have links: pages you'll want on the day, such as the flight, the hotel booking, the tickets, or the place's own page.

- **Each link is a button** under the stop's notes: an outlined pill in blue, with the link's label (`UA 1234`, `Booking`) or, without one, its site (`recreation.gov`), and a small arrow that says it leaves the app. Tapping one opens the page in a new tab without selecting the stop. The buttons are 34px tall with a gap between them, so a finger gets the one it means; more than fit on a line wrap onto the next.
- **On a phone, only the selected stop shows its buttons**, as it does with its full notes. Any other stop with links starts its notes' line with a grey link icon, so you can see it has them, and the half list still fits three stops. Tap the stop and its buttons appear. On a computer every stop shows its buttons.
- **They show where the note does:** on the stop's own row, not on a hotel's other mornings and evenings, and not on the Overview.
- **In the stop sheet,** Links comes after Note: a row for each link, with its label over its address and an ✕ to remove it, then **Add link**. Add link puts the cursor in a new row's address, ready to paste. The label is optional: its placeholder shows the site the button will say until you type one. `booking.com/…` gets `https://` added. Anything that isn't a web address stops Save with *This isn't a web address*; a row left empty is dropped. Up to 10 links.
- **An AI assistant** adds links the same way (`add_link`): its instructions say that any page it finds or is given for a stop goes in its links, with a few words for a label, and that a flight's links go on the airport you fly from.
- (Before this, links lived in the note, where each showed as its site. A note full of addresses was crowded, every `united.com` looked the same, and a word in a line of text is a small target.)

### What the list leaves out, and why

| Removed | Why |
| --- | --- |
| Stop numbers in the list | The order is clear from the times. The map has no times, so its pins carry the numbers instead (see [The map](#the-map)). |
| Addresses | The map already shows where each stop is. In a plan, the place name is what matters. |
| "Last edited by" avatars | This is history, not the plan. Live edits show up as a short notice instead. |
| Driving distance | The duration is what you plan around. The distance adds little and is one tap away in the maps app. |
| Check circles | Checking off stops added a control to every row. The highlight and dimming show what's done without anyone having to tap. |
| Now line | A line at the exact time added a clock to the list. Highlighting the row you're in says the same thing more plainly. |
| Day number (`Day 1 of 3`) | The date is enough. |
| Next card (`Leave in 30 min`, Directions) | Tried at the top of the sheet. It repeated the next drive row, which already has Directions, and took room from the list. The highlight shows where you are. |
| Hotel notes (`Start the day here`, `Back for the night`) and outlined hotel markers | Where the hotel sits in the day already says it. Only `Check out` is kept. |
| Pins fading as you scroll the list | With one day on the map there are few pins, and fading them by scroll position made them look done. Faded pins now mean past only. |
| Trip header (edit button, faces) | Not needed to plan the day. It's all in trip settings. The header came back as one row with just the trip's name and buttons, so a phone always says which trip you're in. |
| Trip subtitle (dates · stop count) | The day tabs already show the date. |
| Time-scaled heights and stay lengths | Tried after the grid: cards and drives as tall as the time they take, then a written "41 min" under each time with the rail colored by stay. The uneven gaps looked like layout bugs, and the extra numbers made the list harder to scan. |
| Map credits on the map | They covered the map and the top of the sheet. They're at the bottom of trip settings. |
| Folders | Stops that followed each other could share a folder, a name that grouped them (a park's visitor center, trail and viewpoint): one row and one pin closed, its stops hanging from its name open. It was made so a park's stops wouldn't pile up on the map, and then [merged pins](#the-map) did that for every crowded spot, with nothing to set up. What was left was a second way of saying "several stops here", with its own row, marker, pin, swipes, picker and rules about times, and pin numbers that changed as folders opened and closed. A day's list is short enough without it. |
| Calendar time grid | Considered as a way to show how long each stop lasts. A grid shows about 3–4 hours in a half-height sheet on a phone, and trips are mostly long gaps (a 14-hour hotel stay). The [timeline](#a-timeline) keeps to start times and drives. |

### Adding and editing a stop

- **Add stop.** One black button pinned to the bottom of the sheet, always reachable: it's the main action on the screen. A new stop starts two hours after the last stop of the day on screen. With something selected, it goes where you are: after a selected stop (halfway to the next stop that day, on a 5-minute mark, or two hours later if it's the day's last); with a drive shown, on that drive. Its [place search](#place-search) starts from there.
- **Selecting.** Tapping a stop in the list selects it instead of opening it, like tapping a drive shows its route: the row turns grey and its pin grows on the map. **The map flies to the stop and zooms in to street level** (zoom 15, where its streets and the [sights](#sights-nearby) around it show), with the pin in the middle of the part of the map you can see; a full-screen list goes back to half. It only zooms in: a map already closer keeps its zoom. Coming from a drive on show or from the full-screen list, it doesn't re-fit the day, and **Whole day** brings the day back. Tapping the same row again keeps it selected, so a second tap never undoes the first, and in the half list nothing moves: the row is already in the middle, and the map comes back to the stop only if you've moved it out of view or zoomed out. Tapping a pin selects it without moving the map: it's already in front of you. (Selecting used to keep the zoom and only pan the pin into view. Zoomed out to a road trip's day, the selected stop was a dot on a map of the region, with no streets around it and no sights. Before that, it re-fit the whole day, so coming from a drive the map jumped back out.) Tapping empty map, changing the day or pressing Esc clears it. (Tapping a stop used to open it straight away, so seeing where a stop is meant opening a form.)
- **Open in Maps.** While a stop is selected, the black button says **Open in Maps** and opens the place in your maps app: its photos, reviews and hours. A name alone doesn't say whether it's the right place or worth going, and on the road it's what you most often want from a stop, so it's the main button rather than something inside the sheet. A stop you've just added is selected, so it's there to check the moment you save. Dotsie shows photos and descriptions only for well-known sights, from Wikipedia (see [Sights nearby](#sights-nearby)): hotels and restaurants, most of a trip, aren't covered by free sources, and the plan stays the focus. (It used to be a white **Maps** button between a black Edit stop and the +.)
- **Edit stop.** To its right, a round white button with only a pencil edits the stop, and a small round **+** after it still adds one, so adding is always one tap away. There's still only one black button.
- **The buttons morph.** Selecting a stop doesn't swap the row: Add stop shrinks to the right into the +, its black fading to white, while Open in Maps grows from the left and Edit stop grows in between. Clearing the selection runs it back, and showing a drive stretches Open in Maps into Directions, with the way you're getting there where Edit stop was. Each takes a quarter of a second, so you see where Add stop went; with reduced motion the new buttons just appear.
  - **The same app as Directions,** so a place and the way there never open in two different apps. It's **Google Maps** unless you pick **Apple Maps** under **Maps app** in Account (tap your picture on the trip list). A web page can't ask which maps app is the default, so it's a setting; Android's `geo:` links open the default, but only for a place, not directions, so they'd split the two. The setting is kept on the device, not the account, since which apps you have is up to the phone. (Choosing by device, Apple Maps on iPhone, was tried first; Google has the most photos and reviews, and some iPhone users live in Google Maps.)
  - It finds the place by name and address, which opens the place itself; coordinates alone would open only a dropped pin.
- **Editing.** Tap Edit stop. The stop sheet opens without dimming or blocking the map: on a phone it takes the list's place at the bottom, at most about 60% of the screen, and the map shows above it; on a computer it covers the side panel. The map moves the stop into the middle of what's still visible.
- **The map follows the edit.** The stop's pin shows the draft: picking a place from search moves the pin there, and the map goes with it; choosing a type changes the pin's color. A new stop's pin appears once a place is picked. If the stop moves, its two drives fade until it's saved. You can pan and zoom the map while the sheet is open, and taps on the map don't change anything. Closing without saving puts the map back where it was.
- **About.** A stop at a [sight](#sights-nearby)'s place that Wikipedia has an article on shows, above its fields, the sight's photo, small and square, beside the article's first lines (three at most) and the same credit and **Wikipedia** link as the sight's card. It's read-only, and it goes when another place is picked: it's about the place, not the stop. A stop added from a sight's card keeps its Wikidata item. One found by search, or added by an assistant, has none, so its sheet looks for the sight at its place: the same name within about 2 km, or a name that contains the other's within about 100 m. Found, the lines appear, and Save keeps the item with the stop. Opening the sheet alone changes nothing. A new stop picked from search gets its item the same way, so it shows the next time it's opened. (A museum added by search used to show nothing, though Wikipedia has an article on it.) The list's rows never show it: they stay one line each, and a picture per row would make the day a long scroll.
- **The stop sheet** has six fields, in this order (a hotel has Check-out in place of Duration):
  1. **Place.** The first line, like in the list: the place's name and address. Tapping it opens a search page, as in a maps app. A stop's name is its place's name. See [Place search](#place-search).
  2. **Type.** One row that opens the [stop types](#stop-types): a page of the sheet on a phone, a menu under the row on a computer.
  3. **Arrive.** A day and a time, side by side (`Fri, Nov 20` · `1:00 PM`), and under them the clock they're on (see [Time zones](#time-zones)). For a hotel it's **Check-in**, followed by **Check-out**, a day and time. See [Stop times](#stop-times) and [Picking a day and a time](#picking-a-day-and-a-time).
  4. **Duration,** except for a hotel. See [Stop times](#stop-times).
  5. **Note.** It grows with what's in it, rather than scrolling in a two-line box inside the scrolling sheet.
  6. **Links.** See [Links](#links).
- **Picking a day and a time.** <a id="picking-a-day-and-a-time"></a> It works as in Google Calendar: a day, then a time.
  - **The row** is two fields side by side: the day (`Fri, Nov 20`, with the year when it isn't this one) and the time (`1:00 PM`). It used to be the browser's date-and-time field, which read `11/20/2026, 01:00 PM` and opened a different control on every phone: no weekday, a leading zero, and on iPhone a calendar and a time squeezed into one pop-up.
  - **Tapping the day opens its month,** as a page of the sheet with Back, and **picking a day goes straight on to the time**, since a stop moved to another day usually wants another time too. Back on the time goes back to the month. Tapping the time goes to the time alone.
  - **The month** starts on Sunday. The day set is black, today has a black ring, as now does in the list, and a day that has other stops on the trip has a dot under it, so the trip's days are easy to find from any month. ‹ › change the month.
  - **The time** is three wheels, hour, minute and AM/PM, that scroll and snap into a grey band, as a phone's clock does. Minutes go in fives, plus the stop's own minute when it's between, so a 10:42 flight keeps its 42. Tapping a value brings it to the band.
  - **Nothing changes until Done,** which sets the day and the time together and comes back to the form. Back from the month, or Esc, leaves it as it was.
  - **A hotel's check-out** works the same way, and only offers the days it can be: from check-in, up to 30 nights on. A time before check-in on the same day comes up to check-in.
  - **On a computer** the month and the wheels drop down under the row as a menu, like Type's, and the row shows the day and time as they change. ← → ↑ ↓ move a day or a week in the month, Page Up and Page Down a month, and ↑ ↓ step a wheel.
- **Place search.** <a id="place-search"></a> It works as in Google or Apple Maps, and like the Location field in their calendars. Nothing here is our own invention.
  - **The Place row** shows the place's name, and its address under it, so two places with the same name can be told apart. Tapping it opens the search page.
  - **The search page** takes the sheet's place, and on a phone the whole screen, as a maps app's sheet rises when you search. The field is at the top with **Cancel** beside it, and the results fill the page under it.
  - **The field starts with the place's name**, the cursor at its end, so you edit it rather than retype it (*Joshua Tree* → *Joshua Tree Inn*). Results appear from the third letter, with the words you typed in bold, the address under each name, and the marker of the type the place would get.
  - **Only a picked result is kept.** Tapping one fills in the place, and its name with it, and goes back to the form: the pin moves, the map follows, and the stop's two drives fade until it's saved. **Cancel** (or Esc) goes back with nothing changed. Nothing typed is ever saved as a place or a name.
  - **Adding a stop starts on the search page**, since a stop is its place. Cancel there closes the sheet: there's nothing to add yet. On a phone the sheet fades in already full height rather than sliding up: on an iPhone, the field was focused while it was still below the screen, Safari panned the page down to it, and the field was left out of view over a blank screen.
  - **Search leans toward where the stop goes:** for a new stop, the place you'd come from at its time (the day's last stop, or last night's hotel); for a stop being edited, the stop itself. It used to lean toward the middle of all the trip's stops, which on a long road trip is somewhere none of them are.
  - **Before anything's typed, it suggests what's on the way:** the best known [sights](#sights-nearby) within about 5 km of the drive the stop would go on (from the place before it to the one after, along the route; with a hotel that night, the day ends there, so an evening stop is *Near* the hotel rather than on the way to tomorrow's first stop), not on the trip yet: the 16 best known, then the eight nearest to where you'd be, nearest first, so what's around you comes before what's at the other end of the drive. They're under *On the way to Joshua Tree Inn*. With only one of them (the trip's last stop), or a flight between them, it's *Near* that place. Each shows its address, or its type when it has none, and tapping one fills it in as a search result does. Nothing is picked by Return until you move to one. A long drive looks at no more than 16 of the sights' map tiles, spread along it, so it can't use up the per-person limit. Under them, **Places to eat nearby ↗** opens restaurants around there in your maps app, whose reviews and hours say where's good: OpenStreetMap has restaurants but no reviews, so a list of them here would be a list of names. Shops, hotels and gas aren't sights either; for those, type. (A row of Gas, Food, Coffee and Hotel under the field is left for later: search looks places up by what's typed, and how well a word like *gas* finds the gas stations on the way hasn't been checked.)
  - **Results on the way come first,** with *On the way* (or *Nearby*) at the start of their detail line, in black, then the others in the order search gave them.
  - **Keyboard:** ↑ ↓ move the grey row, Return picks it, Esc is Cancel.
  - **A moved stop keeps its type**, which may have been chosen on purpose. Each result's marker shows what the new place would be, so a difference is visible, and Type is one tap away. A new stop's type is still guessed from the place it's given.
  - **While it searches**, a spinner shows in the field and the last results stay put, so the list doesn't flash; going back to an earlier search shows its results at once. With nothing found, it says so and what to try (*Try adding the town, or check the spelling*).
  - (Tried and dropped, before settling on what maps apps do: results in a list under the field that pushed the form down, then in a pop-up over the form; the trip's own places offered first; and a free-text stop name beside the place's, with **Change** and **Undo**.)
- **Save is always in reach.** The sheet's title and close button stay at the top and Delete and Save at the bottom, with the fields scrolling between them. The title sticks to the very top of the sheet, so no field shows above it as they scroll (they used to, in the sheet's top padding). On a phone the sheet is only about 60% of the screen, and a hotel's fields don't fit, so Save used to sit below the fold.
- **Delete.** In the edit sheet, on the left of Save. Deleting shows a notice with **Undo**.

## The map

**The map shows only the routes and the pins,** and, zoomed in, [sights nearby](#sights-nearby). Names, times, drive times and notes are in the list, so the map doesn't repeat them: no labels on the pins, no time tags.

- **Markers and pins are glossy,** like a maps app's: each is shaded from its own color, a little lighter and richer at the top and darker at the bottom in the same hue (a white and black overlay was tried first and made the colors look dirty), so it reads as an object on the map or the rail rather than a flat dot. A drive's car stays flat, so drives stay quieter than stops. The gradient is the same for every type and gentle enough that the icon or number stays readable.
- **Pins** are round dots centered on their place, like stops on a transit map. The pin is the stop's [type](#stop-types) color, in a white ring that keeps it apart from the route running into it, and it holds one thing, its **number**: **every pin has one, its row's in the list,** 1, 2, 3 as the list reads, so the hotel you wake up in is 1 and the hotel you go back to is the last. On the Overview, the trip's stops. **Numbers follow the list, not the zoom:** they change when the list does, never as you zoom or pan, so a number always means the same row. (The hotels at either end of a day used to have a white dot instead: a map of dots and numbers spoke two languages.) A selected stop's pin, and both ends of a route on show, grow to a larger dot with a deeper shadow, and the other pins step back to a lighter version of their color, still solid, with the number in their own color (not grey, since grey means over; and not see-through: at 55% opacity the route and the map showed through them, and they looked muddy). Growing a quarter alone was tried first: among pins of every color, the selected one was hard to find. A stop that's over shrinks and turns grey, and so do the pins a route on show doesn't start or end at. Rows at the same place share one pin, with the first one's number: the hotel you wake up in and go back to is 1, and the route comes back to it. (Pins used to be round, with the type's icon, no numbers, and a name label when selected: the icon and the label repeated the list, and the map couldn't show the order. Teardrops with numbers came next. Each stood well above its place, so zoomed out, a day's pins piled into one blob that hid the places and the routes between them.)
- **Where pins crowd, they merge.** Pins that would touch become one, at the first one's place: the first one's pin in front, round and with its own number as ever, and the next ones' pins stacked behind it in their own colors, faded so the one in front leads, like a fanned deck, so you can see there are several and what kinds. Zoomed out to the morning of Nov 8, the hotel, the trailhead and breakfast are one pin: the hotel's 1 in pink, with green and orange behind it. The numbers it holds are the ones missing from the map (2 and 3 there); a screen reader hears them all. Zoom in and it comes apart into its pins; tap it and the map zooms in to its stops, as a maps app does with a cluster. A selected pin, and both ends of a route on show, never merge: they stay on their own, on top, with their own numbers. (Crowded pins used to shrink to small dots without numbers, first all together whenever any two in view were too close, then each by its own room: the map was left with stray numbers among dots, and a dot didn't say what was there. Then a merged pin was a grey pill with all its numbers, "3–4": the one pin on the map that wasn't round, grey like a pin that's over, and it read like a score. Then it was the first pin alone, with a rim or a "+1" on its corner, and neither said clearly what was under it.)
- **Routes** are drawn in blue along the roads (or paths, for a walk or a ride), and a transit or flight leg as a straight dashed blue line; on a trip day, past ones are grey. **Blue means routes and nothing else**: a selected stop is grey, no stop type is blue, and the list uses no blue at all: the drive you're on or have selected gets a darker grey car.
- **The background map** is a light, low-contrast style (Stadia "Alidade Smooth"), so the routes stand out. Its place names, road names and highway numbers sit over the routes, as in a maps app, so a route never hides the name of the road it follows; the pins sit over the names. (The map is drawn in the browser for this, offline too. A browser that can't draw it shows Stadia's pictures instead, whose names are under the routes.) Its credits are at the bottom of trip settings, not over the map.

### Sights nearby

Zoomed in to a town or closer (zoom 13), the map shows what's worth seeing around you, as Google and Apple Maps show their places: attractions, museums, viewpoints, historic sites and nature, and in a park its visitor center and trailheads, where a visit starts. Only what a traveler goes to see: no shops, restaurants or hotels, which search finds.
- **Each is a white marker (near black in dark mode) ringed in its [type](#stop-types)'s color, with its icon in that color and no name.** Sights are part of the map, not the plan, so they're drawn like a maps app's own places: a disc a little smaller than a pin, with a light shadow so it reads over any map. (They were pale tinted discs with a small icon, and too faint to see.) The trip's pins are solid colors with white numbers, standing off the map, so the plan reads first and the sights sit back. Pointed at with a mouse or focused, a sight becomes a solid marker like a pin's. They sit over the map's own names, so no road or town name hides them, and under the pins. A name beside each used to cover the map's names, or sit under them; the icon says what kind of place it is, and a tap says the rest. Its name shows only while you point at it with a mouse. (They used to be solid markers with a shadow, as strong as the pins: zoomed in to a town, they drowned out the stops.)
- **The best known come first,** and only as many as fit: never two markers overlapping, never over a pin, **never on a route**, so the day's line runs unbroken from stop to stop, and at most 12 in view. Zoom in and more appear. A place already on the trip isn't shown again. (There were up to 20, and they sat on the routes.)
- **While a stop is selected,** the other pins turn a lighter color and the sights step back a little (to 70%), so the selected stop and its day stay the focus while you can still see what's around it.
- **Tapping one opens its card,** as in a maps app: what it is before you add it. The card is a panel, like the stop sheet: on a phone it takes the list's place at the bottom and the map shows above it, and on a computer it covers the side panel. The sight's marker grows, with no name beside it (the card's title says it, in full: beside the marker it was cut short and said it twice), and if the card covers it, the map moves it into view. The card has:
  - **Its name and type,** beside the sight's own marker.
  - **A photo and a few lines,** when it has an English Wikipedia article: the article's lead picture (only a free one), then its first sentences, at most four lines. Under them, in small grey type, who took the photo and its license (linking to its page on Wikimedia Commons, as its license asks), and **Wikipedia ↗** on the right, for the rest. Most well-known sights have both; a trailhead or a visitor center usually has neither, and its card is just its name and Add to trip, with no "no description" message. While the lines load, grey blocks hold their place; if they can't be had (offline, or Wikipedia doesn't answer), they go.
  - **Add to trip,** the one black button, opening Add stop with the sight filled in: its place, its address when known, and its type. Set the time and add it, or close the sheet and nothing changes.
  - Tapping empty map, the ✕ or Esc closes the card. Like any tap on the map, a tap on a sight waits out a double-tap. (Tapping a sight used to open Add stop straight away, so finding out what a place was meant starting to add it.)
- **The lines are English for now,** whatever the phone's language, like the rest of the app.
- **Not while a stop is open,** so the stop being edited stands alone, and not offline.
- **Where they come from:** OpenStreetMap, and for the cards its links to Wikidata, which lead to the Wikipedia article and its picture on Wikimedia Commons. OpenStreetMap has no reviews or visitor counts, so "best known" means a place with a Wikipedia article or a Wikidata item, then its kind (a museum or a castle before a memorial), then a mapped area before a single point. A place mapped more than once (a park's area and a point for it, three viewpoints with one name along a boardwalk) shows once.

### How the map and the list work together

- **Tapping a pin** selects that stop and scrolls it into view in the list. The map stays where it is.
- **Tapping a stop in the list** selects it and highlights its pin, and the map flies in to it, at street level (see [Adding and editing a stop](#adding-and-editing-a-stop)). The bottom button becomes Open in Maps, with Edit stop beside it.
- **Showing a route.** Tapping a route on the map, or its drive in the list, shows it:
  - The route is highlighted, and the other routes and stops fade.
  - **Both ends' pins grow,** as a selected stop's does. The drive's time is in its row in the list, not on the map.
  - **The map fits the route**, with room around its ends for their pins, and the list scrolls to the drive. From the list, the map always moves; from a tap on the route itself, only when one of its ends is out of view, so the map doesn't jump under your finger. A full list goes to half, so the map and the Directions button both show.
  - **The bottom button becomes Directions**, for that drive, with the way you're getting there and a round + beside it (a flight's is Open in Maps, for where it lands).
- **Tapping the same drive again** keeps it on show, and in the half list nothing moves: the map re-fits the route only if you've moved one of its ends out of view. Whole day, changing the day or Esc goes back to the whole day. Tapping empty map takes the route off but leaves the map where it is. (It used to fly back out to the whole day.)
- **Hovering a drive** on a computer previews its route, without moving the map.
- **Tapping empty map** clears the selection, without moving the map.
- **A tap waits out a double-tap.** A tap on a pin, a route or empty map acts after a moment (300 ms), once it's clear no second tap is coming, as in a maps app. Selecting a pin or showing a route can move the map, and a double-tap's second tap would then zoom somewhere you didn't tap.

### Zooming and Whole day

The map zooms the way a phone's maps app does:
- **Double-tap** zooms in a step around the spot you tapped, anywhere on the map: on a route or a pin too, which is usually where you want a closer look. It only zooms: it doesn't select the pin or show the route. On a computer, double-click does the same, and Shift-double-click zooms out.
- **Two-finger tap** zooms out a step.
- **Pinch** and the scroll wheel zoom as usual.

**Whole day** is a button over the map's bottom right, just above the sheet on a phone. It shows the whole day's route again: all its stops, fitted to the space the sheet leaves, as when the day opened. It also ends a route preview, so every drive is back in blue. It's always on the map, so it doesn't come and go under your thumb, and it works whenever the map shows something else: after you pan or zoom, while one drive is on show, or after the sheet changed height under a map you'd moved. While the map already shows the whole day it's greyed out and can't be tapped, since it would do nothing. It isn't there over the whole-day list, which hides the map, or while a stop is open. It's a round icon button, the four corners of a frame, like Google Maps' and Apple Maps' route overview buttons, so it takes as little of the map as it can. Its name, "Whole day", is its label for screen readers and its tooltip on a computer. (A pill labelled "Whole day" was tried first; it covered more of the map than a control should.)

### Handing off navigation

Tapping a drive turns the bottom button into Directions, which opens directions from one stop to the next, the way you're getting there (driving, walking, cycling or transit), in your maps app: **Google Maps**, or **Apple Maps** if you picked it in Account. Dotsie has no turn-by-turn directions, step lists, or navigation mode. Those are what the maps apps do best.

## Collaboration

- **Sharing is a link.** Opening the link adds you to the trip, so the link is the invite. Everyone can edit.
- **Owner.** Whoever made the trip owns it. Only they can delete it, for everyone, and the notice offers **Undo**. Everyone else can **leave** it instead: it comes off their home screen, the stops they added stay, the others see `Sam left`, and the share link brings them back.
- **Who's on the trip** is listed in trip settings. It used to show as faces in the sheet header; that row went to give the plan more room.
- **Live edits** appear right away. When a co-editor adds, changes, or removes a stop, a short notice appears at the top (for example, "Sam updated Cloudcroft") and the changed stop flashes.
- Edits always build on the latest saved version, so two people editing don't overwrite each other's changes.

## Messages

What the app says when something happens follows one pattern (see **Messages** in the [design system's patterns](../design-system/README.md#patterns)):

- **Toasts** show news at the top of the screen. On a phone's trip screen they show just below the header, so Home and settings stay in reach. A toast stays as long as it takes to read (3 to 8 seconds, at least 5 with Undo). It stays while you point at it or tab into it, and a tap or a swipe up puts it away. News waits until an Undo toast has gone, so a co-editor's change doesn't take Undo away.
  - **Plain** for something short: "Link copied", "Sam updated Cloudcroft", "Deleted Cloudcroft · Undo".
  - **Rich**, with an icon, a heading and a detail line, for anything that needs explaining: being offline, a trip saved for offline, signing in as a guest and what happened to your trips.
  - **Errors** are rich with a red icon, and screen readers announce them straight away. The heading says what failed, and the detail says what to do: **Couldn't save your change** · Check your connection, then try again. With no connection the icon is the crossed-out cloud. A link that won't copy is selected, so it can be copied by hand.
- **Dialogs** ask before something that can't be undone or that reaches other people: deleting a trip, a guest signing out, making a new share link, disconnecting an AI assistant. The title asks the question, a line says what happens, and the buttons are **Cancel** and one that names the action ("Delete trip"). When it destroys something, that button is red and Cancel has the focus. These replaced the browser's own `confirm()`, which named the website rather than the action and couldn't match the app.
- Deleting a stop doesn't ask, since its toast has Undo.

## Visual language

The full visual language (tokens, components, light and dark themes, accessibility rules) is the [Dotsie design system](../design-system/README.md). Its live demo page is at `/design-system/` on the preview server. In short:

- **Color and ink rank information,** loudest first:
  - Red only for a drive that doesn't fit: the one thing to fix.
  - Black for what you read first: stop names, the row happening now, the main button.
  - Type colors for what kind of place, all at one lightness so none outranks another.
  - Greys for the rest, a step lighter for each step down: times and notes, then drives and detail.
  - Light grey for what's over.
  - Blue only for routes and links, never for a highlight. A highlighted row is grey.
  - The greys are one warm ramp in even steps, each ink with its own contrast (see the design system's [Greys](../design-system/README.md#greys)).
- **Type:** the system font, in few weights: stop names 16px medium, the trip's name and the day 15px medium in grey (they say where you are, so they sit below the plan), and everything else regular, so the screen never reads as a wall of bold. Below the names, hierarchy is size and ink: times 15px in dark grey with tabular numbers, notes 13px in dark grey, drives 13px in a lighter grey with the duration a step darker. Stop names are the only strong text in the list.
- **Surfaces:** the map, then the white plan sheet with the timeline straight on it. Trip cards on Home and modal sheets are white too. No heavy shadows.
- **Closing a sheet:** ✕, a tap outside it, Esc, or the phone's Back button. Each sheet has its own place in the browser's history, so Back closes the sheet and stays on the page under it, as in other phone apps. (Back used to leave the page, losing what was typed, and a sheet opened on Home stayed open over the trip Back went to.)
- **Phone-first layout, adapting up:**

  | Width | Trip | Home and sign-in |
  | --- | --- | --- |
  | Under 768px | Header card over the map, plan in a bottom sheet (half or the whole day); modal sheets slide up, and the stop sheet leaves the map in view | A 480px column on the plan sheet's grey, New trip at the bottom |
  | 768px and up | Header and plan in a side panel beside the map; modal sheets cover the panel | Trips in a grid of cards, New trip in the header; sign-in in a card; other sheets are dialogs in the middle |

  16px text in form fields (stops iPhone zooming in), and spacing for phone screen edges. The prototype has the same layouts at every width.

## Prototype notes

- **Running it:** from the repo root, `python -m http.server 5173 -d .`, then open `http://localhost:5173/prototype/`. The design system demo is at `http://localhost:5173/design-system/`.
- **Tech:** plain HTML, CSS, and JavaScript with no build step, styled entirely by the [design system](../design-system/README.md). It follows the phone's light or dark setting. The map is drawn by [MapLibre GL JS](https://maplibre.org) 5.24, served with the app; with no WebGL it says so where the map would be, and the plan works as ever.
- **External services:**

  | Purpose | Service | Notes |
  | --- | --- | --- |
  | Routes | OSRM public demo server; OpenStreetMap Germany's routers on foot and by bike | Rate-limited. Results are cached, and if a request fails it falls back to a straight-line estimate. |
  | Place search | Nominatim | |
  | Sights on the map | Overpass API (OpenStreetMap) | Asked straight from the browser, a map tile at a time; the last 200 tiles are kept for the visit. |
  | A sight's photo and lines | Wikidata, English Wikipedia, Wikimedia Commons | Asked straight from the browser when a card opens; the last 300 are kept for the visit. |
  | Background map | Stadia | Vector tiles drawn by MapLibre, online and saved for offline; Stadia's pictures where MapLibre can't run. Falls back to OpenStreetMap if Stadia's map doesn't load. |

  None of these are meant for production traffic.
- **Data:** saved in the browser, one browser only. The app's server is answered in the browser, so share links, deleting with Undo and the rest work as in the app. Open tabs sync with each other, which simulates co-editing. There's no sign-in: you're Alex unless `?as=` says otherwise.
- **Offline:** the prototype's pretend server can't be reached with no connection either. Save a trip for offline, then turn the network off (DevTools → Network → Offline) and reload. Saving needs `localhost` or https, since service workers need a secure page.
- **Simulating other people and dates:**

  | Add to the address | Effect |
  | --- | --- |
  | `?as=sam` or `?as=jo` | Use the app as another person. Open two tabs to try co-editing. Trip settings links to these, through the trip's share link, so Jo joins the trip. |
  | `?today=2026-11-20` | Pretend it's a trip day, to preview the highlight and the dimming. |
| `&now=14:10` | With `?today=`, pretend it's that time, to preview what's highlighted and what dims. |

## Open questions and next steps

- **Backend:** real accounts, sharing between devices, and handling two people editing the same stop at once.
- **Production map services:** a paid or self-hosted service for routes, search, and the background map.
- **Transport modes:** shipped (see [How you get there](#how-you-get-there)). Not yet: transit times, which need a timetable service, and a flight drawn as an arc rather than a straight line.
- **Phone-friendly gestures:** dragging to reorder is still to come. (Swiping a row sideways put a stop in a folder, until folders were taken out.)
- **Day view in the app:** shipped. The day bar (now the day tabs), timeline, hotel stays, stop types and floating buttons are in `app/web`, with their styles in the design system (v2.0.0). Stops store `kind` and `nights` on the server. Trip settings also holds Make a new link, and the trip name saves when you leave the field.
- **How long a stop lasts:** an optional Leave time on every stop was shipped, then taken out: it didn't add anything to the plan (see [Stop times](#stop-times)). An optional Duration took its place, picked from a list, which checks the drive after it. Default lengths per type (a meal 1 hour, a museum 2) could suggest one.
- **The map and list:** the header, the half/whole-day sheet, route previews, the stop sheet that leaves the map in view, the Type page and hotel check-out times are in `app/web` and `prototype/`, with their styles in the design system (v3.0.0).
- **From the UX review, not yet done:** quick time choices in Add stop, showing who's on the trip at a glance and what changed while you were away, and marking estimated drive times with `≈`.
- **Map credits:** Stadia's and OpenStreetMap's terms ask for attribution on or next to the map. The app now shows them only in trip settings, like the prototype. Check the terms before this deploys; if needed, bring back a small ⓘ button on the map that shows the credits.
- **Offline:** shipped as read-only (see [Offline](#offline)). Edits made offline could wait in a queue and save once the connection is back, rather than failing. The map is only saved with Stadia: OpenStreetMap's tile policy doesn't allow bulk downloads. Each saved tile counts against the Stadia plan, and the terms on keeping tiles offline should be checked before this deploys.
- **People at a glance:** with the header gone, who's on the trip is one tap away. If that hides co-editing too much, a small stack of faces could go back on the settings button.
- **Accessibility:** a full review, including focus handling in the sheets and screen-reader labels for pins.
