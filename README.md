# OGame userscripts

A small collection of userscripts for **OGame v13** (they still run on v12). Each one is a single,
self-contained file: install the file, that is the whole tool. They share no code and no settings —
you can run one, all of them, or none.

> **Status: nothing here has been submitted for toleration.** Any tool that runs inside the OGame
> page must be reviewed and tolerated by the OGame Origin team *before* being published. Until that
> happens this repository is private and none of these scripts are distributed. See
> [AGENTS.md](AGENTS.md) §5.

---

## The scripts

| Script | What it does |
|---|---|
| [`OGItemHelper.user.js`](OGItemHelper.user.js) | A searchable inventory box on the shop page: what you own, what is already active on this planet, the different durations of an item grouped under one button, and a jump to the same item on the next planet. It never activates anything — it opens the game's own item panel and you press the button. |
| [`OGSeasonTracker.user.js`](OGSeasonTracker.user.js) | A panel beside the game menu with the running season's achievements: tier ladder, progress per tier, and the prize each tier pays out shown as artwork (avatar, planet skin, title). Pin the ones you are working on. Read-only, and it disables itself on universes without a season. |
| [`OGExpeditionStats.user.js`](OGExpeditionStats.user.js) | A panel beside the game menu that turns your expedition reports into a distribution: each resource find as a percentage of its own cap (metal = cap, crystal = cap/2, deuterium = cap/3), a histogram over the 5-100% range with the rarity bands drawn in, and the most hit slice called out per band — what actually paid inside 5-25%, not just "common". Keeps a per-day history so today can be read against the days before, and compares universes on the one figure that travels between them — how much of your own cap an expedition brings back, which ignores cap size, slots and active items. Reads only reports you already have open; it makes no server call at all. |

They all read the pages you already have open; where one needs more, it is a single read you
trigger with a click, never a background loop.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open the `.user.js` file you want and install it. Repeat for each script you want.

## Compliance

Everything here is built against the rules in [AGENTS.md](AGENTS.md) — the OGame Origin team's
constraints for third-party tools. The load-bearing ones:

- **1 click = 1 game action.** No automation, no macros, no queued or scheduled sends. These scripts
  display; the game action stays yours.
- **No auto-refresh and no polling.** Background calls happen on page load or on an explicit click,
  never on a timer; every interval in the code is a local UI timer that never talks to the server.
- **No `cp=` in background calls** — nothing mutates session state behind your back.
- **No automatically registered alarms.** Nothing watches the game and notifies you.
- **No direct probing** attached to our own lists; new targets go through the game's galaxy view.
- **Monetization and legal content untouched** — ads, banners, footer, Merchant, Officers, Shop are
  never hidden, moved, resized or covered.
- **No fees, paywalls or injected ads.** Nothing leaves your machine.

[API-NOTES.md](API-NOTES.md) documents which OGame endpoints are usable and the compliance
constraint attached to each one. Read it before adding anything that touches game data.

## Archive

[`archived/progect/`](archived/progect/) holds **PrOGect**, the full companion tool this repository
started as (planet overview, fleet helpers, expeditions, statistics, empire view), forked from
[OGLight](https://openuserjs.org/users/nullNaN) 5.3.3. It is no longer developed but still runs, and
its dev tooling moved with it. See the README in that folder.

## Credits

- **OGLight** by Oz — the base PrOGect was forked from (MIT).
- Reference implementations consulted while porting to v13: OGLight 5.4.2 and OGame-One.

Licensed under the [MIT License](LICENSE); the original OGLight copyright notice is retained as the
licence requires.
