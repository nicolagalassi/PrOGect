// ==UserScript==
// @name         PrOGect DEV loader (hot reload)
// @namespace    https://github.com/nicolagalassi/PrOGect
// @version      1.0
// @description  DEV ONLY — fetches the latest PrOGect build from the local dev server on every page load and runs it. Install this ONCE; then just reload the OGame tab to run fresh code. NEVER publish or submit this loader (see AGENTS.md) — the release build is the plain PrOGect.user.js installed the normal way.
// @author        PrOGect contributors
// @match        https://*.ogame.gameforge.com/game/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_getTab
// @grant        GM_saveTab
// @grant        GM_notification
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-start
// ==/UserScript==

// This loader does one thing: pull http://127.0.0.1:7890/PrOGect.user.js fresh
// and run it, so editing the file + reloading the tab = latest code, with no
// Tampermonkey update step. The grants above mirror PrOGect's own @grants so the
// GM_* / unsafeWindow globals the code expects are visible in this scope. Because we
// use DIRECT eval() below, the fetched code inherits exactly this scope (indirect
// eval would run in global scope where the GM_* APIs are not defined).
//
// COMPLIANCE: this is developer-machine tooling only. It talks to localhost, never
// to the game server, adds no game actions, and does not auto-refresh the game (it
// runs once per real page load you trigger). It must not be part of anything
// submitted for toleration. Only the plain, readable PrOGect.user.js ships.

'use strict';

const DEV_URL = 'http://127.0.0.1:7890/PrOGect.user.js';

GM_xmlhttpRequest({
  method: 'GET',
  url: DEV_URL,
  nocache: true,
  onload(res) {
    if (res.status >= 200 && res.status < 300 && res.responseText) {
      try {
        // direct eval — inherits this function scope (GM_*, unsafeWindow available)
        eval(res.responseText);
      } catch (err) {
        console.error('[syl-loader] running PrOGect failed:', err);
      }
    } else {
      console.error('[syl-loader] dev server returned', res.status, '— is dev-server.mjs running?');
    }
  },
  onerror() {
    console.error('[syl-loader] cannot reach dev server at ' + DEV_URL + ' — start it with: node dev-server.mjs');
  },
});
