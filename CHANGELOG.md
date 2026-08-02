# Changelog

Versions carry a `-v13` suffix: the OGame generation the build targets. It still runs on v12.

## 0.4.0-v13

### Added

- **Limiter button in the fleet bar.** The limiter is the setting you retune most while dispatching, and
  the only ways in were the settings popup or clicking a "-X" badge, which is only there once the
  limiter already holds something. There is now a button right after the game's own "all resources" /
  "none" buttons. Purely additive: nothing of the game's is moved, resized or hidden, and it opens our
  own panel rather than triggering any game action.

- **Per-planet and per-moon night fleet-save presets.** A body can now carry its own fleet-save preset
  — destination, mission, speed and the three "leave" reserves — instead of following the global one.
  The fleet-save panel gained a scope banner showing which preset it is editing, with one switch to
  give the body its own (seeded from the global, so nothing jumps) or hand it back.
  Bodies running their own preset show a `bedtime` marker in the planet list, and that marker **is** the
  shortcut: clicking it opens that body's preset without travelling there first. Only configured bodies
  get a marker, so every other row is untouched. It hangs in the body's own build-icon list rather than
  the side strip, because a planet and its moon share that strip and a marker there could not say which
  of the two it belonged to.
  Resolution goes through one helper, `Util.fsFor(db, bodyId)`, which `fleetSave()` uses for all seven
  preset reads — so a body cannot end up sending to its own coordinates while keeping the global's
  reserves. Like the limiter, an override **replaces** the global rather than merging: a blank
  coordinate stays blank and a 0 reserve stays 0 instead of inheriting.
  Storage follows OGLight 5.4.2's shape (`myPlanets[id].fsData`). Its `redirect` / `oglmode=6` chain
  was deliberately **not** adopted — see Notes.

- **Legacy menu placement** (`options.legacyMenu`, off by default). The old OGLight had no button strip:
  it put its controls in a compact icon grid inside the game's colony-count box above the planet list.
  With this on, the same buttons render there as a 4-column grid instead of the strip. Toggling it
  rebuilds the bar in place, no reload needed.
  One thing from the legacy script was deliberately not copied: it blanked the game's own colony counter
  with `#countColonies { color:transparent }` and `p { display:none }` to make room. Hiding game text is
  not something we do, so the counter stays visible and the box grows instead.

### Notes

- The night fleet-save's existing `oglmode=6` behaviour is unchanged by this release, but it deserves a
  flag now that the feature is being extended: after a send it navigates on its own to the next body and
  pre-fills the preset there, so one initial click starts a chain that walks the empire. Every **send**
  is still a separate manual confirmation, and OGLight 5.4.2 ships the same design, but the automatic
  navigation and pre-fill are exactly the kind of chained behaviour a reviewer may read as automation.
  This is a grey area worth a ToolDev's written opinion before publishing (AGENTS.md §3). Nothing was
  built on top of that chain here: per-body presets work identically without it.

## 0.3.0-v13

### Added

- **Per-planet and per-moon limiters.** A body can now run a limiter that differs from the global
  profile for its type. The limiter panel grows a fourth column for the body you are standing on, with
  one switch in its header: off, the column shows the global values it inherits, greyed out and not
  editable; on, the body gets its own profile seeded from those same values, so nothing jumps when you
  flip it. Switching back off deletes the override and the body follows the global profile again.
  An override **replaces** the global profile rather than merging with it, so a 0 means "keep nothing
  here" instead of the ambiguous "unset, ask the global".
  Resolution lives in one place, `Util.limiterFor(db, bodyId, isMoon)`, and all five consumers go
  through it: fleet dispatch (`updateLimiter`), the held-resource badges, `selectSiblingShips`, the
  night `fleetSave` and the empire-page jumpgate shortcut. Two of those were easy to miss — `fleetSave`
  resolved its own profile through a differently named local, so a first pass that searched for the
  obvious name left it reading the global profile while the panel showed the per-body one, which is
  exactly the drift this helper exists to prevent. The jumpgate shortcut previously read the global
  *planet* profile through a hard-coded `fleetLimiter.data`; it now resolves the body it was given,
  which returns the same profile as before when no override exists.
  Everything that still touches a profile directly does so deliberately: the panel's "copy from" chips
  and the override seed write to one named global profile, and the jumpgate keeps its own global
  profile by design.

### Changed

- **Billions now print as `B`, not `G`.** The inherited code mapped the French compact unit "Md" onto
  the SI letter G (kilo/mega/giga/tera). Both ladders are internally consistent, but B is what OGame
  players read as a billion while G reads as a unit of data. `Util.formatInput` accepts `b` **and**
  keeps accepting `g`, so typing either into a limiter or fleet-save field still means 10⁹ — the
  display letter and the parser were coupled, and changing only the display would have broken typing
  what you see.

- **Editing the planet column of the limiter panel now refreshes immediately.** Only the moon and
  jumpgate columns triggered a refresh; planet edits waited for something else to redraw.

## 0.2.9-v13

### Fixed

- **The per-fleet notification buttons disappeared from the event list.** Each button was attached
  inside a `if(parent)` guard, where `parent` came from `document.querySelector('#eventRow-<id>')` in
  the live page. On v13 that lookup always misses for the reason `load()` already documents: v13 does
  not pre-render the event rows the way v12 did, so `#eventboxContent` is still empty at that moment —
  OGame only fills it later, when the player opens the event list. The guard then skipped the whole
  block without a trace. The button data is now kept and attached by a new `decorateEventRow()` as
  soon as its row exists, driven by a `MutationObserver` on the event box, so the buttons are back on
  v13. What they do is unchanged: one button per fleet, armed only by an explicit click from the
  player, never registered automatically. Verified against the shipped method source in a harness:
  nothing is attached while the box is empty, exactly one button appears once rows render, repeat
  mutations do not duplicate it, rows without data stay untouched, and zero notifications exist until
  the button is actually clicked.

### Notes

- The observer watches the DOM only. It issues no request, runs no timer and polls nothing; it reacts
  to markup the player's own click made the game render, so it sits outside AGENTS.md §1.3 and §4.

## 0.2.8-v13

### Fixed

- **Event list: the countdown stayed green instead of taking its mission's colour.** 0.2.7 hooked the
  colour onto `.countDown`, mirroring how the base stylesheet colours `.detailsFleet`. In game that
  selector matched nothing — v13 paints the countdown cell through some other name — so the rule
  silently did nothing while looking correct in review. Each rule now carries a positional hook beside
  the class one: the row's first cell is the countdown at every width, and a trailing `*` reaches a
  nested element carrying its own colour, so the mapping holds whether the colour sits on the cell or
  inside it. Checked against four shapes (v12 class, renamed cell, renamed cell with a coloured inner
  span, v12 class with inner span) with the game's own green applied on top; all four resolve to the
  mission colour.

## 0.2.7-v13

### Fixed

- **Lifeform building and research costs could render as 0.** The lifeform bonus terms multiplied a
  per-planet level straight out of storage, e.g. `planetData[12108] * getTech(12108).bonus1BaseValue`.
  Before that planet's levels are hydrated the lookup is `undefined`, and `undefined * number` is
  `NaN`, which then propagated through `tech.bonus.price`/`duration` into every computed cost and
  printed as `0` — every cell at once, which is what made it look like missing data rather than an
  arithmetic fault. All 15 exposed sites now coerce a missing level to 0 (and a missing tech entry to
  0), so an unhydrated planet yields no bonus instead of poisoning the whole calculation. Diagnosed
  from a live probe: the DOM level read and the base cost table were both fine, ruling out the
  selector-rename explanation that the symptom suggested.

- **Event list: arrival times were cut off at both ends.** The row grid gave the arrival-time column a
  hard 62px while the cell is centred and every cell sets `overflow:hidden`, so a longer time lost
  characters at the start *and* the end simultaneously — reported as `:40:01 Orolo`. That column now
  sizes to its content (131px measured for `14:40:01 Orologio`), and the one flexible column became
  `minmax(0,1fr)` so the width comes out of slack it already had rather than widening the row.

### Changed

- **Event list: the countdown now carries its mission's colour.** The stylesheet already mapped
  `[data-mission-type]` onto the `--mission*` palette for the ship-count column; the timer was left on
  a single colour regardless of mission. The same mapping now covers the countdown, so an expedition
  reads blue end to end. Verified the countdown's computed colour matches the ship count's for every
  mission tested, and that the times stay unclipped from 1191px down to 760px.

## 0.2.6-v13

### Fixed

- **Removed a rule that displaced OGame's advertisement banner.** The inherited base stylesheet carried
  `div#bannerSkyscrapercomponent { margin-left:300px !important }`, which pushed the skyscraper banner
  300px to the right, presumably to clear space for an older side-panel layout. AGENTS.md 1.7 forbids
  hiding, obscuring, resizing, moving or otherwise altering banners and monetization content "in any way,
  including sneaky CSS tricks", so this would have been grounds for rejection at review. The declaration
  is deleted from the source rather than overridden, so nothing in the shipped file touches the banner.
  Checked that removing it does not create the opposite problem: the tool never shifts the game's own
  layout containers, and its only persistently positioned element is the side panel, which sits
  off-screen (`translateX(±100%)`) until the player opens it, on either side setting.

## 0.2.5-v13

### Fixed

- **Empire production was 3600x too large on v13** (a level 43 metal mine read `+137.97 G` per day, the
  account total `+1.67 T`). The production keys are stored per SECOND: every consumer multiplies by
  `3600 * 24` for a daily figure, the resources-bar writer feeds units/second, and the v12 empire parser
  divides its hourly payload by 3600 for exactly that reason. The v13 `accountInfo` path reports hourly
  values and stored them raw, so the daily figures came out an hour's worth too high. It now divides by
  3600 like the v12 path, and the canonical unit is stated at the writer so the four writers cannot
  drift apart again. The same row now reads `+38.33 M` per day and the total `+463.89 M`.

  This is the second half of a bug whose first half shipped in 0.1.0: the keys were also written
  lowercase there while the empire tab read camelCase, which showed as `0`. Normalising the name in
  0.1.0 revealed the value, and only then could the wrong scale be seen. Unifying the key was not enough;
  the unit had to be unified too.

## 0.2.4-v13

### Fixed

- **Galaxy view showed a stray "(v)" vacation marker in the position column, including on empty
  positions.** Two causes. The status element was looked up with
  `row.querySelector('[class*="status_"]')` as a fallback, loose enough to match a cell that is not the
  player's, and the function it is handed to adds a `status_abbr_*` class to whatever it receives, which
  is what OGame renders as the `(v)` prefix. The lookup is now scoped to the player cell, so a marker
  cannot land in the position column. Second, the per-system reset spares the position cell (it holds the
  number) and only cleared two of our own classes, so a status class that had landed there survived into
  the next system and sat on a position that no longer held anyone. The reset now strips
  `status_abbr_*` and `data-status-tag` from every cell while leaving the position number in place.
  Reproduced and verified against a real DOM with the shipped code: the marker is gone, the lookup never
  selects the position cell even on an empty row, and the position numbers survive the reset.

## 0.2.3-v13

### Fixed

- **Lifeform levels showed floating-point noise, e.g. `87.00000000000001`.** Regression from 0.1.0, when
  the v13 path switched to OGame's species-bonuses export: the UI rebuilt the level from the bonus
  percentage as `bonus * 10`, and the server sends fractions such as `0.08700000000000001`, so the
  reconstruction carried the error into the label. The export already contains the exact integer `level`,
  so the five display sites now read that and only fall back to the derived value for the v12 scrape,
  which has no level field, rounded because a level is always a whole number.

## 0.2.2-v13

### Fixed

- **Structures and in-flight fleets drew on top of each other in the planet list.** The side icons were
  three absolutely positioned tiers 13-14px apart, but each tier renders 15-17px tall, so three of them
  need about 48px and the compact 41px row could not hold them. A planet carrying both a structures icon
  and a returning fleet overlapped, which is why it only showed when some planets had fleets in flight.
  The strips now sit in one horizontal flex row beside the planet, so the vertical budget stops mattering
  at any row height. Verified for every combination (structures only, fleet only, both, plus the jumpgate
  timer, plus none): no overlap, nothing outside the row, and unused strips collapse instead of leaving
  gaps.
- **The left-menu entry rendered as bare text instead of a menu button.** Removing the icon also removed
  the empty `.menu_icon` cell OGame's menu lays out against, and without an `href` the game's link
  styling never applied. The empty icon cell is back and the entry carries an href, so it gets the native
  button chrome; it opens PrOGect's own settings rather than any external page.
- **The jumpgate left the view on the origin moon.** After a successful jump the ships are on the
  destination, so every follow-up click started on the wrong body. The game now follows the fleet to the
  moon that was jumped to. This is a foreground navigation caused by the player's own jump click, the
  same thing clicking a moon in the planet list does, not a background call.

## 0.2.1-v13

### Fixed

- **The restyled spy table was too wide and its action buttons spilled out of the messages tab.** The
  0.2.0 column widths were tuned against a mock built at 1000px, but moving the table inside
  `.messageContent` gave it a much narrower parent, and the fixed tracks plus a 140px floor on the name
  column forced a 730px minimum. The track is now fluid: every data column may shrink, the name absorbs
  the slack, and the only hard floors are the row number, the type icon, a 48px name and the actions'
  own content. No container width is assumed anywhere. Verified at 480, 560, 720 and 900px: nothing
  overflows and all five action buttons stay inside the panel and clickable at every width.
- The action buttons used the bordered chip from the settings sub-panels. That vocabulary does not fit a
  dense five-icon table row, so they are compact borderless icons with hover feedback, as the base had.
- The sort arrow was drawn on all nine sortable columns, stealing width and, being floated, wrapping the
  header onto a second line. It now appears only on the column actually sorted, and the header is one
  line again at every width.

## 0.2.0-v13

### Fixed

- **Spy table sat under the game's own message tabs.** The inherited CSS pulled the game's
  `.tabsWrapper` out of flow with `position:absolute` and v12 pixel metrics (`top:114px`,
  `left:10px`, `width:650px`); on v13 that dropped the tabs on top of the first two rows and hid a
  report completely. The table is now inserted *after* the tabs, so the game's menu keeps its native
  position and nothing is repositioned.
- **Fleet fuel was all attributed to expeditions.** Consumption was recorded as a single aggregate
  and only rendered on the expeditions tab, so attack fuel inflated expedition costs and the attacks
  tab had no consumption row at all. Fuel is now split at record time by destination: position 16
  (the expedition slot) and positions 1-15 (attacks) are tracked separately, each tab shows its own
  row, and the topbar mini recap still reports the combined figure. Days recorded before this change
  keep everything under the expedition bucket; a single aggregate cannot be split retroactively.
- **The PrOGect entry in the left menu was invisible until hovered.** It is not a link, and OGame
  colours menu labels through a link pseudo-class, which does not match an anchor without `href`.
  The label colour is now set explicitly.
- The spy table's total row closed with `<div>` instead of `</div>`, injecting a stray empty cell.

### Changed

- **Spy table restyled onto the design tokens.** It still used hard-coded surfaces, the old amber
  accent for the active filter and 11px text, with header labels at roughly 2:1 contrast. Now on the
  `--syl-*` system: violet accent for active filter and highlighted rows, tabular numbers, action
  buttons as the same compact icon chip used elsewhere, and a `prefers-reduced-motion` alternative.
  Measured contrast: header labels 5.80:1, data 13.35:1, dimmed rows 5.36:1 (they were `opacity:.2`,
  i.e. unreadable).
- The spy table's column track was duplicated between header and rows and could drift; it is now one
  `--spy-cols` custom property.
- Fleet and defence values were tinted with an inline gradient from JavaScript; they now use a state
  class driven by tokens.
- Removed the inherited OGLight icon from the left-menu entry (a PrOGect logo comes later).

## 0.1.0-v13

First build under the PrOGect name. Fork of OGLight 5.3.3 (MIT, © 2019 Oz), ported to OGame v13 and
kept working on v12.

### Fixed

- **Fleet movement indicators never appeared on v13.** The event-list fetch was gated on
  `#eventboxContent .eventFleet`, which v13 leaves empty until the list is fetched, and the response
  is a JSON envelope whose HTML lives at `content.eventlist` rather than the older
  `components.eventList`. The fetch now feeds the parser directly, because the global jQuery
  `ajaxSuccess` hook does not fire for that request on v13.
- **Empire update only worked on v13.** There was no version branch, so pre-v13 servers silently got
  nothing. Added an OGame-version sniff plus the v12 empire endpoint, which feeds the v12 parser that
  already shipped but was never called.
- **Research and lifeform-research durations were far too long.** The lifeform bonuses were scraped
  from a `DOMParser` document, where custom elements never render, so the research-time reduction was
  lost and the duration factor collapsed to 1 (a 70% reduction made durations 3.3x too long). v13 now
  reads OGame's own species-bonuses export; the v12 scrape stays, hardened against missing rows.
- **Fleet save ate the deuterium it was told to leave behind.** It discarded the profile limiter's
  reserve (both wrote the same fields, last writer won) and never reserved flight fuel, which is
  charged on top of the deuterium loaded as cargo. It now holds whichever reserve is larger and
  reserves the consumption.
- **Empire production columns read 0.** Production was written with lowercase keys and read with
  camelCase ones. Normalised on camelCase.
- The expedition hold time was lost when the redirect pre-filled the next planet.

### Notes

- Renamed from the working title ProjectSyl.
- The PTRE integration keys and the inherited icon-font ligature names are external contracts and are
  deliberately left untouched.
