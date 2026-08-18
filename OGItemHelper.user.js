// ==UserScript==
// @name         OGame Item Activation Helper
// @namespace    https://github.com/nicolagalassi/progect
// @version      0.12.6
// @description  A searchable inventory box on the shop page that shows what is already active on the planet, opens the game's own item panel on click, and can carry the same item to the next planet ready to activate. Standalone companion to PrOGect.
// @author       nicolagalassi
// @match        https://*.ogame.gameforge.com/game/*
// @icon         https://gf1.geo.gfsrv.net/cdn3d/favicon.ico
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/*
  OGame Item Activation Helper — a small, self-contained userscript.

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
  - "Pianeta succ." navigates to the next planet using the GAME'S OWN inventory deep-link URL
    (#category=..&item=..&page=inventory&panel1-1=), so OGame itself opens the inventory on the
    SAME item, ready. It never presses the activate button: the activation is yours.

  COMPLIANCE (OGame Origin tool rules — see PrOGect/AGENTS.md):
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
  - §1.7  Our box is added in normal flow; it never hides, resizes, moves or covers the shop
          image, ads or Shop menu.
  - §3    Comfort feature touching the shop UI/flow → GRAY AREA: get a ToolDev sign-off first.
  - §5    Runs inside the OGame page → needs toleration before public distribution.
*/

(function()
{
    'use strict';

    const HREF = window.location.href;
    if(HREF.indexOf('component=shop') < 0 && HREF.indexOf('page=shop') < 0) return;

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
    // by every owned item; we derive it dynamically (fallback to the known constant).
    function inventoryAllCategory()
    {
        const arrs = ((PAGE.inventoryObj || {}).items_inventory || []).map(it => it.category || []).filter(a => a.length);
        if(arrs.length)
        {
            let common = arrs[0].slice();
            arrs.forEach(a => { common = common.filter(c => a.indexOf(c) >= 0); });
            if(common[0]) return common[0];
        }
        return 'd8d49c315fa620d9c7f1f19963970dea59a0e3be';
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
    function saveCache(kind, map)
    {
        // Active/timeLeft are planet-specific — don't persist them in the account-wide inventory.
        const items = Object.values(map).map(r => Object.assign({}, r, { active: false, timeLeft: 0 }));
        try { localStorage.setItem(cacheKey(kind), JSON.stringify({ at: Date.now(), items })); } catch(e) {}
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
        if(!it || !it.ref || it.expiryDate) return null; // skip running one-shot instances
        if(it.isAvatar) return null; // never list avatars
        const amount = it.amount || 0;
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
        };
    }

    // Read whatever the game currently exposes (the visible tab) and let it OVERRIDE the cache for
    // those refs (live is authoritative/fresh); refs only in cache stay. Persist what we saw.
    function ingestLive()
    {
        const obj = PAGE.inventoryObj || {};
        // Refs the game marks as avatars — excluded from DOM tiles too, and purged from memory/cache.
        const avatars = new Set();
        [...(obj.items_inventory || []), ...(obj.items_shop || [])].forEach(it => { if(it && it.ref && it.isAvatar) avatars.add(it.ref); });

        const liveInv = {}, liveShop = {};
        (obj.items_inventory || []).forEach(it => { const r = fromJs(it); if(r) upsertInto(liveInv, r); });
        scrapeSlider('#js_inventorySlider', false).forEach(r => { if(!avatars.has(r.uuid)) upsertInto(liveInv, r); });
        (obj.items_shop || []).forEach(it => { const r = fromJs(it); if(r) upsertInto(liveShop, r); });
        scrapeSlider('#js_shopSliderBox', true).forEach(r => { if(!avatars.has(r.uuid)) upsertInto(liveShop, r); });

        avatars.forEach(ref => { delete mem.inv[ref]; delete mem.shop[ref]; }); // drop any previously cached avatar
        Object.entries(liveInv).forEach(([k, v]) => { mem.inv[k] = v; });
        Object.entries(liveShop).forEach(([k, v]) => { mem.shop[k] = v; });

        if(Object.keys(liveInv).length) saveCache('inv', mem.inv);   // refresh this planet's inventory cache
        if(Object.keys(liveShop).length) saveCache('shop', mem.shop); // refresh the global shop cache
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
            const timeText = (box && box.querySelector('.countdownHolder time')?.textContent) || '';
            // Same rule as the JS path: active only when the tile actually shows a countdown,
            // so permanent items are never flagged as active.
            const active = !!(box && box.querySelector('.activation.js_is_active')) && !!timeText;
            // Duration hint from the tooltip / name (e.g. "7 giorni", "30 days") — language-agnostic
            // number + a day word; falls back to 0 when not present.
            const dm = (a.getAttribute('data-tooltip-title') || name).match(/(\d+)\s*(giorni|day|days|tag|tage|jour|jours|d[ií]as?|dni|dní|gün|dagen)/i);
            const duration = dm ? +dm[1] * 86400 : 0;
            out.push({ uuid, name, amount, image, effect, rarity, active, timeText, duration, extendable: false, buyable: isShop, owned: isShop ? amount > 0 : true });
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
        el('div', 'oih_title', head, '<span>&#9670;</span> Item helper');
        const search = el('input', null, head);
        search.type = 'text';
        search.placeholder = '🔍'; // language-neutral search glyph

        // Flag: also show buyable shop items (default off → inventory + active only).
        const flag = el('label', 'oih_flag', head, '');
        const chk = el('input', null, flag);
        chk.type = 'checkbox';
        chk.checked = sessionStorage.getItem('oih_showShop') === '1';
        flag.appendChild(document.createTextNode(' ' + L('LOCA_PREMIUM_SHOP', 'Shop')));

        // Scan button: one accountInfo read (on click) to learn the active items of ALL planets.
        const scan = el('div', 'oih_scan', head, '⟳');
        scan.title = 'Scansiona account: legge una volta gli item attivi di tutti i pianeti';
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
        const T = { activate: L('activate', 'Attiva'), extend: L('extend', 'Prolunga'), buy: locaBuy() };
        const labelFor = it => (it.active && it.extendable) ? T.extend : (!it.owned && !it.active) ? T.buy : T.activate;
        const styleFor = it => (it.active && it.extendable) ? 'oih_extend' : (!it.owned && !it.active) ? 'oih_compra' : 'oih_activate';

        // Open an item's native panel, remembering the current search for the "repeat" comfort.
        const doOpen = it => { sessionStorage.setItem('oih_filter', search.value || ''); openNativeItem(it.uuid, !it.owned); };   // where the tile lives depends on ownership, not on being active

        // A "next planet" link for one item, using OGame's own inventory deep-link URL so the game
        // opens the inventory on that item itself (1 user click = 1 navigation, §1.1).
        const nextLink = (it, textLabel) =>
        {
            const link = el('a', 'oih_btn oih_next', null, textLabel);
            link.title = (nextPlanet.coords || '') + ' »';
            const cat = inventoryAllCategory();
            link.href = `https://${window.location.host}/game/index.php?page=ingame&component=shop&cp=${nextPlanet.id}#category=${cat}&item=${it.uuid}&page=inventory&panel1-1=`;
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
            if(!Object.keys(mem.inv).length) missing.push(L('LOCA_PREMIUM_INVENTORY', 'Inventario'));
            if(!Object.keys(mem.shop).length) missing.push(L('LOCA_PREMIUM_SHOP', 'Shop'));
            hint.innerHTML = '';
            if(missing.length)
            {
                el('span', null, hint, '↻');
                missing.forEach(nm => el('span', 'oih_pill', hint, nm));
                hint.title = 'Apri queste schede una volta per aggiornare gli item (la cache dura ~24h)';
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

            // Active first, then owned, then buyable-only (by the group's best member).
            const rank = g => Math.min(...g.map(it => it.active ? 0 : it.owned ? 1 : 2));
            list.sort((a, b) => rank(a) - rank(b));
            count.textContent = list.length + (showShop ? ' (+' + L('LOCA_PREMIUM_SHOP', 'Shop').toLowerCase() + ')' : '');

            list.forEach(group =>
            {
                group.sort((a, b) => (a.duration || 0) - (b.duration || 0));
                const rep = group.find(it => it.active) || group.find(it => it.owned) || group[0];
                const buyOnly = !rep.owned && !rep.active;
                const totalAmount = group.reduce((s, it) => s + (+it.amount || 0), 0);

                const card = el('div', 'oih_card' + (rep.active ? ' oih_on' : (buyOnly ? ' oih_buy' : '')), grid);
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

                const actions = el('div', 'oih_actions', card);

                if(group.length === 1)
                {
                    // Single version → button acts directly.
                    const act = el('div', 'oih_btn ' + styleFor(rep), actions, labelFor(rep));
                    act.addEventListener('click', () => doOpen(rep));
                    if(nextPlanet && !buyOnly) actions.appendChild(nextLink(rep, '»'));
                }
                else
                {
                    // Multiple durations → the button reveals a horizontal, blurred overlay across
                    // the card with the per-duration choices (+7d / +30d / +90d).
                    const act = el('div', 'oih_btn ' + styleFor(rep), actions, labelFor(rep) + ' ▾');
                    const sub = el('div', 'oih_sub oih_hidden', card); // overlays the whole card
                    act.addEventListener('click', e => { e.stopPropagation(); sub.classList.remove('oih_hidden'); });
                    sub.addEventListener('click', e => { if(e.target === sub) sub.classList.add('oih_hidden'); }); // click backdrop to close

                    group.forEach((m, i) =>
                    {
                        // Just the days (+7d/+30d/+90d), trimming the long item name.
                        const dLabel = durLabel(m) || ('#' + (i + 1));
                        const open = el('div', 'oih_btn oih_dur ' + styleFor(m), sub, dLabel);
                        open.title = labelFor(m) + ' · ' + m.name + (m.amount ? ' ×' + m.amount : '');
                        open.addEventListener('click', () => { sub.classList.add('oih_hidden'); doOpen(m); });
                    });
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

    // --------------------------------------------------------------------- start
    // The shop rebuilds its DOM constantly (GFSlider, tab switches, opening a detail,
    // pagination), wiping our box. We watch permanently: on each tick we hydrate memory from
    // whatever section is currently rendered, drive the one-time priming of both sections, and
    // re-inject/refresh the box. DOM-only observation — no server calls, no polling (§1.3/§4).
    let pending = false, rerender = null, lastSig = '';
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
                const sig = Object.keys(mem.inv).length + '/' + Object.keys(mem.shop).length;
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

    start();
})();
