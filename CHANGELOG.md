# Changelog

Versions carry a `-v13` suffix: the OGame generation the build targets. It still runs on v12.

## 0.6.4-v13

### Changed

- **The satellite link goes to the solar satellite on the resources page, not the shipyard.** That is where
  the game builds satellites, and where antigame pointed. It uses `openTech`, a parameter this script
  already honours, so the satellite's own panel opens on arrival; the count rides along in `oglsat` and is
  typed into the game's own `#build_amount` field.
- **The prefill runs from the panel's own load hook instead of guessing at the DOM.** The old version ran
  on the shipyard page and looked for `#button212`, a selector that does not exist: the game's elements are
  `.technology[data-technology]`. It now fills the field inside `check()`, which is called the moment the
  panel's content lands, so there is nothing to wait for - no timer, no retry loop. The event it fires is
  the game's own `input`, so the game's clamp and recompute run exactly as if the number had been typed.
  Verified in a browser: the field fills, the game's listener sees it, `oglsat` is dropped from the URL
  while `openTech` stays, a reload refills nothing, another tech is ignored, and 250000 clamps to 99999.
- The satellite count reads `[min. N]`, the form antigame used, in both places it appears.

### Added

- **The solar satellite's own panel now says how many would bring the planet's energy back to zero.** Same
  row shape as everywhere else: energy available now, then `[min. N]`, or a green check when the planet is
  already positive. No link on this one - it is the page the link leads to.
- Per-satellite output is read after the lifeform and engineer bonuses are applied, not from the raw
  formula. This is why the figure can differ from antigame's: on the planet in the reference screenshot the
  game's own description states 38 energy per satellite, which needs 28 to clear a 1.056 deficit, while the
  unbonused formula gives 33 and antigame therefore said 32. Ours agrees with the number the game prints.
  Verified against the shipped code on eight cases, including exact multiples, one unit either side of a
  multiple, and a missing output figure.

### Compliance

- **The satellite link and prefill are flagged as a gray area and need ToolDev sign-off before publishing**
  (AGENTS.md 3). One click of ours opens one page the player asked for with a quantity in a field; nothing
  is submitted and the build order is still the player pressing the game's own button. It is a convenience
  that touches the game's flow, so a ToolDev decides, not us. Both code sites carry the marker.

## 0.6.3-v13

### Fixed

- **The satellite row never appeared at all.** The figures were computed correctly, but the reading side
  asked for `conso > 0` and by then `conso` is negative: `getTechData` negates it on its last line, which
  is how the panel shows `-3.6k`. The condition could never be true, so the row was never built. It now
  keys off the satellite figure itself, which is only set when the body draws energy.
- **The production figure was heavier than its neighbours.** The cost wrapper is already
  `font-weight:700`, so the `<b>` wrapped around it rendered heavier still. Colour is carried by the
  cell's class now, exactly as the game's own rows do it, and every figure in the block measures
  `16px/700`.

### Added

- **The energy row is the whole question, not just the satellite count.** Three cells, in the shape the
  cost rows already use: energy available now, where it lands after this level, and what covers a
  shortfall. The third cell is a green check when nothing is needed, the same mark those rows use for a
  cost the planet can already pay; when satellites are needed it is their count, and clicking it opens the
  shipyard with the amount filled in. It carries the game's own energy sprite rather than an invented
  glyph.
- Per-satellite output is no longer a second copy of the formula: it is read from the satellite's own
  entry (212), so this figure and the one the game shows on the satellite cannot drift apart.

### Changed

- **An already-negative planet is now covered in full.** The shortfall was measured against the current
  surplus clamped at zero, which under-counted satellites on a planet that was in deficit before the
  upgrade. Verified against the shipped code on eight cases: surplus, shortfall, existing deficit, exactly
  covered, one unit short, rounding up at both ends of a unit, and a missing per-satellite figure.
- The production glyph is the panel's label grey instead of the accent. The accent marks actions and
  selection here, and an icon is neither; the satellite figure keeps it, because it is the row's action.

## 0.6.2-v13

### Fixed

- **The mine panel's two new rows crowded the build button and printed `TEXT_NOT_FOUND`.** They were
  added to the row of figures above the description, which in this panel is a horizontal strip, not the
  vertical list the same information sat in elsewhere. Two more items in it pushed against the build
  button and cut the duration short. They now go in the vertical cost block, beside metal, crystal and
  MSU, which is a list and has room. The label was the second half of it: `_lang.find` returns the
  literal string `TEXT_NOT_FOUND` for a key that does not exist, and `production` was never a key. There
  are no text labels now - each row is identified by a glyph, the way every other row in that block is.
- **Both new rows sat 10px left of the figures above them.** Every sprite class in the game's icon sheet
  re-declares the whole icon box rather than adding to a shared one, so a rule that only sets what it
  changes inherits nothing: the 28px width and 10px gap had to be repeated. All five figures now start
  at the same x.
- **The refresh timer in the clean planet list was unreadable.** Removing the row's chrome had taken its
  plate with it, leaving dark digits on the sky. It gets a 17px disc with a hairline ring and a drop
  shadow, so it reads as a badge sitting above the planet rather than paint on the background.
- **The selection halo was clipped into a rectangle.** `.planetlink` and `.moonlink` carry
  `overflow:hidden !important`, so the part of the glow outside the link's own box simply vanished. That
  is opened up in this theme, and the halo is softer than the first attempt - a 1px ring with a wide
  low-opacity bloom instead of a hard 2px outline.
- **Planet name and coordinates now lift off the background** with a tight edge shadow plus a wider soft
  one, instead of sitting flat on the sky.

### Notes

- The glyphs in this build are checked against the embedded font before use. It is a subset with OGame's
  own additions, and the names do not always mean what they do in the standard Material set:
  `settings_input_antenna` paints a cog, `brightness_5` paints the digit 5, and a name the subset lacks
  paints nothing at all - which is how an earlier build ended up with an empty column header. Production
  uses `monitoring` (a chart) and the satellite count uses `rocket`, both confirmed to draw.

## 0.6.1-v13

### Fixed

- **Fleets could not be sent to debris fields — a regression from 0.5.3.** That release added a guard so
  the check response could not change the destination's body type behind unchanged coordinates. But it
  only knew what *we* last asked for, not that the player had since picked a debris field through the
  game's own controls: the live target had already moved to type 2 while our record still said 1, so the
  guard read a deliberate choice as a disagreement and forced the target back to the planet — "it takes
  the mission, then re-selects the planet and will not send".
  The guard now also requires the live target to still equal what we asked for. If it does, nobody has
  changed it since and the response is the one disagreeing; if it does not, something after us set it on
  purpose and we keep our hands off. Verified across eight cases including debris and moon picked by the
  player, both directions of our own request, differing coordinates and no request recorded.

- **The fleet-save button in the bar did nothing.** `openFleetSaveConfig` lives on `TopbarManager`, not
  `UIManager` — the same split that already caught `openSettings` once. Calling it through `_ui` threw,
  `Util.runAsync` swallowed the error, and the button silently did nothing. All three call sites are
  routed through the real owner now, which also fixes the planet-list marker and the held-resource badge.

- **The game's submit button was squeezed.** Our four buttons each claimed a slot on the game's own row.
  They now sit in one block of their own, two by two: 67px instead of 137px, so 70px go back to the
  submit button. Only our footprint changed — the game's controls keep their place and size, and the
  fleet-template selects were left alone.
  Their button skin comes from `.secondcol>[class*=ogl_]`, a direct-child selector, so wrapping them made
  the wrapper inherit the skin while the children lost it. The skin is taken off the wrapper and put back
  on the children, measured at 32×26 each with the wrapper unstyled.

### Changed

- **Clean planet list refinements**, from the first look at it: 7px between rows instead of the framed
  spacing, planet and moon images centred on the row and sized to sit inside it so they show whole
  (38px and 26px), and the selection moved off the row. A filled rectangle around the whole row could
  not say *which* of the two bodies it meant; the glow now sits on the selected body's own image, so
  planet and moon are told apart at a glance.

### Notes

- **A backtick in one of my own comments silently deleted a third of the stylesheet**, for the third time
  in this project. Quoting a CSS selector as `` `.secondcol>...` `` inside a `GM_addStyle` template ends
  the literal, so every rule after it never reaches the browser — while `node --check` stays green.
  Both the button block and the theme refinements above were dead on arrival, and the first round of
  measurements "confirming" them was measuring CSS that did not exist.
  The release guard has been strengthened: it previously only asked whether the blocks *close*, which
  this case passed happily — an early backtick closes one block while the intended closer opens another,
  so the count stays balanced. It now checks each block for balanced braces and that it ends on a closing
  brace or comment. Verified by reintroducing the fault on purpose: the guard fails the release and names
  the block.


## 0.6.0-v13

### Added

- **Clean planet list** (`options.cleanPlanetList`, off by default) — an antigame-style reading of the
  list: no cards, no button chrome, no frames, round unframed planet and moon images, the current body
  marked by a hairline instead of a filled block. Text carries the hierarchy that the frames used to.
  What it deliberately keeps is every figure the tool adds: available resources, refresh timers, the
  build and fleet-save markers, the side-icon strip. The point is to remove the furniture, not the
  information — verified by measuring both states of the same list, where all seven data elements stay
  visible while the row background, border and button gradients go transparent and the images become
  round.
  Only the tool's own styling is undone. Nothing belonging to the game is hidden, moved or resized: the
  planet links stay where the game put them and stay clickable.
  Like the other appearance options it is applied from a body attribute written at startup, so it takes
  effect on the first frame rather than flashing the default first, and the toggle applies it live.


## 0.5.7-v13

### Added

- **Mine panels now show what the upgrade buys and what it costs in energy**, the way antigame did. Two
  rows join the game's own list: hourly **production** (gain and new total) and **solar satellites**
  needed. The game already prints the energy delta itself, so that is not duplicated.
  The satellite figure is a link when it is not zero: it opens the shipyard with the amount already in
  the field. That is a prefill, not a build order — the count travels in `oglsat`, a parameter of ours
  rather than an invented game endpoint, and the build stays the player's own click on the game's button.
  The parameter is stripped from the URL afterwards so a later reload does not silently refill anything.

### Notes

- The production projection does not enumerate bonuses. The base hourly formula is published, but real
  output also carries universe speed, officers, lifeform and class bonuses. Instead the multiplier is
  **derived from the planet itself**: the production already stored for the current level, divided by the
  base formula at that level. Whatever bonuses apply are inside that ratio, so the projection stays right
  even when the game changes one of them, and with no stored production it falls back to the plain base
  figure rather than a wrong one.
  Verified against the shipped code: on a speed-8 universe a metal mine 30→31 projects a gain of 17,170
  and a total of 142,805, both exact; with no stored production it returns the base figure; deuterium
  output falls with temperature (1,937 cold vs 1,399 hot); and the satellite count is right across four
  cases — surplus covering it, a full deficit, a partial surplus, and an exactly covered draw.
- The satellite count reuses the same per-unit energy formula the satellite's own panel uses, so the two
  cannot disagree.


## 0.5.6-v13

### Added

- **A fleet-save preset button in the fleet bar**, next to the limiter one. The preset is per-body now,
  so the useful place to reach it is the fleet page of the body it configures. Built like its neighbours
  so it inherits the game's button chrome — measured 36×30, identical to the quick-collect button — and
  carrying the same white glyph as the limiter so the pair reads together. It opens a panel only.

### Fixed

- **The limiter panel had no icon in its title.** It now carries the same stopwatch glyph as the
  fleet-bar button.

### Notes

- A wrong fix was nearly shipped here. The blank was assumed to be the "planet" column header, on the
  theory that `planet` is not a Material Icons ligature, and it was swapped for `public`. Rendering every
  ligature this file references to a canvas and counting ink showed the opposite: `planet` draws 252
  pixels, `public` draws **zero**. The embedded font is OGame/OGLight's own and carries custom glyphs
  such as `planet`, `ptre` and `genetics`. The swap would have replaced one gap with another; it is
  reverted, with the reasoning left in the source.
- For the record, the ligatures referenced in this file that draw nothing in that font are `alert`,
  `arrow_right_alt`, `done`, `group` and `jump_to_element`. None is used by the limiter panel.


## 0.5.5-v13

### Fixed

- **A planet with no moon no longer looks like it has one.** The row is painted as a card across its
  full width while the planet and moon links carry their own backgrounds, so on a moonless row the third
  of the card nobody fills stayed visible and read as one very long button continuing past the planet.
  That painting is dropped for those rows: the planet's own button is all that is left and the moon's
  half is simply not there. The planet button deliberately does **not** stretch to fill the row — the
  ask was for that half to stop existing, not to grow.
  The row keeps its width, so the list stays aligned and the side icons, positioned from the row's right
  edge, do not shift. The selected state still reads, since it shows on the planet button itself.
  Measured with the shipped stylesheet: a row with a moon stays painted with 138px planet + 66px moon
  and only the 4px gap unpainted; a moonless row reports a transparent background and border with 70px
  unpainted and its planet button still 138px, the same as every other row.


## 0.5.4-v13

### Fixed

- **The expedition cap fell back to the previous step, and correcting it once never held.** The cap step
  is chosen from `serverData.topScore`, and that value had two writers of unequal authority which both
  assigned unconditionally: the in-game highscore, which is live, and `serverData.xml`, which is a
  snapshot the public API republishes on its own schedule and can still report a score the top player
  passed hours ago. So opening the highscore raised the cap correctly, and the next hourly API read
  overwrote it with the older figure — which is exactly why the fix had to be repeated.
  The API may now only ever *raise* it. The live highscore reading still assigns exactly, so a genuine
  decrease — a vanished top account — is still picked up.
  Reproduced against the shipped step table before fixing: API 24M → highscore 26M (cap 2.4M → 3.0M) →
  API republishes 24M → cap back to 2.4M, twice, until the API caught up. After the change the cap holds
  at 3.0M throughout, and a live reading of 900k still drops it to the 1.2M step.

- **A NaN trap in the same line.** The score was parsed with `parseInt(Number(text))`, and `Number()` on
  a figure carrying any separator yields `NaN`. A `NaN` top score matches no step at all, since the
  table is scanned with `topScore >= value`. The digits are now stripped before parsing.

## 0.5.3-v13

### Fixed

- **The check response could change the destination's body type behind the coordinates.** The response
  is adopted wholesale, type included. A probe measured 35 cases where we ask for the planet (type 1)
  and the answer names the moon (type 3) at identical coordinates, 1–3 ms later — our own request, not a
  stale one. Because a planet and its moon share coordinates, adopting that moves the destination to the
  other body with nothing on screen changing. When the answer names the same coordinates and disagrees
  only about the type, the requested type now wins. Forcing a *moon* is deliberately not done: a moon
  can be absent, and there the server's correction is the right one.

### Corrected

- **0.5.2 attributed those 35 probe entries to the wrong cause.** It shipped a guard against flipping
  the destination onto a non-existent moon and presented it as the cause. It is not: `setRealTarget`
  applies the forced type *before* the probe records its intent, so a flip to the moon logs intent
  type 3 — while all 35 entries logged intent type 1. The flip produced none of them. The guard is kept
  as a defensive change, correctly labelled in the source now, and the real handling is in the response
  handler above.

### Still open

- **The reported expedition failure is NOT fixed by this release**, and the fix above cannot address it.
  That fault is a *coordinate* divergence — the form reading 4:264:8 while the target reads [4:105:16],
  distance `NaN`, "no mission selected" — and this guard only acts when the coordinates match and only
  the type differs. It is reported as v13-only, which points at how the coordinate inputs are written or
  how v13 handles the position-16 slot rather than at anything type-related. A probe for it is in the
  local build only; no claim will be made about it until an actual expedition on v13 is measured.

## 0.5.2-v13

### Fixed

- **The root cause of the failed sends: the destination was flipped onto a moon that does not exist.**
  Sending to the body you are already standing on is a no-op, so `switchSelfTargetType` flips the
  destination to its sibling — planet to moon, moon to planet. A planet always exists; a moon does not,
  and the flip never checked. On a planet with no moon it pointed the fleet at a body that is not there,
  which the server resolves to nothing: distance `NaN`, no missions on offer, and the game answering
  "no mission selected" while the form still looked correctly filled in.
  The flip now only happens when there is something to flip to. Moon to planet is unaffected.
  This is the same failure 0.5.1 addressed from the other end. That fix stands and is still worth
  having — it stops an invalid mission being left set for any reason — but it treated the symptom;
  this is the cause.

### Notes

- Diagnosed from data, not inference. A probe recorded 35 occurrences with an identical signature every
  time: intent `type:1` (planet), response `type:3` (moon), coordinates the same, 1–3 ms apart — our own
  request, so not a stale response as first suspected. Two earlier hypotheses (a race between responses,
  URL parameters carried along the collect chain) were wrong and were dropped rather than "fixed".
- The moon check asks the planet list before our stored copy, deliberately: a colony founded during the
  session appears in the list before it reaches the store, so trusting the store alone would answer
  "no moon" for a body whose moon is on screen — and "moon" for one that was lost. Verified across seven
  cases including both of those staleness directions.

## 0.5.1-v13

### Fixed

- **"No mission selected" on sends that looked correctly set up.** Reported as the destination planet
  or moon not being taken, with a manual re-select as the workaround. The destination was not the
  problem: the *mission* was being left in a state the target does not accept, while its icon still
  rendered as chosen — so the form looked right and the send was refused.
  Every fleet check response zeroes `fleetDispatcher.mission` and a 50 ms timer restores it through a
  ladder of cases. Two holes in that ladder: if no case matches the mission simply stays `0`, and the
  branch for targets that are not your own falls back to `1` (attack) **without checking that attack is
  on offer** — at an expedition slot (position 16) it is not. Both end as an invalid mission.
  A final guard now runs after the ladder and never leaves a mission the target does not offer. It
  picks by intent rather than by list order: the expedition slot wants an expedition, otherwise the
  last order given, then the configured default, and only then whatever is on offer. If the available
  list has not been populated yet — the other half of the intermittency, since it is read 50 ms after
  the response — it retries once on the next frame instead of leaving the player unable to send.
  Verified by running the shipped guard against eight cases: expedition slot recovering from both the
  attack fallback and a zeroed mission, a still-valid last order, an unavailable last order falling to
  the default, neither available falling to what is on offer, an already-valid mission left untouched,
  a debris field with only recycle, and the empty list correctly reporting that it must retry.

### Notes

- A probe was added first to test the destination hypothesis and produced no data, so it was not the
  evidence for this fix; the screenshot of the failure was. The probe is kept out of the release.

## 0.5.0-v13

### Changed

- **Colorblind mode became a palette picker, and now actually does something.** It was a boolean that
  recoloured exactly two things — the `v` and `o` letters in the galaxy view — and left every other
  hue-carried signal alone. Most importantly it never touched the mission colours, where attack sits
  on red (`#ef5f5f`) and transport on green (`#66cd3d`): the precise pair red-green deficiency erases.
  Worth naming: 0.2.8 extended that mission colouring to the event countdown, so the tool had *grown*
  its reliance on that pair without the mode covering it.
  The setting is now a select with four palettes — deuteranopia, protanopia, tritanopia and
  achromatopsia — each redefining the same CSS variables the normal theme uses, so no component logic
  changes and nothing needs to know a palette is active. An existing `true` migrates to deuteranopia,
  the closest named equivalent of the old red-green palette; `false` becomes off.
  One palette could not serve all three: deuteranopia and protanopia both confuse red with green but
  differ in how dark long wavelengths read, while tritanopia *keeps* red/green and confuses blue with
  green instead, so its palette leans on the axis the other two avoid. Achromatopsia has no hue, so it
  separates on an even CIE L\* grey ramp with levels assigned by priority.

### Notes

- The palettes were measured, not eyeballed. Each colour pair was pushed through a Viénot simulation of
  its own deficiency and scored as a CIE Lab distance, reading the values back out of the shipped file
  rather than from the values used to write it. All eight meaning-carrying pairs clear ΔE 20 on all
  four palettes. Two rounds of tuning came out of that: ACS-defend had to leave the orange axis, where
  darkening it had parked it beside attack (ΔE 18), and the grey ramp had to be re-assigned off
  adjacent steps (transport vs recycle was ΔE 8).
- Honest limit: this fixes hue collisions. It does not fix the deeper issue that some states are
  signalled by colour alone — text or shape would be the real answer there.

## 0.4.4-v13

### Fixed

- **Switching settings surface left an empty side panel behind.** Turning `legacySettings` off
  re-rendered the settings as a popup but never dismissed the drawer, which keeps `currentSide =
  'settings'` and so stayed open as a blank column beside the popup. The two surfaces are mutually
  exclusive now: whichever one is being left is closed before the other opens.

### Changed

- **The limiter button moved in with the other fleet tool buttons and got its own icon.** It was
  inserted next to the game's "all resources" / "none" buttons with hand-written chrome, so it never
  matched anything around it. It now sits in `.secondcol` and is built exactly like the cargo and
  quick-collect buttons, inheriting the same button skin — measured at 36x30, identical to the
  quick-collect button beside it.
  The glyph is an inline SVG stopwatch with a rules bubble, stroked in white via `currentColor` so it
  follows the button's colour like its neighbours. No single Material icon carries that meaning, which
  is why it is drawn rather than picked from the font.
  Its tooltip reuses the existing translated `profileButton` string. Worth noting: `_lang.find`
  returns the literal `'TEXT_NOT_FOUND'` for an unknown key rather than a falsy value, so the invented
  key with a `|| 'Limiters'` fallback this first used would have displayed that string, not the
  fallback.

## 0.4.3-v13

### Changed

- **Legacy settings: every option now lives in the drawer, only the secondary panels open centered.**
  0.4.2 turned the drawer into an index of group names, so reaching any option took a click it never
  used to. That was the wrong read: the original puts all the options inline in the drawer, grouped
  into cards, and reserves the middle of the screen for the sub-panels (keyboard, limiters, fleet-save
  preset, data). The drawer is inline again — the card, header and row styling already used by the big
  settings page is reused rather than restated, so it is the same shape, just one column wide.

### Fixed

- **The real reason the drawer looked like a list of bare labels.** The container carries
  `.ogl_config .ogl_bigSettings .ogl_legacyInline` together, and `.ogl_bigSettings` pins
  `width:1000px !important` for the centered popup. Inside a 385px drawer the cards therefore stayed
  1000px wide, and every control — pinned to the right of its row — landed some 600px past the drawer's
  edge and was clipped. It was never the column count, which is what 0.4.1 and 0.4.2 both tried to fix.
  Measured before: cards 984px, all 21 controls outside the drawer. After: container 348px, cards 332px
  in one column, 0 controls outside, every control right-aligned and all icon pickers visible.

- **A stray backtick had silently truncated the new CSS.** A comment quoted a CSS declaration in
  backticks, which ends the `GM_addStyle(\`...\`)` template literal: every rule after it disappears
  while the file still parses, so `node --check` stays green and only the browser shows the damage.
  This is the second time it has happened here, so `bump-version.mjs` now fails the release if any
  `GM_addStyle` block does not close.

## 0.4.2-v13

### Changed

- **Legacy settings rebuilt as an actual vertical menu.** 0.4.1 took the wide three-column settings
  panel and dropped it into the drawer with a CSS rule collapsing it to one column. That is a transfer,
  not a redesign: the result was a squashed panel whose controls ran off the side.
  The drawer is now a vertical **index** — one row per setting group — and a group's controls open as a
  centered popup with room to breathe. Sub-configs (limiter, fleet-save preset, keyboard, data) open
  centered too instead of unfolding inside a drawer that has nowhere to unfold. Sections are *moved*
  into their popup rather than cloned, so every control keeps the listeners and state it was built
  with. Measured: 7 index rows stacked in one column, none overflowing the 385px drawer, no clipped
  labels, and the group popup 460px wide centered to the pixel with all its controls inside it.

### Fixed

- **The legacy settings drawer came back empty after a refresh.** `openSide` stores `currentSide =
  'settings'`, and the shell reopens whenever `currentSide` is set — but the restore path only knew how
  to redraw a pinned player, the pinned list and the tagged list, so nothing repainted the settings and
  the drawer returned as a blank column. It now restores that view too, guarded on the option: with the
  popup surface `currentSide` is never `'settings'`, and restoring it unguarded would pop the settings
  open on every page load.

## 0.4.1-v13

### Changed

- **"Legacy" now means the settings in the side panel, which is what was actually asked for.** 0.4.0
  shipped `legacyMenu`, which moved the tool's button strip into the game's colony-count box. That was
  a misreading of the request *and* broken on v13: the research was done against the old script, where
  that box sits above the planet list, but on v13 it lives in the page header — so the strip vanished
  into the header instead of appearing as a grid. The placement feature and its CSS are removed.
  In its place, `options.legacySettings` renders the settings in the side panel, the surface OGLight
  originally used, instead of the centered popup this fork switched to. The drawer brings its own close
  button and toggle-when-open behaviour, so the popup-only bookkeeping is skipped on that path, and the
  three-column layout collapses to one column for the ~385px width. Measured in the drawer: one column,
  all sections on the same left edge, nothing exceeding the panel.

### Notes

- **Correction to the 0.4.0 compliance note.** That note said per-body presets were independent of the
  `oglmode=6` auto-walk and that nothing was built on top of it. That was wrong. The walk pre-fills by
  calling `fleetSave()` on page load, and `fleetSave()` now resolves through `Util.fsFor` — so every hop
  of the walk pre-fills with *that body's own* preset. The walk did not stay as it was: it became more
  autonomous per hop, since each stop now arms a destination, mission, speed and reserve set chosen in
  advance for that specific body.
  The question for a ToolDev (AGENTS.md §3) should therefore cover the interaction, not just the chain
  in isolation: *is a one-click sequence that navigates the empire by itself and arms a per-body
  preset at each stop still acceptable, given every send remains a separate manual confirmation?*

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
