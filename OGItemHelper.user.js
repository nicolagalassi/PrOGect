// ==UserScript==
// @name         OGame Item Activation Helper
// @namespace    https://github.com/nicolagalassi/progect
// @version      0.4.0
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
  - "Attiva" (or "Prolunga" when the item is already active and extendable) opens the game's
    OWN item panel for that item. You press the game's button — that is the one game action.
  - "Pianeta succ." navigates to the next planet's shop (the game's own cp flow) and re-opens
    the box focused on the SAME item, ready to activate.

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

    // --------------------------------------------------------------------- styles
    const CSS = `
        .oih_box{margin:6px 8px 10px;padding:8px;border:1px solid #3a4756;border-radius:4px;background:linear-gradient(192deg,rgba(37,46,58,.6),rgba(20,25,32,.6));box-sizing:border-box}
        .oih_head{display:flex;align-items:center;gap:8px;margin-bottom:7px}
        .oih_title{font-size:12px;color:#f0a955;font-weight:bold;white-space:nowrap;display:flex;align-items:center;gap:4px}
        .oih_head input{flex:1;min-width:60px;padding:4px 8px;border-radius:3px;border:1px solid #3a4756;background:#0e131a;color:#fff;font-size:12px}
        .oih_head input:focus{outline:none;border-color:#ffb800}
        .oih_count{font-size:11px;color:#7c8b99;white-space:nowrap}
        .oih_collapse{cursor:pointer;color:#9aa7b4;font-size:14px;line-height:1;padding:2px 4px;user-select:none}
        .oih_collapse:hover{color:#ffb800}
        .oih_grid{max-height:240px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:6px;padding-right:2px}
        .oih_grid.oih_hidden{display:none}
        .oih_card{position:relative;display:flex;gap:7px;align-items:center;padding:5px;border-radius:3px;background:rgba(14,19,26,.75);border:1px solid #2b3542}
        .oih_card:hover{border-color:#4a5a6c}
        .oih_card.oih_on{border-color:#3f8f5f;background:rgba(20,34,26,.8)}
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
        .oih_btn.oih_next{color:#9ec7ff}
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
        const g = Math.floor(sec / 86400); sec -= g * 86400;
        const o = Math.floor(sec / 3600); sec -= o * 3600;
        const m = Math.floor(sec / 60);
        const p = [];
        if(g) p.push(g + 'g');
        if(o) p.push(o + 'o');
        if(m && !g) p.push(m + 'm');
        return p.join(' ') || '<1m';
    };

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
    // Primary source: the game's own inventoryObj.items_inventory (also carries the per-planet
    // active state: status / timeLeft / extendable). Fallback: the inventory tile DOM.
    function readInventory()
    {
        const out = [];
        const seen = {};

        const obj = PAGE.inventoryObj;
        if(obj && Array.isArray(obj.items_inventory) && obj.items_inventory.length)
        {
            obj.items_inventory.forEach(it =>
            {
                if(!it || !it.ref || !(it.amount > 0) || it.expiryDate) return; // owned stacks only
                if(seen[it.ref]) return;
                seen[it.ref] = 1;
                const hash = it.imageLarge || it.image || '';
                const active = it.status === 'effecting' || (it.timeLeft > 0);
                out.push({
                    uuid: it.ref,
                    name: (it.name || 'Item').trim(),
                    amount: it.amount,
                    image: hash ? `/cdn/img/item-images/${hash}.png` : '',
                    effect: stripTags(it.effect || ''),
                    rarity: (it.rarity || '').toLowerCase(),
                    active,
                    timeLeft: active ? (it.timeLeft || 0) : 0,
                    extendable: !!it.extendable,
                });
            });
            if(out.length) return out;
        }

        // Fallback: scrape the tiles.
        document.querySelectorAll('#js_inventorySlider a.detail_button[ref], a.detail_button[ref]').forEach(a =>
        {
            const uuid = a.getAttribute('ref');
            if(!uuid || uuid === 'ffffffffffffffffffffffffffffffffffffffff' || seen[uuid]) return;
            seen[uuid] = 1;
            const parts = (a.getAttribute('data-tooltip-title') || '').split('|');
            const name = stripTags(parts[0] || 'Item');
            const effect = stripTags((parts[1] || '').split('<br')[0]);
            const amount = (a.querySelector('.ecke .amount, .amount')?.textContent || '').replace(/[^\d]/g, '');
            const box = a.closest('.item_img');
            let image = '';
            if(box)
            {
                const m = getComputedStyle(box).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
                if(m) image = m[1];
            }
            const activeEl = box && box.querySelector('.activation.js_is_active');
            const timeText = box && box.querySelector('.countdownHolder time')?.textContent;
            out.push({ uuid, name, amount: amount ? +amount : '', image, effect, rarity: '', active: !!activeEl, timeLeft: 0, timeText: timeText || '', extendable: false });
        });
        return out;
    }

    // Open the game's OWN item panel. We never activate anything ourselves (§1.1/§6).
    function openNativeItem(uuid)
    {
        const invTab = document.querySelector('.tabSelectionTab.inventoryTab');
        if(invTab && !invTab.classList.contains('active')) invTab.click();
        const tile = document.querySelector(`a.detail_button[ref="${uuid}"]`);
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

        const items = readInventory();
        if(!items.length) return false; // shop content not rendered yet — observer will retry

        injectStyle();

        const box = document.createElement('div');
        box.className = 'oih_box';
        parent.insertBefore(box, insertBefore);

        const head = el('div', 'oih_head', box);
        el('div', 'oih_title', head, '<span>&#9670;</span> Item helper');
        const search = el('input', null, head);
        search.type = 'text';
        search.placeholder = 'Cerca per nome...';
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

        const render = filter =>
        {
            const needle = (filter || '').trim().toLowerCase();
            grid.innerHTML = '';
            const visible = items.filter(it => !needle || it.name.toLowerCase().indexOf(needle) >= 0);
            count.textContent = visible.length + '/' + items.length;

            if(!visible.length) { el('div', 'oih_empty', grid, 'Nessun item trovato.'); return; }

            // Active items first, so what is running on this planet is obvious.
            visible.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));

            visible.forEach(it =>
            {
                const card = el('div', 'oih_card' + (it.active ? ' oih_on' : ''), grid);
                const thumb = el('div', 'oih_thumb' + (it.rarity ? ' oih_r_' + it.rarity : ''), card);
                if(it.image) thumb.style.backgroundImage = `url('${it.image}')`;

                const info = el('div', 'oih_info', card);
                const name = el('div', 'oih_name', info, it.name);
                name.title = it.effect || it.name;
                const meta = el('div', 'oih_meta', info);
                if(it.amount) el('span', 'oih_amount', meta, 'x' + it.amount);
                const pct = (it.effect || '').match(/[+-]?\d+\s*%/);
                if(pct) el('span', 'oih_pct', meta, pct[0].replace(/\s+/g, ''));
                if(it.active) el('span', 'oih_live', meta, 'attivo' + (it.timeLeft ? ' ' + fmtDur(it.timeLeft) : (it.timeText ? ' ' + it.timeText : '')));

                const actions = el('div', 'oih_actions', card);
                const extend = it.active && it.extendable;
                const act = el('div', 'oih_btn ' + (extend ? 'oih_extend' : 'oih_activate'), actions, extend ? 'Prolunga' : 'Attiva');
                act.addEventListener('click', () =>
                {
                    sessionStorage.setItem('oih_filter', search.value || '');
                    openNativeItem(it.uuid);
                });

                if(nextPlanet)
                {
                    const link = el('a', 'oih_btn oih_next', actions, 'Pianeta »');
                    link.title = 'Vai al pianeta successivo con questo item pronto' + (nextPlanet.coords ? ` (${nextPlanet.coords})` : '');
                    link.href = `https://${window.location.host}/game/index.php?page=ingame&component=shop&cp=${nextPlanet.id}&pgItem=${encodeURIComponent(it.uuid)}`;
                    // OGame's cp handling can redirect and drop the query string, so stash the
                    // wanted item in sessionStorage (survives the navigation) as well.
                    link.addEventListener('click', () =>
                    {
                        sessionStorage.setItem('oih_pending', it.uuid);
                        sessionStorage.setItem('oih_pendingName', it.name);
                    });
                }
            });
        };

        // On arrival, focus on the item we carried over (URL pgItem, or the sessionStorage
        // stash that survives OGame's cp redirect). We only pre-filter — never auto-activate.
        let initialFilter = '';
        const wantedUuid = new URLSearchParams(HREF.split('?')[1] || '').get('pgItem') || sessionStorage.getItem('oih_pending') || '';
        const wantedName = sessionStorage.getItem('oih_pendingName') || '';
        if(wantedUuid)
        {
            const m = items.find(it => it.uuid === wantedUuid);
            initialFilter = m ? m.name : wantedName;
            sessionStorage.removeItem('oih_pending');
            sessionStorage.removeItem('oih_pendingName');
            if(sessionStorage.getItem('oih_collapsed') === '1') { grid.classList.remove('oih_hidden'); caret.innerHTML = '&#9662;'; }
        }

        search.value = initialFilter;
        search.addEventListener('input', () => render(search.value));
        render(initialFilter);
        if(initialFilter) requestAnimationFrame(() => search.focus());

        return true;
    }

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
