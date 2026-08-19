// ==UserScript==
// @name         Item Helper for OGame
// @namespace    https://github.com/nicolagalassi
// @version      1.0.0
// @description  A searchable inventory box on the shop page that shows what is already active on the planet, opens the game's own item panel on click, and can carry the same item to the next planet ready to activate. Standalone userscript, no dependencies.
// @author       nicolagalassi
// @match        https://*.ogame.gameforge.com/game/*
// @icon         https://gf1.geo.gfsrv.net/cdn3d/favicon.ico
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/*
  Item Helper for OGame — a small, self-contained userscript.

  THE PROBLEM IT SOLVES
  Activating an item (e.g. a +10% metal booster) on every planet is tedious: open the
  inventory, filter by broad type, scroll a wall of items with NO name search, click to
  open, activate, get bounced back to the Shop tab, then repeat on the next planet.
  This helper collapses the *finding* while leaving the *activating* where the game puts it.

  WHAT IT DOES (on the shop page)
  - Adds its OWN box inside the shop (between the image/detail area and the inventory list),
    with a compact, searchable overview: thumbnail, name, amount, percentage badge — and it
    marks the item(s) already ACTIVE on the current planet with the remaining time.
  - By default it lists only what you OWN plus what is active. A "Shop" flag also lists buyable
    shop items you do not own. The game loads inventory and shop data only for the visible tab, so
    the helper accumulates, in memory for this page load, whatever the player opens: visit Shop
    once and Inventory once and the box has both. It never switches tabs by itself (that would be
    forbidden auto-refresh, §1.3/§4). Button labels come from OGame's own `loca`, in the player's
    language.
  - The different DURATIONS of one item (7d / 30d / 90d) are grouped under a single button that
    expands to the per-duration choices, instead of one button per version.
  - The action button opens the game's OWN item panel for that item. You press the game's button —
    that is the one game action.
  - The "»" button opens the same item on the next planet, using the GAME'S OWN deep-link URL
    (#category=..&item=..&page=inventory&panel1-1=), so OGame itself opens the inventory on the
    SAME item, ready. It never presses the activate button: the activation is yours.
  - Items that carry a DEADLINE (they are lost if not used by a date) are listed like any other
    stock, with the time left, and they sort to the top: the card's button opens the copy that
    expires soonest, so the perishable one is what you are pointed at first. The script cannot use
    an item for you (§1.1) — "first" means first in the list and under the button.

  WHAT IT DOES (on the overview / "Riepilogo" page)
  - A small reminder in the empty strip of the planet banner: the items with a deadline and how long
    is left, each linking to that item in the shop. It is built ONLY from what the shop page already
    read into localStorage, so the overview costs no request of its own; it shows nothing when there
    is nothing expiring, and a flag (in the shop box header, or the × on the reminder) turns it off.
  - Where it sits is MEASURED, not assumed: the bar of active items across the bottom of the banner,
    the moon/planet thumbnail above it and the planet data beside it are read off the live layout,
    and the notice takes what is left — up to six items over two lines, at least four, the rest
    counted. When even that does not fit it goes below the banner instead, so it never sits on top
    of the game's own bar.

  COMPLIANCE (OGame Origin tool rules — see AGENTS.md):
  - §1.1  1 click = 1 action. The helper never activates anything itself; it only opens the
          game's native item panel. The activation is the player's click on the game's button.
  - §1.3/§4  No auto-refresh, no polling, no timers hitting the server. It reads data already
          in the page (the game's inventoryObj / the inventory DOM); a DOM-only MutationObserver
          keeps the box present as the shop rebuilds itself. The one background call is the optional
          "Scan account" button: a SINGLE accountInfo read, only on the player's explicit click,
          never on a timer/loop (§4.1 — read once, never poll), token propagated.
  - §4.2  No background cp calls. Planet switching is a real <a> navigation the player clicks.
  - §6    We call NO activation endpoint or game function ourselves — we forward to the game's
          own item tile / panel.
  - §1.4  The expiry reminder is not an alarm: nothing is registered, scheduled or pushed. It is a
          static notice drawn when the player opens the overview themselves, from data their own
          session already produced — and it can be switched off.
  - §1.7  Our box is added in normal flow; it never hides, resizes, moves or covers the shop
          image, ads or Shop menu. The overview reminder sits in the empty part of the planet
          banner: it covers no game element, and the player can dismiss it.
  - §3    Comfort feature touching the shop UI/flow → GRAY AREA: get a ToolDev sign-off first.
  - §5    Runs inside the OGame page → needs toleration before public distribution.
*/

(function()
{
    'use strict';

    const HREF = window.location.href;
    // The box lives in the shop; the expiry reminder lives on the overview ("Riepilogo"). Anything
    // else is none of our business and the script stops right here.
    const IS_SHOP = HREF.indexOf('component=shop') >= 0 || HREF.indexOf('page=shop') >= 0;
    const IS_OVERVIEW = HREF.indexOf('component=overview') >= 0 || HREF.indexOf('page=overview') >= 0;
    if(!IS_SHOP && !IS_OVERVIEW) return;

    const PAGE = window; // @grant none → shares the page window, so inventoryObj is readable.

    // Item carried over from a "Pianeta succ." click. We navigate with the GAME'S OWN deep-link
    // hash (#category=..&item=..&page=inventory&panel1-1=), so on arrival the game itself opens
    // the inventory on that item. We read the item back from that hash (or the sessionStorage
    // stash / legacy query) only to focus OUR box on it.
    const hashParams = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    const carry =
    {
        uuid: hashParams.get('item') || new URLSearchParams(HREF.split('?')[1] || '').get('pgItem') || sessionStorage.getItem('oih_pending') || '',
        name: sessionStorage.getItem('oih_pendingName') || '',
    };
    function clearCarry()
    {
        sessionStorage.removeItem('oih_pending');
        sessionStorage.removeItem('oih_pendingName');
    }

    // The inventory "all" category id, needed for the game's deep-link. It is the category shared
    // by every owned item; we derive it from whatever category lists we have (the live items, or
    // the ones stored with the cached records on a page where the game exposes nothing).
    const ALL_CATEGORY = 'd8d49c315fa620d9c7f1f19963970dea59a0e3be';
    function commonCategory(catArrays)
    {
        const arrs = (catArrays || []).filter(a => a && a.length);
        if(!arrs.length) return ALL_CATEGORY;
        let common = arrs[0].slice();
        arrs.forEach(a => { common = common.filter(c => a.indexOf(c) >= 0); });
        // With a single item every one of ITS categories is "common", so prefer the known "all"
        // id when the item carries it — that is the one the game's own inventory link uses.
        if(common.indexOf(ALL_CATEGORY) >= 0) return ALL_CATEGORY;
        return common[0] || ALL_CATEGORY;
    }
    function inventoryAllCategory()
    {
        return commonCategory(((PAGE.inventoryObj || {}).items_inventory || []).map(it => it.category || []));
    }

    // --------------------------------------------------------------------- styles
    const CSS = `
        .oih_box{margin:6px 8px 10px;padding:8px;border:1px solid #3a4756;border-radius:4px;background:linear-gradient(192deg,rgba(37,46,58,.6),rgba(20,25,32,.6));box-sizing:border-box}
        .oih_head{display:flex;align-items:center;gap:8px;margin-bottom:7px}
        .oih_title{font-size:12px;color:#f0a955;font-weight:bold;white-space:nowrap;display:flex;align-items:center;gap:4px}
        .oih_head input[type=text]{flex:1;min-width:60px;padding:4px 8px;border-radius:3px;border:1px solid #3a4756;background:#0e131a !important;color:#fff !important;-webkit-text-fill-color:#fff;caret-color:#fff;font-size:12px}
        .oih_head input[type=text]:focus{outline:none;border-color:#ffb800;background:#0e131a !important;color:#fff !important;-webkit-text-fill-color:#fff}
        .oih_flag{font-size:11px;color:#9ec7ff;white-space:nowrap;display:inline-flex;align-items:center;gap:3px;cursor:pointer;user-select:none}
        .oih_flag input{cursor:pointer;margin:0}
        .oih_scan{cursor:pointer;color:#9ec7ff;font-size:14px;line-height:1;padding:2px 4px;user-select:none;border:1px solid #3a4756;border-radius:3px}
        .oih_scan:hover{border-color:#ffb800;color:#ffb800}
        .oih_scan.oih_busy{animation:oih_spin .8s linear infinite;color:#ffb800;pointer-events:none}
        @keyframes oih_spin{to{transform:rotate(360deg)}}
        .oih_count{font-size:11px;color:#7c8b99;white-space:nowrap}
        .oih_collapse{cursor:pointer;color:#9aa7b4;font-size:14px;line-height:1;padding:2px 4px;user-select:none}
        .oih_collapse:hover{color:#ffb800}
        .oih_grid{max-height:250px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px;padding-right:2px}
        .oih_grid.oih_hidden{display:none}
        .oih_card{position:relative;display:flex;gap:8px;align-items:center;padding:6px;border-radius:3px;background:rgba(14,19,26,.75);border:1px solid #2b3542}
        .oih_card:hover{border-color:#4a5a6c}
        .oih_card.oih_on{border-color:#3f8f5f;background:rgba(20,34,26,.8)}
        .oih_card.oih_buy{border-color:#3f5a80;background:rgba(18,24,34,.8)}
        .oih_shopTag{color:#7fa8e0}
        .oih_thumb{width:42px;height:42px;flex:0 0 auto;border-radius:3px;background-size:cover;background-position:center;background-repeat:no-repeat;background-color:#0b0f14;border:1px solid #333c47}
        /* Rarity = tier colour on the thumbnail: bronze / silver / gold / platinum→purple */
        .oih_thumb[class*="oih_r_"]{border-width:2px}
        .oih_r_common{border-color:#c87f3a}.oih_r_uncommon{border-color:#c3ccd4}.oih_r_rare{border-color:#e6be23}.oih_r_epic{border-color:#a05bd0}
        .oih_info{flex:1 1 auto;min-width:0}
        .oih_name{font-size:11px;color:#e6ecf2;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
        .oih_meta{font-size:10px;color:#8aa0b2;display:flex;gap:6px;margin-top:2px;flex-wrap:wrap}
        /* Owned quantity as a boxed chip, so it never reads as part of the percentage next to it */
        .oih_amount{color:#ffb800;background:rgba(255,184,0,.1);border:1px solid rgba(255,184,0,.35);border-radius:3px;padding:0 4px;line-height:14px;font-weight:bold}
        .oih_pct{color:#7fd6a0}
        .oih_live{color:#59c98a;display:inline-flex;align-items:center;gap:3px}
        .oih_live::before{content:"";width:6px;height:6px;border-radius:50%;background:#59c98a}
        .oih_actions{display:flex;flex-direction:column;gap:3px;flex:0 0 auto}
        .oih_btn{cursor:pointer;font-size:10px;padding:3px 7px;border-radius:3px;border:1px solid #3a4756;background:linear-gradient(192deg,#2b3542,#1a2029);color:#fff;text-align:center;text-decoration:none;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center}
        .oih_btn:hover{border-color:#ffb800}
        .oih_btn.oih_activate{color:#bfeecf}
        .oih_caret{padding-left:5px;opacity:.75}
        .oih_btn.oih_extend{color:#ffd78a}
        .oih_btn.oih_compra{color:#9ec7ff}
        .oih_btn.oih_next{color:#9ec7ff}
        .oih_hint{font-size:10px;color:#9ec7ff;margin:-2px 0 6px;display:flex;gap:5px;align-items:center;cursor:default}
        .oih_hint.oih_hidden{display:none}
        .oih_hint .oih_pill{background:rgba(63,90,128,.35);border:1px solid #3f5a80;border-radius:10px;padding:0 7px;line-height:16px}
        .oih_sub{position:absolute;inset:0;z-index:5;display:flex;flex-direction:row;gap:6px;align-items:center;justify-content:center;padding:4px 6px;border-radius:3px;background:rgba(10,14,20,.45);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);cursor:pointer}
        .oih_sub.oih_hidden{display:none}
        .oih_dur{min-width:40px;padding:6px 8px;font-size:12px;font-weight:bold}
        .oih_empty{color:#8aa0b2;font-size:12px;padding:14px;text-align:center;grid-column:1/-1}
        /* A deadline reads as a warning, and turns red in the last day */
        .oih_exp{color:#ffb14e;font-weight:bold}
        .oih_exp.oih_soon{color:#ff8b7a}
        .oih_card.oih_perish{border-color:#8a6323}
        .oih_dur.oih_perish{border-color:#8a6323;color:#ffb14e}
        /* Overview reminder: sits in the empty corner of the planet banner, covers nothing */
        .oih_rem{position:absolute;left:10px;bottom:10px;z-index:2;display:flex;align-items:center;gap:4px;padding:2px 4px;border:1px solid #5a4a24;border-radius:4px;background:rgba(12,16,22,.85);box-shadow:0 2px 8px rgba(0,0,0,.45);font-family:Verdana,Arial,sans-serif;box-sizing:border-box;white-space:nowrap;overflow:hidden}
        /* When the banner leaves no free strip, the notice goes under it in normal flow instead */
        .oih_rem.oih_remFlow{position:static;margin:4px 0 6px;max-width:none;width:-moz-fit-content;width:fit-content}
        .oih_remTitle{font-size:11px;color:#ffb14e;flex:0 0 auto}
        .oih_remRow{display:flex;flex-wrap:wrap;gap:3px;min-width:0}
        .oih_remOff{cursor:pointer;color:#8aa0b2;padding:0 2px;line-height:1;font-size:12px;flex:0 0 auto}
        .oih_remOff:hover{color:#ffb800}
        .oih_remItem{display:flex;align-items:center;gap:4px;padding:1px 5px 1px 1px;border:1px solid #3a4756;border-radius:3px;background:rgba(20,26,34,.85);text-decoration:none;flex:0 0 auto}
        .oih_remItem:hover{border-color:#ffb800}
        .oih_remImg{width:20px;height:20px;border-radius:2px;background-size:cover;background-position:center;background-color:#0b0f14;display:block;flex:0 0 auto}
        .oih_remTime{font-size:10px;color:#ffd78a;white-space:nowrap}
        .oih_remItem.oih_soon .oih_remTime{color:#ff8b7a}
        .oih_remMore{font-size:10px;color:#8aa0b2;align-self:center}
    `;
    function injectStyle()
    {
        if(document.getElementById('oih_style')) return;
        const s = document.createElement('style');
        s.id = 'oih_style';
        s.textContent = CSS;
        (document.head || document.documentElement).appendChild(s);
    }

    // --------------------------------------------------------------------- helpers
    const el = (tag, cls, parent, html) =>
    {
        const n = document.createElement(tag);
        if(cls) n.className = cls;
        if(html != null) n.innerHTML = html;
        if(parent) parent.appendChild(n);
        return n;
    };
    const stripTags = s =>
    {
        if(!s) return '';
        const t = document.createElement('div');
        t.innerHTML = s;
        return (t.textContent || '').replace(/\s+/g, ' ').trim();
    };
    const fmtDur = sec =>
    {
        sec = Math.max(0, Math.floor(sec || 0));
        const d = Math.floor(sec / 86400); sec -= d * 86400;
        const h = Math.floor(sec / 3600); sec -= h * 3600;
        const m = Math.floor(sec / 60);
        const p = [];
        if(d) p.push(d + 'd');
        if(h) p.push(h + 'h');
        if(m && !d) p.push(m + 'm');
        return p.join(' ') || '<1m';
    };

    // ---- Deadlines ---------------------------------------------------------------------------
    // Some items are only yours until a date (event/reward stock): after it they are gone, used or
    // not. The game states that date on the item, but not always in the same shape, and the field
    // has been seen under more than one name — so we accept any of them, in seconds, milliseconds
    // or as a date string, and take the first that reads as a plausible moment in time.
    const EXPIRY_KEYS = ['expiryDate', 'expiryTime', 'expiresAt', 'expireDate', 'expiration', 'validUntil', 'endDate'];
    function toEpochMs(v)
    {
        if(v === null || v === undefined || v === '' || v === false || v === 0) return 0;
        if(typeof v === 'object') return toEpochMs(v.date || v.timestamp || v.value || 0);
        let ms = 0;
        if(typeof v === 'number' || /^\d+$/.test(String(v).trim()))
        {
            const n = +v;
            ms = n < 1e11 ? n * 1000 : n; // epoch seconds vs milliseconds
        }
        else
        {
            const t = Date.parse(String(v).trim().replace(' ', 'T'));
            if(isFinite(t)) ms = t;
        }
        // Sanity window: anything outside it is some other number that happens to sit in the field.
        const now = Date.now();
        return (ms > now - 2 * 365 * 86400000 && ms < now + 10 * 365 * 86400000) ? ms : 0;
    }
    function expiryOf(it)
    {
        for(let i = 0; i < EXPIRY_KEYS.length; i++)
        {
            const ms = toEpochMs(it[EXPIRY_KEYS[i]]);
            if(ms) return ms;
        }
        return 0;
    }
    // The same deadline as the game renders it on a tile: an absolute datetime attribute when the
    // markup carries one, otherwise the countdown text ("2g 4h 30m") turned back into a moment.
    // Number + first letter of the unit, so it survives the language the player is in.
    function countdownToMs(timeEl, text)
    {
        const attr = timeEl && (timeEl.getAttribute('datetime') || timeEl.getAttribute('data-end') || timeEl.getAttribute('data-endtime'));
        if(attr)
        {
            const ms = toEpochMs(attr);
            if(ms) return ms;
        }
        let secs = 0, m;
        const re = /(\d+)\s*([a-zA-Z])/g;
        while((m = re.exec(text || '')))
        {
            const n = +m[1], u = m[2].toLowerCase();
            if('dgjt'.indexOf(u) >= 0) secs += n * 86400;      // day / giorno / jour / Tag
            else if('hou'.indexOf(u) >= 0) secs += n * 3600;   // hour / ora / uur
            else if(u === 'm') secs += n * 60;
            else if(u === 's') secs += n;
        }
        return secs ? Date.now() + secs * 1000 : 0;
    }
    const expiresIn = r => Math.floor(((r && r.expiresAt || 0) - Date.now()) / 1000);

    // Localization — read OGame's own strings from the page's `loca` so the buttons/labels match
    // the player's language automatically. Fallbacks keep it working if a key is missing.
    const loca = () => PAGE.loca || {};
    const L = (key, fb) => { const v = loca()[key]; return (typeof v === 'string' && v) ? stripTags(v) : fb; };
    function locaBuy()
    {
        const lo = loca();
        if(lo.buy) return stripTags(lo.buy);
        const ba = lo.buyAndActivate || lo.buyAndExtend; // e.g. "Compra & Attiva" → take the first word
        if(ba) { const first = stripTags(ba).split(/&|\+/)[0].trim(); if(first) return first; }
        return 'Buy';
    }

    // The two shop sections read as ONE. OGame only populates the inventory data
    // (items_inventory / inventory slider) or the shop data (items_shop / shop slider) for the
    // tab currently rendered — never both at once. We do NOT auto-load them (that would be
    // auto-refresh/polling, forbidden by §1.3/§4). Instead we accumulate, in memory for this page
    // load, whatever the game shows as the PLAYER navigates the tabs themselves: open Shop once,
    // then Inventory once, and the box has the full picture. Pure DOM reads — no background calls.
    const mem = { inv: {}, shop: {} };

    // Persistent memory of what we have SEEN, so the box stays complete without re-asking every
    // page. Items belong to the ACCOUNT, so both the inventory stock and the shop are cached
    // GLOBALLY (not per planet). The one thing that IS planet-specific — which item is currently
    // ACTIVE — is never cached: it is stripped when saving and only ever taken from the live data
    // of the planet you are on. Kept for 24h; live data always wins; visiting a tab refreshes it.
    const CACHE_TTL = 86400000; // 24h
    const cacheKey = kind => kind === 'shop' ? 'oih_cache_shop' : 'oih_cache_inv';
    // keepAt: this write only corrects what we already had (no fresh read of that section), so the
    // original timestamp stands — otherwise the 24h life would keep renewing itself and the box
    // would stop asking for the section to be opened again.
    function saveCache(kind, map, keepAt)
    {
        // Active/timeLeft are planet-specific — don't persist them in the account-wide inventory.
        // timeText goes too: it is a countdown as it read at that moment, and stale text would be
        // shown as if it were current. A deadline (expiresAt) is absolute, so that one keeps.
        const items = Object.values(map).map(r => Object.assign({}, r, { active: false, timeLeft: 0, timeText: '' }));
        const at = (keepAt && (loadCache(kind) || {}).at) || Date.now();
        try { localStorage.setItem(cacheKey(kind), JSON.stringify({ at, items })); } catch(e) {}
    }
    function loadCache(kind)
    {
        try { const o = JSON.parse(localStorage.getItem(cacheKey(kind)) || 'null'); if(o && (Date.now() - o.at) < CACHE_TTL) return o; } catch(e) {}
        return null;
    }
    // Seed memory from a fresh (<24h) cache. The cache carries no active state (that is per planet
    // and comes only from live data), so seeded items start inactive until the live tab confirms.
    function seedFromCache()
    {
        [['inv', mem.inv], ['shop', mem.shop]].forEach(([kind, target]) =>
        {
            const o = loadCache(kind);
            if(!o) return;
            o.items.forEach(r =>
            {
                if(!r || !r.uuid) return;
                target[r.uuid] = Object.assign({}, r, { active: false, timeLeft: 0 });
            });
        });
    }

    // ---- Perishable stock: what the overview reminder is built from ---------------------------
    // Kept apart from the 24h item cache on purpose. A deadline is an absolute date: unlike an
    // amount it does not go stale, and the reminder has to survive a few days without opening the
    // shop — which is exactly when it is worth having. Entries drop out on their own once the
    // deadline passes, and the list is rewritten from every FULL inventory read, so an item that
    // has been used up leaves this store at the same moment it leaves the inventory.
    const EXP_KEY = 'oih_expiring';
    // The reminder is opt-out and the choice sticks (localStorage, not just this tab).
    const REM_OFF_KEY = 'oih_reminder_off';
    const reminderOn = () => { try { return localStorage.getItem(REM_OFF_KEY) !== '1'; } catch(e) { return true; } };
    function saveExpiring(map)
    {
        const now = Date.now();
        const items = Object.values(map)
            .filter(r => r && r.uuid && r.expiresAt > now && r.amount > 0)
            .map(r => ({ uuid: r.uuid, name: r.name, image: r.image, amount: r.amount, expiresAt: r.expiresAt, cats: r.cats || [] }))
            .sort((a, b) => a.expiresAt - b.expiresAt);
        try { localStorage.setItem(EXP_KEY, JSON.stringify({ at: now, items })); } catch(e) {}
    }
    function loadExpiring()
    {
        try
        {
            const o = JSON.parse(localStorage.getItem(EXP_KEY) || 'null');
            if(!o || !Array.isArray(o.items)) return null;
            const now = Date.now();
            o.items = o.items.filter(r => r && r.uuid && r.expiresAt > now).sort((a, b) => a.expiresAt - b.expiresAt);
            return o;
        }
        catch(e) { return null; }
    }

    // ---- Account scan: active items across ALL planets, from ONE accountInfo read -------------
    // accountInfo returns the whole account in a single response, so a single user-triggered read
    // gives the active items on every planet — no per-planet spamming. COMPLIANCE §4.1: read ONCE,
    // never poll; here it fires only on the player's explicit click of the "Scan" button. The
    // rotated ajax token is propagated so we do not desync the game's own requests.
    function currentPlanetId()
    {
        const line = document.querySelector('.smallplanet.hightlightPlanet, .smallplanet.hightlightMoon');
        const link = line && (line.querySelector('.planetlink') || line.querySelector('a[href*="cp="]'));
        const fromLink = link && new URLSearchParams((link.getAttribute('href') || '').split('?')[1] || '').get('cp');
        const fromUrl = new URLSearchParams(HREF.split('?')[1] || '').get('cp');
        return String(fromLink || fromUrl || '0').split('#')[0];
    }
    function loadActive()
    {
        try { const o = JSON.parse(localStorage.getItem('oih_active_all') || 'null'); if(o && (Date.now() - o.at) < CACHE_TTL) return o; } catch(e) {}
        return null;
    }
    // Per-planet active items from accountInfo. Each planet/moon body carries a `buffs` array;
    // a buff is identified by its NAME (the same localized name our items use) plus start/end
    // epoch fields (unit auto-detected s vs ms). We keep name + end time; matching to our items is
    // by name (buffs have no item ref). endsAt 0 = active but permanent / no reliable end.
    function buffEndMs(b)
    {
        let end = Math.max(+((b && b.effectEnd) || 0), +((b && b.buffEnd) || 0));
        if(end > 1e12) end = Math.floor(end / 1000); // ms → s
        const nowS = Math.floor(Date.now() / 1000);
        if(!(end > nowS && end < nowS + 3 * 365 * 86400)) return 0; // permanent / expired / unknown
        return end * 1000;
    }
    function extractActive(json)
    {
        const byPlanet = {};
        const bodies = Object.assign({}, json.planets || {}, json.moons || {});
        Object.entries(bodies).forEach(([id, body]) =>
        {
            if(!body || !Array.isArray(body.buffs) || !body.buffs.length) return;
            const arr = [];
            body.buffs.forEach(b =>
            {
                const name = String((b && b.name) || '').split('|')[0].trim();
                const endsAt = buffEndMs(b);
                // Only TIMED buffs count as "active". Permanent items (e.g. planet/fleet slots)
                // have no real end time (endsAt 0) and must not be shown as active.
                if(name && endsAt > 0) arr.push({ name: name.toLowerCase(), endsAt });
            });
            if(arr.length) byPlanet[id] = arr;
        });
        return byPlanet;
    }
    async function scanAccount(btn)
    {
        const busy = btn && btn.classList.contains('oih_busy');
        if(busy) return;
        if(btn) btn.classList.add('oih_busy');
        try
        {
            const url = `https://${window.location.host}/game/index.php?page=componentOnly&component=externaldataexport&action=accountInfo&asJson=1`;
            const res = await fetch(url, { credentials: 'include', cache: 'no-cache', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
            const json = await res.json();
            if(json.newAjaxToken && typeof PAGE.setNewTokenData === 'function') { try { PAGE.setNewTokenData(json.newAjaxToken); } catch(e) {} }

            // Structure probe — helps us confirm where the item/buff data lives.
            console.log('[OGItemHelper] accountInfo keys:', Object.keys(json));
            const firstBody = Object.values(json.planets || {})[0];
            if(firstBody) console.log('[OGItemHelper] planet body keys:', Object.keys(firstBody));

            const byPlanet = extractActive(json);
            console.log('[OGItemHelper] active items found on', Object.keys(byPlanet).length, 'bodies:', byPlanet);
            localStorage.setItem('oih_active_all', JSON.stringify({ at: Date.now(), byPlanet }));
            if(rerender) rerender();
        }
        catch(e) { console.error('[OGItemHelper] account scan failed:', e); }
        finally { if(btn) btn.classList.remove('oih_busy'); }
    }
    // Overlay the scanned active state for the CURRENT planet onto the item map, matched by NAME
    // (buffs carry no item ref). Applies regardless of tab or the Shop flag, so active items are
    // correctly flagged everywhere once the account has been scanned.
    function applyScannedActive(map)
    {
        const store = loadActive();
        if(!store) return;
        const list = store.byPlanet[currentPlanetId()] || [];
        if(!list.length) return;
        const byName = {};
        list.forEach(a => { byName[a.name] = a; });
        const now = Date.now();
        Object.values(map).forEach(rec =>
        {
            const a = byName[(rec.name || '').toLowerCase()];
            if(!a) return;
            if(a.endsAt && a.endsAt <= now) return; // the scan can be hours old — a buff that has since run out is not active
            rec.active = true;
            if(a.endsAt) { const tl = Math.floor((a.endsAt - now) / 1000); if(tl > 0) rec.timeLeft = tl; }
        });
    }

    // Merge a record into a target map: OR the boolean flags, keep the first meaningful scalar
    // (so a shop copy's amount:0 never overwrites the inventory's real amount).
    function upsertInto(target, d)
    {
        if(!d || !d.uuid) return;
        const e = target[d.uuid] || (target[d.uuid] = { uuid: d.uuid });
        for(const k in d)
        {
            const v = d[k];
            if(v === undefined || v === null || v === '') continue;
            if(k === 'owned' || k === 'active' || k === 'buyable') e[k] = e[k] || v;
            else if(e[k] === undefined || e[k] === '' || e[k] === 0) e[k] = v;
        }
    }

    function fromJs(it)
    {
        if(!it || !it.ref) return null;
        if(it.isAvatar) return null; // never list avatars
        const amount = it.amount || 0;
        const dated = expiryOf(it);
        // A dated entry with NO stack behind it is a one-shot already running, not something you
        // can use again — same rule the DOM tiles follow (a countdown with no amount badge). A
        // dated entry that DOES have a stack is perishable stock, and that is worth showing.
        if(dated && !amount) return null;
        // A date already gone is not a deadline any more: there is nothing left to beat and the
        // item is on its way out of the inventory, so it is listed as ordinary stock instead of
        // being advertised as expiring in "<1m" forever.
        const expiresAt = dated > Date.now() ? dated : 0;
        // Only a TIMED buff counts as active. Permanent items (planet/fleet slots) sit at
        // status 'effecting' forever with no timeLeft, and must not show as active.
        const active = it.timeLeft > 0;
        const hash = it.imageLarge || it.image || '';
        return {
            uuid: it.ref,
            name: (it.name || 'Item').trim(),
            amount,
            image: hash ? `/cdn/img/item-images/${hash}.png` : '',
            effect: stripTags(it.effect || ''),
            rarity: (it.rarity || '').toLowerCase(),
            active,
            timeLeft: active ? (it.timeLeft || 0) : 0,
            duration: it.duration || 0,
            extendable: !!it.extendable,
            buyable: !!it.buyable,
            owned: amount > 0,
            expiresAt,
            cats: Array.isArray(it.category) ? it.category.slice() : [],   // for the shop deep-link
        };
    }

    // Read whatever the game currently exposes (the visible tab) and let it OVERRIDE the cache for
    // those refs (live is authoritative/fresh); refs only in cache stay.
    //
    // Merging alone is not enough: an item that has been USED UP no longer appears anywhere in the
    // live data, so a merge-only pass left the cached copy standing and the box kept offering an
    // item that is gone (for up to 24h). So a read of the inventory is treated as REPLACING it, not
    // adding to it: refs the game no longer lists are dropped. Only the game's own
    // `items_inventory` array can decide that — it is the complete list of what the account owns,
    // whereas the DOM slider renders one slide at a time and would look like a much smaller
    // inventory. Persist the result, so the cache is corrected too and not just this page's memory.
    function ingestLive()
    {
        const obj = PAGE.inventoryObj || {};
        // Refs the game marks as avatars — excluded from DOM tiles too, and purged from memory/cache.
        const avatars = new Set();
        [...(obj.items_inventory || []), ...(obj.items_shop || [])].forEach(it => { if(it && it.ref && it.isAvatar) avatars.add(it.ref); });

        // Present (non-empty) only on the tab the game currently renders — that is the read we can
        // prune against; on the Shop tab it is empty and the inventory keeps whatever it had.
        const jsInv = Array.isArray(obj.items_inventory) ? obj.items_inventory : [];
        const fullInvRead = jsInv.length > 0;

        const liveInv = {}, liveShop = {};
        jsInv.forEach(it => { const r = fromJs(it); if(r) upsertInto(liveInv, r); });
        scrapeSlider('#js_inventorySlider', false).forEach(r => { if(!avatars.has(r.uuid)) upsertInto(liveInv, r); });
        (obj.items_shop || []).forEach(it => { const r = fromJs(it); if(r) upsertInto(liveShop, r); });
        scrapeSlider('#js_shopSliderBox', true).forEach(r => { if(!avatars.has(r.uuid)) upsertInto(liveShop, r); });

        avatars.forEach(ref => { delete mem.inv[ref]; delete mem.shop[ref]; }); // drop any previously cached avatar

        if(fullInvRead)
        {
            // Used up, expired, or now running as a one-shot → not stock any more.
            Object.keys(mem.inv).forEach(ref => { if(!liveInv[ref]) delete mem.inv[ref]; });
            // The shop copy of the same item carries the owned amount too, and collectItems ORs the
            // flags together — so the shop side is realigned on the same truth, or the stock we
            // just dropped comes straight back from there.
            Object.values(mem.shop).forEach(r =>
            {
                const n = liveInv[r.uuid] ? (+liveInv[r.uuid].amount || 0) : 0;
                r.amount = n;
                r.owned = n > 0;
            });
        }

        Object.entries(liveInv).forEach(([k, v]) => { mem.inv[k] = v; });
        Object.entries(liveShop).forEach(([k, v]) => { mem.shop[k] = v; });

        // The same full read that decides what we own decides what is perishable.
        if(fullInvRead) saveExpiring(mem.inv);

        const shopRead = Object.keys(liveShop).length > 0;
        if(fullInvRead || Object.keys(liveInv).length) saveCache('inv', mem.inv); // the inventory as it really is now
        if(fullInvRead || shopRead) saveCache('shop', mem.shop, !shopRead);       // shop, incl. the realigned amounts
    }

    function getNextPlanet()
    {
        const planets = [];
        document.querySelectorAll('.smallplanet').forEach(line =>
        {
            const link = line.querySelector('.planetlink') || line.querySelector('a[href*="cp="]');
            if(!link) return;
            const id = new URLSearchParams((link.getAttribute('href') || '').split('?')[1] || '').get('cp');
            if(!id) return;
            const k = line.querySelector('.planet-koords, [class*="koords"], [class*="coords"]');
            planets.push({ id: id.split('#')[0], coords: k ? k.textContent.replace(/[\[\]]/g, '').trim() : '', isCurrent: line.classList.contains('hightlightPlanet') || line.classList.contains('hightlightMoon') });
        });
        if(planets.length < 2) return null;
        const i = planets.findIndex(p => p.isCurrent);
        return planets[(i + 1) % planets.length];
    }

    // The union of everything we have accumulated in memory this page load (inventory + shop),
    // with the scanned active state for the current planet overlaid on top.
    function collectItems()
    {
        const map = {};
        Object.values(mem.inv).forEach(r => upsertInto(map, r));
        Object.values(mem.shop).forEach(r => upsertInto(map, r));
        applyScannedActive(map);
        return Object.values(map).filter(e => e.name);
    }

    // A compact "+7d / +30d / +90d" label for one duration variant. The item names are long, so we
    // trim to just the days: from the duration seconds when known, else parsed from the name/tooltip
    // (day or week words, language-agnostic).
    function durLabel(it)
    {
        let days = it.duration > 0 ? Math.round(it.duration / 86400) : 0;
        if(!days)
        {
            const dm = (it.name || '').match(/(\d+)\s*(giorn|day|tag|jour|d[ií]a|dní|dni|gün|dag)/i);
            if(dm) days = +dm[1];
        }
        if(!days)
        {
            const wm = (it.name || '').match(/(\d+)\s*(settiman|week|woche|semaine|semana|hafta|tyzd|týžd)/i);
            if(wm) days = +wm[1] * 7;
        }
        return days ? '+' + days + 'd' : '';
    }

    // Read the tiles of one slider. isShop tags them buyable; inventory tiles are owned.
    function scrapeSlider(sel, isShop)
    {
        const out = [];
        const scope = document.querySelector(sel);
        if(!scope) return out;
        const seen = {};
        scope.querySelectorAll('a.detail_button[ref]').forEach(a =>
        {
            const uuid = a.getAttribute('ref');
            if(!uuid || uuid === 'ffffffffffffffffffffffffffffffffffffffff' || seen[uuid]) return;
            const box = a.closest('.item_img');
            // Skip running one-shot instances (they show a countdown and carry no stack amount),
            // to match the items_inventory handling.
            if(box && box.querySelector('.countdownHolder') && !box.querySelector('.ecke .amount')) return;
            seen[uuid] = 1;
            const parts = (a.getAttribute('data-tooltip-title') || '').split('|');
            const name = stripTags(parts[0] || 'Item');
            const effect = stripTags((parts[1] || '').split('<br')[0]);
            const amount = +(a.querySelector('.ecke .amount, .amount')?.textContent || '').replace(/[^\d]/g, '') || 0;
            let image = '', rarity = '';
            if(box)
            {
                const m = getComputedStyle(box).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
                if(m) image = m[1];
                const rc = [...box.classList].find(c => c.indexOf('r_') === 0);
                if(rc) rarity = rc.slice(2);
            }
            const timeEl = (box && box.querySelector('.countdownHolder time')) || null;
            const timeText = (timeEl && timeEl.textContent) || '';
            // Same rule as the JS path: active only when the tile actually shows a countdown,
            // so permanent items are never flagged as active.
            const active = !!(box && box.querySelector('.activation.js_is_active')) && !!timeText;
            // A countdown on a tile that is NOT running is the stock's own deadline (only ahead of
            // us: a countdown that has run out says nothing about what is still usable).
            const ends = active || isShop ? 0 : countdownToMs(timeEl, timeText);
            const expiresAt = ends > Date.now() ? ends : 0;
            // Duration hint from the tooltip / name (e.g. "7 giorni", "30 days") — language-agnostic
            // number + a day word; falls back to 0 when not present.
            const dm = (a.getAttribute('data-tooltip-title') || name).match(/(\d+)\s*(giorni|day|days|tag|tage|jour|jours|d[ií]as?|dni|dní|gün|dagen)/i);
            const duration = dm ? +dm[1] * 86400 : 0;
            out.push({ uuid, name, amount, image, effect, rarity, active, timeText, expiresAt, duration, extendable: false, buyable: isShop, owned: isShop ? amount > 0 : true });
        });
        return out;
    }

    // Open the game's OWN item panel. We never activate/buy anything ourselves (§1.1/§6) — the
    // panel is where the game's Attiva / Prolunga / Compra buttons live and the player clicks.
    // If the item's tile is in the current DOM we click it (fast, no reload); otherwise — e.g. a
    // 30d/90d version not on the rendered slide — we use OGame's OWN deep-link hash, which the
    // game's router resolves to that item regardless of category/pagination.
    function openNativeItem(uuid, fromShop)
    {
        // A variant can live in either section (you may own the 7d but not the 30d/90d), so we look
        // for the tile anywhere, not only in the preferred slider — searching just one section was
        // why duration links did nothing for items flagged active.
        const findTile = () => document.querySelector(`a.detail_button[ref="${uuid}"]`);
        const wanted = fromShop ? '.tabSelectionTab.shopTab' : '.tabSelectionTab.inventoryTab';
        const other = fromShop ? '.tabSelectionTab.inventoryTab' : '.tabSelectionTab.shopTab';

        const t0 = findTile();
        if(t0) { t0.click(); return; }

        // Not rendered → switch to the preferred tab and WAIT for the game to render it (the
        // deep-link hash only opens an item on a fresh page load, not on the same page). If it
        // still has not appeared, try the other tab. Event-driven, hard-capped, no server polling.
        const tab = document.querySelector(wanted);
        if(tab && !tab.classList.contains('active')) tab.click();

        let done = false;
        const tryClick = () => { if(done) return true; const t = findTile(); if(t) { done = true; t.click(); return true; } return false; };
        const obs = new MutationObserver(() => { if(tryClick()) obs.disconnect(); });
        obs.observe(document.querySelector('#buttonz') || document.body, { childList: true, subtree: true });
        setTimeout(() =>
        {
            if(done) return;
            const alt = document.querySelector(other);   // fall back to the other section
            if(alt && !alt.classList.contains('active')) alt.click();
        }, 1200);
        setTimeout(() => obs.disconnect(), 6000); // local cleanup only, never a server call
    }

    // --------------------------------------------------------------------- UI
    function build()
    {
        if(document.querySelector('.oih_box')) return true;

        // Insert our own box in normal flow, between the shop image/detail area and the
        // inventory list (#buttonz). Fallbacks keep it inside the shop container.
        const buttonz = document.querySelector('#buttonz');
        const planet = document.querySelector('#planet');
        const inhalt = document.querySelector('#inhalt');
        let insertBefore = null, parent = null;
        if(buttonz && buttonz.parentNode) { parent = buttonz.parentNode; insertBefore = buttonz; }
        else if(planet && inhalt) { parent = inhalt; insertBefore = planet.nextSibling; }
        else if(inhalt) { parent = inhalt; }
        else return false;

        const items = collectItems();
        if(!items.length) return false; // shop content not rendered yet — observer will retry

        injectStyle();

        const box = document.createElement('div');
        box.className = 'oih_box';
        parent.insertBefore(box, insertBefore);

        const head = el('div', 'oih_head', box);
        el('div', 'oih_title', head, '<span>&#9670;</span> Item Helper');
        const search = el('input', null, head);
        search.type = 'text';
        search.placeholder = '🔍'; // language-neutral search glyph

        // Flag: also show buyable shop items (default off → inventory + active only).
        const flag = el('label', 'oih_flag', head, '');
        const chk = el('input', null, flag);
        chk.type = 'checkbox';
        chk.checked = sessionStorage.getItem('oih_showShop') === '1';
        flag.appendChild(document.createTextNode(' ' + L('LOCA_PREMIUM_SHOP', 'Shop')));

        // Flag: the expiry reminder on the overview page. It is switched from here because this is
        // where the items are — the reminder itself only knows how to hide.
        const remFlag = el('label', 'oih_flag', head, '');
        const remChk = el('input', null, remFlag);
        remChk.type = 'checkbox';
        remChk.checked = reminderOn();
        remFlag.appendChild(document.createTextNode(' ⏳'));
        remFlag.title = 'Reminder of the items with a deadline, on the overview page';
        remChk.addEventListener('change', () => { try { localStorage.setItem(REM_OFF_KEY, remChk.checked ? '0' : '1'); } catch(e) {} });

        // Scan button: one accountInfo read (on click) to learn the active items of ALL planets.
        const scan = el('div', 'oih_scan', head, '⟳');
        scan.title = 'Scan account: one read of the items active on every planet';
        scan.addEventListener('click', () => scanAccount(scan));

        const count = el('div', 'oih_count', head, '');
        const collapsed0 = sessionStorage.getItem('oih_collapsed') === '1';
        const caret = el('div', 'oih_collapse', head, collapsed0 ? '&#9656;' : '&#9662;');

        // Hint: which sections are not yet loaded. Opening that tab once fills the box (manual,
        // player-driven — the script never switches tabs by itself).
        const hint = el('div', 'oih_hint oih_hidden', box);

        const grid = el('div', 'oih_grid' + (collapsed0 ? ' oih_hidden' : ''), box);
        caret.addEventListener('click', () =>
        {
            const hide = !grid.classList.contains('oih_hidden');
            grid.classList.toggle('oih_hidden', hide);
            caret.innerHTML = hide ? '&#9656;' : '&#9662;';
            sessionStorage.setItem('oih_collapsed', hide ? '1' : '0');
        });

        const nextPlanet = getNextPlanet();

        // Localized button words, straight from OGame.
        const T = { activate: L('activate', 'Activate'), extend: L('extend', 'Extend'), buy: locaBuy() };
        // Active → the game's own wording is "extend"; the `extendable` flag is only present in the
        // live tab data, so relying on it mislabelled scanned-active items as "activate".
        const labelFor = it => it.active ? T.extend : (!it.owned) ? T.buy : T.activate;
        const styleFor = it => it.active ? 'oih_extend' : (!it.owned) ? 'oih_compra' : 'oih_activate';

        // Open an item's native panel, remembering the current search for the "repeat" comfort.
        const doOpen = it => { sessionStorage.setItem('oih_filter', search.value || ''); openNativeItem(it.uuid, !it.owned); };   // where the tile lives depends on ownership, not on being active

        // A "next planet" link for one item, using OGame's own inventory deep-link URL so the game
        // opens the inventory on that item itself (1 user click = 1 navigation, §1.1).
        const nextLink = (it, textLabel) =>
        {
            const link = el('a', 'oih_btn oih_next', null, textLabel);
            link.title = (nextPlanet.coords || '') + ' »';
            // Land on the section the item lives in: owned/active → inventory, otherwise the
            // shop, so a buyable variant can be bought and activated on the next planet too.
            const inInventory = it.owned || it.active;
            const cat = inInventory ? inventoryAllCategory() : ((it.cats && it.cats[0]) || inventoryAllCategory());
            const page = inInventory ? 'inventory' : 'shop';
            link.href = `https://${window.location.host}/game/index.php?page=ingame&component=shop&cp=${nextPlanet.id}#category=${cat}&item=${it.uuid}&page=${page}&panel1-1=`;
            link.addEventListener('click', () =>
            {
                sessionStorage.setItem('oih_pending', it.uuid);
                sessionStorage.setItem('oih_pendingName', it.name);
            });
            return link;
        };

        const render = () =>
        {
            const needle = (search.value || '').trim().toLowerCase();
            const showShop = chk.checked;
            grid.innerHTML = '';

            // Prompt the player to open whichever section is missing. Because a visited section is
            // cached for 24h and seeded back on load, this naturally stays quiet for a day and only
            // re-asks once the cache has aged out — no separate timer needed.
            const missing = [];
            if(!Object.keys(mem.inv).length) missing.push(L('LOCA_PREMIUM_INVENTORY', 'Inventory'));
            if(!Object.keys(mem.shop).length) missing.push(L('LOCA_PREMIUM_SHOP', 'Shop'));
            hint.innerHTML = '';
            if(missing.length)
            {
                el('span', null, hint, '↻');
                missing.forEach(nm => el('span', 'oih_pill', hint, nm));
                hint.title = 'Open these tabs once to refresh the item list (kept for ~24h)';
                hint.classList.remove('oih_hidden');
            }
            else hint.classList.add('oih_hidden');

            // Re-read fresh each render so data from a section just opened appears.
            const items = collectItems();

            // Default: only what you own or have active. Flag on: also buyable shop items.
            let visible = items.filter(it => showShop || it.owned || it.active);
            visible = visible.filter(it => !needle || it.name.toLowerCase().indexOf(needle) >= 0);

            if(!visible.length) { el('div', 'oih_empty', grid, '—'); return; }

            // Group the different DURATIONS of the same item (same effect text) under one card, so
            // e.g. the 7d / 30d / 90d versions of one booster are one entry with a duration menu.
            const groups = {};
            visible.forEach(it =>
            {
                const key = (it.effect || it.name).toLowerCase();
                (groups[key] || (groups[key] = [])).push(it);
            });
            let list = Object.values(groups);

            // Perishable stock first — it is the one that is lost if you leave it — then active,
            // then the rest of what you own, then buyable-only (by the group's best member).
            const rank = g => Math.min(...g.map(it => (it.owned && it.expiresAt > 0) ? -1 : it.active ? 0 : it.owned ? 1 : 2));
            const soonest = g => Math.min(...g.map(it => (it.owned && it.expiresAt > 0) ? it.expiresAt : Infinity));
            list.sort((a, b) => (rank(a) - rank(b)) || (rank(a) < 0 ? soonest(a) - soonest(b) : 0));
            count.textContent = list.length + (showShop ? ' (+' + L('LOCA_PREMIUM_SHOP', 'Shop').toLowerCase() + ')' : '');

            list.forEach(group =>
            {
                // Inside a card, the copies with a deadline come first, then by duration.
                group.sort((a, b) => ((b.expiresAt > 0) - (a.expiresAt > 0)) || (a.expiresAt || 0) - (b.expiresAt || 0) || (a.duration || 0) - (b.duration || 0));
                const rep = group.find(it => it.active) || group.find(it => it.owned) || group[0];
                const buyOnly = !rep.owned && !rep.active;
                const totalAmount = group.reduce((s, it) => s + (+it.amount || 0), 0);
                // What the button ACTS on: the copy that expires soonest, so a perishable one is
                // what a click reaches for. The script never uses an item itself (§1.1) — this is
                // as far as "use that one first" can honestly go: it is what the button opens.
                const use = group.filter(it => it.owned && it.expiresAt > 0)[0] || rep;

                const card = el('div', 'oih_card' + (rep.active ? ' oih_on' : (buyOnly ? ' oih_buy' : '')) + (use.expiresAt > 0 ? ' oih_perish' : ''), grid);
                const thumb = el('div', 'oih_thumb' + (rep.rarity ? ' oih_r_' + rep.rarity : ''), card);
                if(rep.image) thumb.style.backgroundImage = `url('${rep.image}')`;

                const info = el('div', 'oih_info', card);
                const name = el('div', 'oih_name', info, rep.name);
                name.title = rep.effect || rep.name;
                const meta = el('div', 'oih_meta', info);
                if(totalAmount) el('span', 'oih_amount', meta, 'x' + totalAmount);
                // Percentage only when it is the item's OWN headline number: found in the name, or
                // right at the START of the effect (boosters: "20% in più..."). This drops the
                // incidental percentages buried in class / alliance-class item descriptions.
                const pct = (rep.name || '').match(/[+-]?\d+\s*%/) || (rep.effect || '').match(/^\s*[+-]?\d+\s*%/);
                if(pct) el('span', 'oih_pct', meta, pct[0].trim().replace(/\s+/g, ''));
                if(rep.active) el('span', 'oih_live', meta, rep.timeLeft ? fmtDur(rep.timeLeft) : (rep.timeText || ''));
                else if(buyOnly) el('span', 'oih_shopTag', meta, L('LOCA_PREMIUM_SHOP', 'Shop').toLowerCase());
                // The deadline of the copy the button would open, not of the whole group.
                if(use.expiresAt > 0)
                {
                    const left = expiresIn(use);
                    const tag = el('span', 'oih_exp' + (left < 86400 ? ' oih_soon' : ''), meta, '⏳ ' + fmtDur(left));
                    tag.title = 'Expires on ' + new Date(use.expiresAt).toLocaleString();
                }

                const actions = el('div', 'oih_actions', card);

                if(group.length === 1)
                {
                    // Single version → button acts directly.
                    const act = el('div', 'oih_btn ' + styleFor(use), actions, labelFor(use));
                    act.addEventListener('click', () => doOpen(use));
                    if(nextPlanet) actions.appendChild(nextLink(use, '»'));
                }
                else
                {
                    // Multiple durations → choose one first. Picking a duration does not open
                    // anything: it selects the variant, and the card then offers the action for it
                    // plus the jump to the next planet (which needs a concrete variant to carry).
                    const sub = el('div', 'oih_sub oih_hidden', card); // overlays the whole card
                    sub.addEventListener('click', e => { if(e.target === sub) sub.classList.add('oih_hidden'); }); // backdrop closes

                    const paint = sel =>
                    {
                        actions.innerHTML = '';
                        const base = sel || rep;
                        const main = el('div', 'oih_btn ' + styleFor(base), actions, '');
                        el('span', null, main, labelFor(base) + (sel ? ' ' + (durLabel(sel) || '') : ''));
                        const caret = el('span', 'oih_caret', main, '▾');
                        main.addEventListener('click', e =>
                        {
                            e.stopPropagation();
                            // No duration chosen yet, or the caret was clicked → (re)open the picker.
                            if(!sel || e.target === caret) { sub.classList.remove('oih_hidden'); return; }
                            doOpen(sel);
                        });
                        if(sel && nextPlanet) actions.appendChild(nextLink(sel, '»'));
                    };

                    group.forEach((m, i) =>
                    {
                        // Just the days (+7d/+30d/+90d), trimming the long item name.
                        const dLabel = durLabel(m) || ('#' + (i + 1));
                        const open = el('div', 'oih_btn oih_dur ' + styleFor(m) + (m.expiresAt > 0 ? ' oih_perish' : ''), sub, (m.expiresAt > 0 ? '⏳ ' : '') + dLabel);
                        open.title = labelFor(m) + ' · ' + m.name + (m.amount ? ' ×' + m.amount : '')
                            + (m.expiresAt > 0 ? ' · expires on ' + new Date(m.expiresAt).toLocaleString() : '');
                        open.addEventListener('click', () => { sub.classList.add('oih_hidden'); paint(m); });
                    });

                    // A copy with a deadline is pre-picked, so the card offers it straight away
                    // instead of asking which duration first.
                    paint(use.expiresAt > 0 ? use : null);
                }
            });
        };

        // On arrival, focus the box on the item we carried over. The game itself opens that item's
        // panel via the deep-link hash; here we only filter our box to it. Clear the stash so a
        // later manual navigation does not re-trigger the focus.
        let initialFilter = '';
        if(carry.uuid)
        {
            const m = items.find(it => it.uuid === carry.uuid);
            initialFilter = m ? m.name : carry.name;
            clearCarry();
            if(sessionStorage.getItem('oih_collapsed') === '1') { grid.classList.remove('oih_hidden'); caret.innerHTML = '&#9662;'; }
        }

        search.value = initialFilter;
        search.addEventListener('input', render);
        chk.addEventListener('change', () =>
        {
            sessionStorage.setItem('oih_showShop', chk.checked ? '1' : '0');
            render();
        });
        render();
        if(initialFilter) requestAnimationFrame(() => search.focus());

        rerender = render; // let the observer refresh the grid when a newly-opened tab adds data
        return true;
    }

    // Note: we no longer drive the game's UI to open the carried item — the "Pianeta »" link uses
    // OGame's own deep-link hash, so the game opens the inventory on that item by itself. Our old
    // tab/tile clicking produced a malformed #page=inventory hash that corrupted the inventory
    // render; letting the game's native URL do the work is both cleaner and more compliant.

    // --------------------------------------------------------------------- overview reminder
    // An item with a deadline is worth nothing once it passes, and the shop is not the page you
    // open every day — the overview is. So the deadlines are shown there, in the empty strip of
    // the planet banner: thumbnail, time left, and a link that opens that item in the shop.
    //
    // It reads ONLY localStorage — what the shop page already stored while the player was there.
    // No request, no timer, no alarm registered anywhere (§1.3/§1.4/§4): a static notice, drawn
    // when the player opens the page themselves, and switched off with the × or the shop flag.

    // Where the notice may sit, MEASURED rather than assumed. The banner's free strip is bounded
    // by things the game draws and we must not cover (§1.7): the bar of active items across the
    // bottom, the moon/planet thumbnail above, the planet data and its Trasferisciti /
    // abbandona row to the side. Each of them is read off the live layout, so the strip is
    // whatever is actually left — and if that is nothing, the caller puts the box below the
    // banner instead of on top of something.
    function reminderSpot()
    {
        const host = document.querySelector('#detailWrapper')
            || document.querySelector('#overviewcomponent #planet')
            || document.querySelector('#planet');
        if(!host) return null;
        const hostR = host.getBoundingClientRect();
        if(!hostR.width || !hostR.height) return null;

        // The active-items bar. It is drawn across the bottom of the banner (sometimes as a
        // sibling that overlaps it), so it is found by id/class anywhere and matched by geometry.
        let bottom = 8, bar = null;
        [].forEach.call(document.querySelectorAll('#buffBar, [id*="buffBar"], [class*="buffBar"]'), e =>
        {
            const r = e.getBoundingClientRect();
            if(!r.width || !r.height) return;
            if(r.bottom > hostR.top && r.top < hostR.bottom + 40)
            {
                if(hostR.bottom - r.top + 6 >= bottom) bar = e;
                bottom = Math.max(bottom, hostR.bottom - r.top + 6);
            }
        });

        // The thumbnail (moon link, or the planet image) sets the ceiling of the strip.
        const above = document.querySelector('#moon') || document.querySelector('#planetImage') || document.querySelector('#header_text');
        const aboveR = above && above.getBoundingClientRect();
        const ceiling = (aboveR && aboveR.height && aboveR.bottom > hostR.top) ? aboveR.bottom : hostR.top;
        const roof = (aboveR && aboveR.height) ? above : null;

        // The data column on the right sets the width, but only if it really is to the side.
        let width = Math.min(320, hostR.width - 24);
        const side = document.querySelector('#planetdata') || document.querySelector('#planetDetails');
        if(side)
        {
            const r = side.getBoundingClientRect();
            if(r.width && r.left > hostR.left + 60 && r.bottom > ceiling) width = Math.min(width, r.left - hostR.left - 16);
        }

        return { host, bar, roof, bottom, width, height: (hostR.bottom - bottom) - ceiling };
    }

    function buildReminder()
    {
        if(document.querySelector('.oih_rem')) return true;
        if(!reminderOn()) return true;
        const store = loadExpiring();
        if(!store || !store.items.length) return true; // nothing perishable → no box at all

        const spot = reminderSpot();
        if(!spot) return false; // not the page we expect (yet) — better nothing than the wrong place

        injectStyle();
        const host = spot.host;
        // One line, so it has a chance of fitting the strip the banner actually leaves free. It is
        // drawn there first, hidden, and then measured: whether it fits is a question about the
        // rendered box, not about a number we picked in advance.
        const box = el('div', 'oih_rem', null);
        box.style.visibility = 'hidden';
        if(getComputedStyle(host).position === 'static') host.style.position = 'relative';
        box.style.bottom = spot.bottom + 'px';
        box.style.maxWidth = Math.floor(spot.width) + 'px';
        host.appendChild(box);

        el('span', 'oih_remTitle', box, '⏳');
        box.title = 'Items with a deadline, as read in the shop on ' + new Date(store.at).toLocaleString();

        const cat = commonCategory(store.items.map(r => r.cats || []));
        const row = el('div', 'oih_remRow', box);
        const chips = store.items.slice(0, 6).map(r =>
        {
            const left = expiresIn(r);
            const a = el('a', 'oih_remItem' + (left < 86400 ? ' oih_soon' : ''), row);
            // The game's own inventory deep-link, on the planet we are already on: one click, one
            // navigation, and OGame opens the item itself (§1.1). No cp, so nothing switches planet.
            a.href = `https://${window.location.host}/game/index.php?page=ingame&component=shop#category=${cat}&item=${r.uuid}&page=inventory&panel1-1=`;
            a.title = r.name + (r.amount > 1 ? ' ×' + r.amount : '') + ' — expires on ' + new Date(r.expiresAt).toLocaleString();
            const th = el('span', 'oih_remImg', a);
            if(r.image) th.style.backgroundImage = `url('${r.image}')`;
            el('span', 'oih_remTime', a, fmtDur(left));
            return a;
        });
        const more = el('span', 'oih_remMore', row, '');
        // Show the first `kept` chips, count the rest. Chips are taken away and put back by this
        // one function, so the trimming below can try a size and change its mind.
        const setKept = kept =>
        {
            chips.forEach((c, i) =>
            {
                if(i < kept) { if(!c.parentNode) row.insertBefore(c, more); }
                else if(c.parentNode) c.remove();
            });
            const rest = store.items.slice(kept);
            more.textContent = rest.length ? '+' + rest.length : '';
            more.title = rest.map(r => r.name + ' — ' + fmtDur(expiresIn(r))).join('\n');
            more.style.display = rest.length ? '' : 'none';
        };
        setKept(chips.length);

        const off = el('span', 'oih_remOff', box, '&times;');
        off.title = 'Hide this reminder (switch it back on from the Item Helper box, in the shop)';
        off.addEventListener('click', () =>
        {
            try { localStorage.setItem(REM_OFF_KEY, '1'); } catch(e) {}
            box.remove();
        });

        // The chips wrap, so the question is how many LINES they take. Two is the shape we want,
        // and four items is the least worth showing: below that the notice stops being a summary
        // of what is running out. Both are measured on the real box — chip widths depend on the
        // time strings ("59m" against "9d 23h") and the strip's width is whatever the banner left.
        const MIN_CHIPS = Math.min(4, chips.length);
        const lineH = chips[0] ? chips[0].offsetHeight : 22;
        const twoLines = () => row.offsetHeight <= lineH * 2 + 4;
        let kept = chips.length;
        while(kept > MIN_CHIPS && (!twoLines() || box.offsetHeight > spot.height)) setKept(--kept);

        const fits = spot.width >= 130 && twoLines() && box.offsetHeight <= spot.height;
        if(!fits)
        {
            // No room inside without covering something → below the banner, in normal flow. The
            // anchor is the block that also holds the item bar, because that bar is usually drawn
            // over the banner's bottom edge rather than after it: going out one level is what puts
            // us past it instead of under it.
            box.classList.add('oih_remFlow');
            box.style.bottom = box.style.maxWidth = '';
            setKept(chips.length); // below the banner there is the whole width to use
            let anchor = host;
            for(let i = 0; i < 4 && spot.bar && !anchor.contains(spot.bar) && anchor.parentElement && anchor.parentElement !== document.body; i++) anchor = anchor.parentElement;
            if(anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
            // Same two-line shape here, measured again: the width down there is not the strip's.
            let wide = chips.length;
            while(wide > MIN_CHIPS && !twoLines()) setKept(--wide);
        }

        // Last guard, on the real layout: if the notice still meets something the game drew — a
        // banner built differently than any we know, or an image spilling out of it — it gets out
        // of the way instead of sitting on top of it. In the strip we can only move up (away from
        // the item bar); below the banner we can move down, away from either.
        const flowing = box.classList.contains('oih_remFlow');
        [spot.bar, flowing ? spot.roof : null].forEach(other =>
        {
            if(!other) return;
            const b = box.getBoundingClientRect(), r = other.getBoundingClientRect();
            const cross = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
            const along = Math.min(b.right, r.right) - Math.max(b.left, r.left);
            if(cross <= 0 || along <= 0) return;
            if(flowing) box.style.marginTop = ((parseFloat(getComputedStyle(box).marginTop) || 0) + cross + 4) + 'px';
            else box.style.bottom = ((parseFloat(box.style.bottom) || 0) + cross + 4) + 'px';
        });
        box.style.visibility = '';
        return true;
    }

    function startOverview()
    {
        try
        {
            if(buildReminder()) return;
            // The overview builds itself in pieces; wait for the banner, then stop watching. DOM
            // only, bounded — nothing is polled and nothing is asked of the server (§1.3/§4).
            const target = document.querySelector('#inhalt') || document.body;
            const obs = new MutationObserver(() => { if(buildReminder()) obs.disconnect(); });
            obs.observe(target, { childList: true, subtree: true });
            setTimeout(() => obs.disconnect(), 15000);
        }
        catch(e) { console.error('[OGItemHelper] reminder failed:', e); }
    }

    // --------------------------------------------------------------------- start
    // The shop rebuilds its DOM constantly (GFSlider, tab switches, opening a detail,
    // pagination), wiping our box. We watch permanently: on each tick we hydrate memory from
    // whatever section is currently rendered, drive the one-time priming of both sections, and
    // re-inject/refresh the box. DOM-only observation — no server calls, no polling (§1.3/§4).
    let pending = false, rerender = null, lastSig = '';
    // What the box actually draws: which items we hold, how many, and whether they are on. Counting
    // the refs alone missed a stack going 2 → 1 (same number of items), so the grid kept showing the
    // old amount until something else forced a redraw. Volatile countdowns stay out of it, or the
    // grid would rebuild every second.
    function memSig()
    {
        const parts = [];
        [mem.inv, mem.shop].forEach(m => Object.keys(m).sort().forEach(k =>
        {
            const r = m[k] || {};
            parts.push(k + ':' + (+r.amount || 0) + (r.owned ? 'o' : '') + (r.active ? 'a' : '') + (r.buyable ? 'b' : '') + '@' + (+r.expiresAt || 0));
        }));
        return parts.join(',');
    }
    function ensure()
    {
        if(pending) return;
        pending = true;
        requestAnimationFrame(() =>
        {
            pending = false;
            try
            {
                ingestLive(); // passively read whatever tab the player has open — no auto-loading
                const sig = memSig();
                if(!document.querySelector('.oih_box')) { build(); lastSig = sig; }
                else if(rerender && sig !== lastSig) { rerender(); lastSig = sig; } // only when data changed
            }
            catch(e) { console.error('[OGItemHelper] failed:', e); }
        });
    }

    function start()
    {
        try
        {
            seedFromCache(); // start from what we already saw (<24h), so the box is complete at once
            ensure();
            const target = document.querySelector('#inhalt') || document.querySelector('#planet') || document.body;
            if(!target) return;
            new MutationObserver(ensure).observe(target, { childList: true, subtree: true });
            if(target === document.body)
            {
                const boot = new MutationObserver(() =>
                {
                    const inhalt = document.querySelector('#inhalt');
                    if(inhalt) { boot.disconnect(); new MutationObserver(ensure).observe(inhalt, { childList: true, subtree: true }); ensure(); }
                });
                boot.observe(document.body, { childList: true, subtree: true });
            }
        }
        catch(e) { console.error('[OGItemHelper] failed:', e); }
    }

    if(IS_SHOP) start();
    else startOverview();
})();
