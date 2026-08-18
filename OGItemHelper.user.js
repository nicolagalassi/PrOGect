// ==UserScript==
// @name         OGame Item Activation Helper
// @namespace    https://github.com/nicolagalassi/progect
// @version      0.2.0
// @description  A searchable inventory overview on the shop page, with a compliant activation flow: one click opens the game's own item panel, and a "next planet" jump pre-selects the same item. Standalone companion to PrOGect.
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
  This helper collapses the *finding* while leaving the *activating* exactly where the
  game puts it.

  WHAT IT DOES (on the shop page)
  - Reads the inventory the page already holds (the game's own `inventoryObj.items_inventory`,
    or the inventory DOM as a fallback) and shows a compact, searchable overview: small
    thumbnail, name, amount, and a percentage badge — with the name search the game lacks.
  - "Attiva" opens the game's OWN item panel for that item (the panel with the game's
    "Attiva"/"Prolunga" button). You press the game's button — that is the one game action.
    The search is remembered, so re-opening the same item to stack/extend it needs no search.
  - "Pianeta succ." is a normal navigation link to the next planet's shop with the same
    item pre-selected, so it is right there when the page reloads.

  COMPLIANCE (OGame Origin tool rules — see PrOGect/AGENTS.md):
  - §1.1  1 click = 1 action. The helper never activates anything itself: "Attiva" only opens
          the game's native item panel; the activation is the player's click on the game's
          own button. No auto-click on load, no loop, no skipping the game's own confirm step.
  - §1.3/§4  No auto-refresh, no polling, no timers hitting the server. It reads data already
          in the page; a DOM-only MutationObserver waits for the shop content to render.
  - §4.2  No background `cp` calls. Planet switching is a real <a> navigation the player clicks.
  - §6    We call NO activation endpoint or game function ourselves — we forward to the game's
          own item tile / panel.
  - §1.7  The shop image, ads and Shop menu are never hidden, resized, moved or swapped. The
          overview is an on-demand overlay that starts collapsed and closes to reveal the shop
          again (and closes itself when opening a game panel, so it never covers it).
  - §3    Comfort feature that touches the shop UI/flow → GRAY AREA: get a ToolDev sign-off on
          the OGame Origin forum before publishing.
  - §5    Runs inside the OGame page → needs toleration before public distribution.
*/

(function()
{
    'use strict';

    const HREF = window.location.href;
    if(HREF.indexOf('component=shop') < 0 && HREF.indexOf('page=shop') < 0) return;

    // Page context (with @grant none the script shares the page window, so the game's own
    // inventoryObj is directly readable — no fetch needed).
    const PAGE = window;

    // --------------------------------------------------------------------- styles
    const CSS = `
        .oih_toggle{position:absolute;top:8px;right:12px;z-index:30;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;cursor:pointer;border-radius:3px;font-size:12px;color:#fff;background:linear-gradient(192deg,#252e3a,#171c24 70%);border:1px solid #3a4756;box-shadow:0 1px 6px rgba(0,0,0,.5)}
        .oih_toggle:hover{border-color:#ffb800}
        .oih_toggle .oih_ico{color:#f0a955}
        .oih_panel{position:absolute;top:36px;left:10px;right:10px;z-index:29;max-height:210px;display:flex;flex-direction:column;background:linear-gradient(192deg,rgba(37,46,58,.98),rgba(20,25,32,.98));border:1px solid #3a4756;border-radius:4px;box-shadow:0 6px 22px rgba(0,0,0,.6);padding:8px;box-sizing:border-box}
        .oih_hidden{display:none !important}
        .oih_head{display:flex;align-items:center;gap:8px;margin-bottom:7px;flex:0 0 auto}
        .oih_title{font-size:12px;color:#f0a955;font-weight:bold;white-space:nowrap}
        .oih_head input{flex:1;min-width:60px;padding:4px 8px;border-radius:3px;border:1px solid #3a4756;background:#0e131a;color:#fff;font-size:12px}
        .oih_head input:focus{outline:none;border-color:#ffb800}
        .oih_count{font-size:11px;color:#7c8b99;white-space:nowrap}
        .oih_close{cursor:pointer;color:#9aa7b4;font-size:18px;line-height:1;padding:0 2px}
        .oih_close:hover{color:#f9392b}
        .oih_grid{flex:1 1 auto;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;padding-right:2px}
        .oih_card{position:relative;display:flex;gap:7px;align-items:center;padding:5px;border-radius:3px;background:rgba(14,19,26,.75);border:1px solid #2b3542}
        .oih_card:hover{border-color:#4a5a6c}
        .oih_thumb{width:36px;height:36px;flex:0 0 auto;border-radius:3px;background-size:cover;background-position:center;background-repeat:no-repeat;background-color:#0b0f14;border:1px solid #333c47}
        .oih_r_common{border-color:#6d7b86}.oih_r_uncommon{border-color:#4a8f5b}.oih_r_rare{border-color:#3f6fb0}.oih_r_epic{border-color:#8a5bbf}
        .oih_info{flex:1 1 auto;min-width:0}
        .oih_name{font-size:11px;color:#e6ecf2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .oih_meta{font-size:10px;color:#8aa0b2;display:flex;gap:6px;margin-top:2px}
        .oih_amount{color:#ffb800}
        .oih_pct{color:#7fd6a0}
        .oih_actions{display:flex;flex-direction:column;gap:3px;flex:0 0 auto}
        .oih_btn{cursor:pointer;font-size:10px;padding:3px 7px;border-radius:3px;border:1px solid #3a4756;background:linear-gradient(192deg,#2b3542,#1a2029);color:#fff;text-align:center;text-decoration:none;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center}
        .oih_btn:hover{border-color:#ffb800}
        .oih_btn.oih_activate{color:#bfeecf}
        .oih_btn.oih_next{color:#9ec7ff}
        .oih_empty{color:#8aa0b2;font-size:12px;padding:14px;text-align:center;grid-column:1/-1}
        .oih_hint{flex:0 0 auto;margin-top:6px;font-size:10px;color:#6f7f8d;line-height:1.35}
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

    // Planet list from the game's own sidebar; "next planet" reuses the game's cp navigation.
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

    // Read the inventory the shop page already holds — no fetch (§4).
    // Primary source: the game's own inventoryObj.items_inventory. Fallback: the tile DOM.
    function readInventory()
    {
        const out = [];
        const seen = {};

        const obj = PAGE.inventoryObj;
        if(obj && Array.isArray(obj.items_inventory) && obj.items_inventory.length)
        {
            obj.items_inventory.forEach(it =>
            {
                // amount>0 = an owned stack you can activate; skip active running instances
                // (they carry an expiryDate and are not re-activatable).
                if(!it || !it.ref || !(it.amount > 0) || it.expiryDate) return;
                if(seen[it.ref]) return;
                seen[it.ref] = 1;
                const hash = it.imageLarge || it.image || '';
                out.push({
                    uuid: it.ref,
                    name: (it.name || 'Item').trim(),
                    amount: it.amount,
                    image: hash ? `/cdn/img/item-images/${hash}.png` : '',
                    effect: stripTags(it.effect || ''),
                    rarity: (it.rarity || '').toLowerCase(),
                });
            });
            if(out.length) return out;
        }

        // Fallback: scrape the inventory tiles.
        document.querySelectorAll('#js_inventorySlider a.detail_button[ref], a.detail_button[ref]').forEach(a =>
        {
            const uuid = a.getAttribute('ref');
            if(!uuid || uuid === 'ffffffffffffffffffffffffffffffffffffffff' || seen[uuid]) return;
            seen[uuid] = 1;
            const tip = a.getAttribute('data-tooltip-title') || '';
            const parts = tip.split('|');
            const name = stripTags(parts[0] || 'Item');
            const effect = stripTags((parts[1] || '').split('<br')[0]);
            const amount = (a.querySelector('.ecke .amount, .amount')?.textContent || '').replace(/[^\d]/g, '');
            let image = '';
            const box = a.closest('.item_img');
            if(box)
            {
                const m = getComputedStyle(box).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
                if(m) image = m[1];
            }
            out.push({ uuid, name, amount: amount ? +amount : '', image, effect, rarity: '' });
        });
        return out;
    }

    // Open the game's OWN item panel for this item. We never activate anything ourselves
    // (§1.1/§6) — the player presses the game's "Attiva"/"Prolunga" button in that panel.
    function openNativeItem(uuid)
    {
        // Make sure the game's Inventory tab is the active one, then open the item.
        const invTab = document.querySelector('.tabSelectionTab.inventoryTab');
        if(invTab && !invTab.classList.contains('active')) invTab.click();
        const tile = document.querySelector(`a.detail_button[ref="${uuid}"]`);
        if(tile) tile.click();
    }

    // --------------------------------------------------------------------- UI
    function build()
    {
        // Anchor to the shop's own container (#planet). The overlay uses the shop-image space
        // on demand without altering the image itself (§1.7).
        const anchor = document.querySelector('#planet') || document.querySelector('#inhalt') || document.querySelector('#shopcomponent');
        if(!anchor || anchor.querySelector('.oih_panel')) return false;

        const items = readInventory();
        if(!items.length) return false; // shop content not rendered yet — observer will retry

        injectStyle();
        if(getComputedStyle(anchor).position === 'static') anchor.style.position = 'relative';

        // pgItem in the URL = we arrived from a "next planet" click; reopen focused on it.
        const requestedUuid = new URLSearchParams(HREF.split('?')[1] || '').get('pgItem') || '';
        const openState = !!requestedUuid || sessionStorage.getItem('oih_open') === '1';

        const toggle = el('div', 'oih_toggle' + (openState ? ' oih_hidden' : ''), anchor,
            '<span class="oih_ico">&#9670;</span><span>Item helper</span>');

        const panel = el('div', 'oih_panel' + (openState ? '' : ' oih_hidden'), anchor);
        const head = el('div', 'oih_head', panel);
        el('div', 'oih_title', head, 'Inventario');
        const search = el('input', null, head);
        search.type = 'text';
        search.placeholder = 'Cerca per nome...';
        const count = el('div', 'oih_count', head, items.length + ' tipi');
        const close = el('div', 'oih_close', head, '&times;');

        const grid = el('div', 'oih_grid', panel);
        el('div', 'oih_hint', panel,
            'Attiva apre il pannello dell’item nel gioco: sei tu a premere Attiva/Prolunga (un clic = un’azione). "Pianeta succ." apre lo stesso item sul pianeta seguente.');

        const setOpen = show =>
        {
            panel.classList.toggle('oih_hidden', !show);
            toggle.classList.toggle('oih_hidden', show);
            sessionStorage.setItem('oih_open', show ? '1' : '0');
            if(show) search.focus();
        };
        toggle.addEventListener('click', () => setOpen(true));
        close.addEventListener('click', () => setOpen(false));

        const nextPlanet = getNextPlanet();

        const render = filter =>
        {
            const needle = (filter || '').trim().toLowerCase();
            grid.innerHTML = '';
            const visible = items.filter(it => !needle || it.name.toLowerCase().indexOf(needle) >= 0);
            count.textContent = visible.length + '/' + items.length;

            if(!visible.length)
            {
                el('div', 'oih_empty', grid, 'Nessun item trovato.');
                return;
            }

            visible.forEach(it =>
            {
                const card = el('div', 'oih_card', grid);
                const thumb = el('div', 'oih_thumb' + (it.rarity ? ' oih_r_' + it.rarity : ''), card);
                if(it.image) thumb.style.backgroundImage = `url('${it.image}')`;

                const info = el('div', 'oih_info', card);
                const name = el('div', 'oih_name', info, it.name);
                name.title = it.effect || it.name;
                const meta = el('div', 'oih_meta', info);
                if(it.amount) el('span', 'oih_amount', meta, 'x' + it.amount);
                const pct = (it.effect || '').match(/[+-]?\d+\s*%/);
                if(pct) el('span', 'oih_pct', meta, pct[0].replace(/\s+/g, ''));

                const actions = el('div', 'oih_actions', card);

                // ACTIVATE — opens the game's own item panel. Closing our overlay first so the
                // game's panel (which renders in the same top area) is visible and clickable.
                const act = el('div', 'oih_btn oih_activate', actions, 'Attiva');
                act.addEventListener('click', () =>
                {
                    sessionStorage.setItem('oih_filter', search.value || '');
                    setOpen(false);
                    openNativeItem(it.uuid);
                });

                // NEXT PLANET — real navigation (one click = one planet change via the game's
                // own cp flow). pgItem reopens the panel focused on this item on arrival.
                if(nextPlanet)
                {
                    const link = el('a', 'oih_btn oih_next', actions, 'Pianeta »');
                    link.title = 'Vai al pianeta successivo con questo item pronto' + (nextPlanet.coords ? ` (${nextPlanet.coords})` : '');
                    link.href = `https://${window.location.host}/game/index.php?page=ingame&component=shop&cp=${nextPlanet.id}&pgItem=${encodeURIComponent(it.uuid)}`;
                }
            });
        };

        let initialFilter = '';
        if(requestedUuid)
        {
            const m = items.find(it => it.uuid === requestedUuid);
            if(m) initialFilter = m.name;
        }
        if(!initialFilter && openState) initialFilter = sessionStorage.getItem('oih_filter') || '';

        search.value = initialFilter;
        search.addEventListener('input', () => render(search.value));
        render(initialFilter);
        if(openState) requestAnimationFrame(() => search.focus());

        return true;
    }

    // --------------------------------------------------------------------- start
    function start()
    {
        try
        {
            if(build()) return;
            const target = document.querySelector('#planet') || document.querySelector('#inhalt') || document.body;
            if(!target) return;
            const obs = new MutationObserver(() => { if(build()) obs.disconnect(); });
            obs.observe(target, { childList: true, subtree: true });
            // Local cleanup only (no server call): stop watching once the page has settled.
            setTimeout(() => obs.disconnect(), 15000);
        }
        catch(e) { console.error('[OGItemHelper] failed:', e); }
    }

    start();
})();
