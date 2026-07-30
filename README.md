# PrOGect

Userscript companion tool for **OGame v13** — planet overview, fleet helpers, expeditions and
statistics. Fork of [OGLight](https://openuserjs.org/users/nullNaN) 5.3.3 (MIT, © 2019 Oz), ported to
v13 and still working on v12.

> **Status: not yet submitted for toleration.** Any tool that runs inside the OGame page must be
> reviewed and tolerated by the OGame Origin team *before* being published. Until that happens this
> repository is private and the script is not distributed. See [AGENTS.md](AGENTS.md) §5.

---

## What it does

| Area | Feature |
|---|---|
| Planet list | Compact overview, per-planet timers, fleet-movement indicators, tagged planets |
| Fleet | Resource/ship limiters, fleet-save preset, expedition presets, jumpgate helper |
| Expeditions | Target value calculation with lifeform bonuses, hold-time preset |
| Statistics | Daily graph, expedition/attack split, recycled-resource ACS share |
| Messages | Spy-report table, combat-report conversion links |
| Empire | Cross-planet resource/production/building overview |

Data comes from the pages the player already opens plus OGame's own public export endpoints.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open `PrOGect.user.js` and install it.

That single file **is** the tool — nothing else in this repo is needed to run it.

## Compliance

The tool is built against the rules in [AGENTS.md](AGENTS.md), which are the OGame Origin team's
constraints for third-party tools. The load-bearing ones:

- **1 click = 1 game action.** No automation, no macros, no queued or scheduled sends.
- **No auto-refresh and no polling.** Background calls happen only on page load; every interval in
  the code is a local UI timer (clock, countdown, save-to-storage) and never talks to the server.
- **No `cp=` in background calls**, no `accountInfo` polling — it is fetched once per page load and
  filtered client-side.
- **No automatically registered alarms.** Notifications exist only for events the player opts into
  one at a time (the clock icon on a specific fleet).
- **No direct probing** attached to our own lists; new targets go through the game's galaxy view.
- **Monetization and legal content untouched** — ads, banners, footer, Merchant, Officers, Shop.
- **No fees, paywalls or injected ads.** An optional Ko-fi link, nothing more.

Known gap: the inherited base stylesheet is still minified in one `GM_addStyle` block. The
JavaScript is fully readable and commented; that CSS blob is queued for pretty-printing.

## Development

`dev-server.mjs` and `syl-loader.user.js` are **development-only** and are deliberately *not* part of
the release. The loader pulls the script from a local server on every page load so a file save plus a
tab reload is enough to run new code:

```bash
node dev-server.mjs          # serves PrOGect.user.js on http://127.0.0.1:7890
```

Then install `syl-loader.user.js` once in Tampermonkey. Neither file may be submitted for toleration
or shipped to users — only the plain `PrOGect.user.js` does.

`API-NOTES.md` documents which OGame endpoints are usable and the compliance constraint attached to
each one. `settings-harness/` holds the design tokens and a static harness used to iterate on the
settings UI without a live game session.

## Credits

- **OGLight** by Oz — the base this is forked from (MIT).
- Reference implementations consulted while porting to v13: OGLight 5.4.2 and OGame-One.

Licensed under the [MIT License](LICENSE); the original OGLight copyright notice is retained as the
licence requires.
