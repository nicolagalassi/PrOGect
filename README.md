# PrOGect

Full OGame v13 companion tool, forked from [OGLight](https://openuserjs.org/users/nullNaN) 5.3.3
(MIT, © 2019 Oz): planet overview, fleet helpers, expeditions, statistics, empire view (with the
Scrape tab for the scrap merchant).

> **Status: not submitted for toleration.** A tool that runs inside the OGame page must be
> reviewed and tolerated by the OGame Origin team before it is published. See [AGENTS.md](AGENTS.md) §5.

| File | What it is |
|---|---|
| `PrOGect.user.js` | the tool itself — install this one file |
| `CHANGELOG.md` | release history (versions carry a `-v13` suffix) |
| `API-NOTES.md` | what is known about the game's data layer |
| `bump-version.mjs` | version bump across both version sites in the script, with the CSS checks |
| `verify-release.mjs` | checks that GitHub serves the committed script byte for byte |
| `dev-server.mjs` | local dev server, serves the script fresh on every page load |
| `syl-loader.user.js` | DEV-ONLY loader for that server — never publish it |
| `settings-harness/` | standalone HTML harness for the settings UI |

## Release

```
node bump-version.mjs patch      # or minor / major
# add a CHANGELOG.md entry, commit, push
node verify-release.mjs
```

## Development

`node dev-server.mjs`, install `syl-loader.user.js` once, then reload the OGame tab.

The standalone OGame userscripts that used to live next to PrOGect are in
[ogame-userscripts](https://github.com/nicolagalassi/ogame-userscripts).
