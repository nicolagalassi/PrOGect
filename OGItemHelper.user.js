// ==UserScript==
// @name         OGame Item Activation Helper
// @namespace    https://github.com/nicolagalassi/progect
// @version      0.7.0
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
    shop items you do not own. It reads BOTH shop sections as one: the game loads inventory and
    shop data separately per tab, so each is cached in the session (inventory per planet, shop
    globally) and merged, and the button labels come from OGame's own `loca` so they are already
    in the player's language (Attiva / Prolunga / Compra, etc.).
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
          keeps the box present as the shop rebuilds itself.
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
        .oih_head input{flex:1;min-width:60px;padding:4px 8px;border-radius:3px;border:1px solid #3a4756;background:#0e131a;color:#fff;font-size:12px}
        .oih_head input:focus{outline:none;border-color:#ffb800}
        .oih_flag{font-size:11px;color:#9ec7ff;white-space:nowrap;display:inline-flex;align-items:center;gap:3px;cursor:pointer;user-select:none}
        .oih_flag input{cursor:pointer;margin:0}
        .oih_count{font-size:11px;color:#7c8b99;white-space:nowrap}
        .oih_collapse{cursor:pointer;color:#9aa7b4;font-size:14px;line-height:1;padding:2px 4px;user-select:none}
        .oih_collapse:hover{color:#ffb800}
        .oih_grid{max-height:240px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:6px;padding-right:2px}
        .oih_grid.oih_hidden{display:none}
        .oih_card{position:relative;display:flex;gap:7px;align-items:center;padding:5px;border-radius:3px;background:rgba(14,19,26,.75);border:1px solid #2b3542}
        .oih_card:hover{border-color:#4a5a6c}
        .oih_card.oih_on{border-color:#3f8f5f;background:rgba(20,34,26,.8)}
        .oih_card.oih_buy{border-color:#3f5a80;background:rgba(18,24,34,.8)}
        .oih_shopTag{color:#7fa8e0}
        .oih_thumb{width:36px;height:36px;flex:0 0 auto;border-radius:3px;background-size:cover;background-position:center;background-repeat:no-repeat;background-color:#0b0f14;border:1px solid #333c47}
        .oih_r_common{border-color:#6d7b86}.oih_r_uncommon{border-color:#4a8f5b}.oih_r_rare{border-color:#3f6fb0}.oih_r_epic{border-color:#8a5bbf}
        .oih_info{flex:1 1 auto;min-width:0}
        .oih_name{font-size:11px;color:#e6ecf2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .oih_meta{font-size:10px;color:#8aa0b2;display:flex;gap:6px;margin-top:2px;flex-wrap:wrap}
        .oih_amount{color:#ffb800}
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
        .oih_sub{display:flex;flex-direction:column;gap:3px;margin-top:2px}
        .oih_sub.oih_hidden{display:none}
        .oih_subRow{display:flex;gap:3px;align-items:stretch}
        .oih_subRow .oih_btn{flex:1 1 auto}
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

    // Session cache so the two shop sections read as ONE. OGame lazily populates items_inventory
    // (owned/active) and items_shop (buyable) only when their tab has rendered, so on any given
    // load we usually see just one. We remember each as it appears — inventory per planet (its
    // owned/active state is planet-specific), the shop globally — and merge live + cached, so the
    // helper always shows the full picture. Pure DOM/sessionStorage: no fetch, no polling (§4).
    function currentPlanetId()
    {
        const line = document.querySelector('.smallplanet.hightlightPlanet, .smallplanet.hightlightMoon');
        const link = line && (line.querySelector('.planetlink') || line.querySelector('a[href*="cp="]'));
        const fromLink = link && new URLSearchParams((link.getAttribute('href') || '').split('?')[1] || '').get('cp');
        const fromUrl = new URLSearchParams(HREF.split('?')[1] || '').get('cp');
        return String(fromLink || fromUrl || '0').split('#')[0];
    }
    const cacheGet = k => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch(e) { return null; } };
    const cacheSet = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch(e) {} };
    const slim = it => ({ ref: it.ref, name: it.name, imageLarge: it.imageLarge, image: it.image, effect: it.effect, rarity: it.rarity, amount: it.amount, status: it.status, timeLeft: it.timeLeft, extendable: it.extendable, buyable: it.buyable, expiryDate: it.expiryDate });

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

    // Collect every item the shop page already knows about — no fetch (§4).
    // We MERGE four sources so nothing is missed: the game's inventoryObj.items_inventory (owned,
    // with per-planet active state) and items_shop (buyable), PLUS the inventory- and shop-slider
    // DOM tiles. The DOM inventory slider is what guarantees the WEAK, non-buyable items you own
    // (e.g. bronze boosters, which never appear in items_shop) are shown — the arrays alone can be
    // empty or partial depending on which tab the game has rendered.
    function collectItems()
    {
        const map = {};

        // Merge one record into the map: OR the boolean flags, keep the first non-empty scalar.
        const upsert = d =>
        {
            if(!d || !d.uuid) return;
            const e = map[d.uuid] || (map[d.uuid] = { uuid: d.uuid });
            for(const k in d)
            {
                const v = d[k];
                if(v === undefined || v === null || v === '') continue;
                if(k === 'owned' || k === 'active' || k === 'buyable') e[k] = e[k] || v;
                else if(e[k] === undefined || e[k] === '' || e[k] === 0) e[k] = v;
            }
        };

        const fromJs = it =>
        {
            if(!it || !it.ref || it.expiryDate) return null; // skip running one-shot instances
            const amount = it.amount || 0;
            const active = it.status === 'effecting' || it.timeLeft > 0;
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
        };

        // Live arrays from whichever tab the game has rendered — cache each so the other section
        // is still available later (inventory per planet, shop globally).
        const obj = PAGE.inventoryObj || {};
        const pid = currentPlanetId();
        const invLive = (obj.items_inventory || []).filter(it => it && it.ref && !it.expiryDate);
        const shopLive = (obj.items_shop || []).filter(it => it && it.ref && !it.expiryDate);
        if(invLive.length) cacheSet('oih_inv_' + pid, invLive.map(slim));
        if(shopLive.length) cacheSet('oih_shop', shopLive.map(slim));
        const invItems = invLive.length ? invLive : (cacheGet('oih_inv_' + pid) || []);
        const shopItems = shopLive.length ? shopLive : (cacheGet('oih_shop') || []);

        invItems.forEach(it => upsert(fromJs(it)));
        shopItems.forEach(it => upsert(fromJs(it)));
        scrapeSlider('#js_inventorySlider', false).forEach(upsert);
        scrapeSlider('#js_shopSliderBox', true).forEach(upsert);

        return Object.values(map).filter(e => e.name);
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
            const active = !!(box && box.querySelector('.activation.js_is_active'));
            const timeText = (box && box.querySelector('.countdownHolder time')?.textContent) || '';
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
    // Owned/active items live in the Inventory tab; buyable-only items live in the Shop tab.
    function openNativeItem(uuid, fromShop)
    {
        const tabSel = fromShop ? '.tabSelectionTab.shopTab' : '.tabSelectionTab.inventoryTab';
        const tab = document.querySelector(tabSel);
        if(tab && !tab.classList.contains('active')) tab.click();
        const scope = document.querySelector(fromShop ? '#js_shopSliderBox' : '#js_inventorySlider') || document;
        const tile = scope.querySelector(`a.detail_button[ref="${uuid}"]`) || document.querySelector(`a.detail_button[ref="${uuid}"]`);
        if(tile) tile.click();
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

        const count = el('div', 'oih_count', head, '');
        const collapsed0 = sessionStorage.getItem('oih_collapsed') === '1';
        const caret = el('div', 'oih_collapse', head, collapsed0 ? '&#9656;' : '&#9662;');

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
        const durLabel = it => it.duration > 0 ? Math.round(it.duration / 86400) + 'd' : '';

        // Open an item's native panel, remembering the current search for the "repeat" comfort.
        const doOpen = it => { sessionStorage.setItem('oih_filter', search.value || ''); openNativeItem(it.uuid, !it.owned && !it.active); };

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

        const render = filter =>
        {
            const needle = (filter || '').trim().toLowerCase();
            const showShop = chk.checked;
            grid.innerHTML = '';

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
                const pct = (rep.effect || '').match(/[+-]?\d+\s*%/);
                if(pct) el('span', 'oih_pct', meta, pct[0].replace(/\s+/g, ''));
                if(rep.active) el('span', 'oih_live', meta, rep.timeLeft ? fmtDur(rep.timeLeft) : (rep.timeText || ''));
                else if(buyOnly) el('span', 'oih_shopTag', meta, L('LOCA_PREMIUM_SHOP', 'Shop').toLowerCase());

                const actions = el('div', 'oih_actions', card);

                if(group.length === 1)
                {
                    // Single version → button acts directly.
                    const act = el('div', 'oih_btn ' + styleFor(rep), actions, labelFor(rep));
                    act.addEventListener('click', () => doOpen(rep));
                    if(nextPlanet && !buyOnly) actions.appendChild(nextLink(rep, (nextPlanet.coords || '') + ' »'));
                }
                else
                {
                    // Multiple durations → the button expands to a per-duration menu (7d/30d/90d).
                    const act = el('div', 'oih_btn ' + styleFor(rep), actions, labelFor(rep) + ' ▾');
                    const sub = el('div', 'oih_sub oih_hidden', actions);
                    act.addEventListener('click', () => sub.classList.toggle('oih_hidden'));

                    group.forEach(m =>
                    {
                        const row = el('div', 'oih_subRow', sub);
                        const dLabel = (durLabel(m) || m.name) + (m.amount ? ' ×' + m.amount : '');
                        const open = el('div', 'oih_btn ' + styleFor(m), row, dLabel);
                        open.title = labelFor(m) + ' · ' + m.name;
                        open.addEventListener('click', () => doOpen(m));
                        if(nextPlanet && m.owned) row.appendChild(nextLink(m, '»'));
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
        search.addEventListener('input', () => render(search.value));
        chk.addEventListener('change', () =>
        {
            sessionStorage.setItem('oih_showShop', chk.checked ? '1' : '0');
            render(search.value);
        });
        render(initialFilter);
        if(initialFilter) requestAnimationFrame(() => search.focus());

        return true;
    }

    // Note: we no longer drive the game's UI to open the carried item — the "Pianeta »" link uses
    // OGame's own deep-link hash, so the game opens the inventory on that item by itself. Our old
    // tab/tile clicking produced a malformed #page=inventory hash that corrupted the inventory
    // render; letting the game's native URL do the work is both cleaner and more compliant.

    // --------------------------------------------------------------------- start
    // The shop rebuilds its DOM constantly (GFSlider, tab switches, opening a detail,
    // pagination), wiping our box. We watch permanently and re-inject when it is missing.
    // DOM-only observation — no server calls, no polling (§1.3/§4).
    let pending = false;
    function ensure()
    {
        if(pending) return;
        pending = true;
        requestAnimationFrame(() =>
        {
            pending = false;
            try { if(!document.querySelector('.oih_box')) build(); }
            catch(e) { console.error('[OGItemHelper] build failed:', e); }
        });
    }

    function start()
    {
        try
        {
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
