# Changelog

Versions carry a `-v13` suffix: the OGame generation the build targets. It still runs on v12.

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
