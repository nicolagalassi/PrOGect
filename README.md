# PrOGect — archived

Full OGame v13 companion tool, forked from [OGLight](https://openuserjs.org/users/nullNaN) 5.3.3
(MIT, © 2019 Oz): planet overview, fleet helpers, expeditions, statistics, empire view.

**Archived — no longer developed.** It is kept here because it still runs, and because the
newer standalone scripts in the repository root reuse what it learned about the game's data
layer. `../../API-NOTES.md` documents that layer and is still current.

Everything PrOGect needs lives in this folder and keeps working from here:

| File | What it is |
|---|---|
| `PrOGect.user.js` | the tool itself — install this one file |
| `CHANGELOG.md` | its release history (versions carry a `-v13` suffix) |
| `bump-version.mjs` | version bump across both version sites in the script |
| `dev-server.mjs` | local dev server, serves the script fresh on every page load |
| `syl-loader.user.js` | DEV-ONLY loader for that server — never publish it |
| `settings-harness/` | standalone HTML harness for the settings UI |

Run the tooling from inside this folder (`node dev-server.mjs`); the paths resolve next to
the script, so nothing had to change when it was moved.
