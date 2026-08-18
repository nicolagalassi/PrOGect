// ==UserScript==
// @name         OGame Item Activation Helper
// @namespace    https://github.com/nicolagalassi/progect
// @version      0.1.0
// @description  A searchable inventory overview on the shop page, with a compliant activation flow: one click = one activation, and a "next planet" jump that pre-selects the same item ready to activate. Standalone companion to PrOGect.
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
  Activating an item (e.g. a +10% metal booster) on every planet is one of the most
  tedious loops in OGame: open the inventory, filter by broad type, scroll a wall of
  items with NO name search, click activate, get bounced back to the Shop tab, then
  repeat the whole thing on the next planet. This helper collapses the *finding* while
  leaving the *activating* exactly where the game puts it.

  WHAT IT DOES
  - On the shop page it reads the inventory the page already loaded and shows a compact,
    searchable overview (small thumbnails, name, amount, duration/percent) with a real
    "search by name" box the game itself does not offer.
  - "Attiva" on a card forwards your single click to the game's OWN activation control,
    and remembers your search so a second click re-activates the same item (the compliant
    way to stack activations and extend a buff — one click each, never a loop).
  - "Pianeta succ." is a normal navigation link to the next planet's shop with the same
    item pre-selected, so it is right there to activate again.

  COMPLIANCE (OGame Origin tool rules — see PrOGect/AGENTS.md):
  - §1.1  1 click = 1 action. Nothing here fires a game action on its own. Every activation
          waits for the player's own click on the game's native control; we never auto-click
          on load and never loop.
  - §1.3/§4  No auto-refresh, no polling, no timers hitting the server. We only READ the DOM
          the shop page already loaded; a MutationObserver (DOM only, no network) picks up the
          inventory if the game renders its tab lazily.
  - §4.2  No background `cp` calls. Planet switching is a real <a> navigation the player clicks.
  - §6    We call NO activation endpoint or game function ourselves — we forward the click to
          the game's own inventory control.
  - §1.7  The shop image, ads and Shop menu are never hidden, resized, moved or swapped. The
          overview is an on-demand overlay that starts collapsed and restores the shop view
          completely when closed.
  - §3    This is a comfort feature that touches the shop UI/flow → GRAY AREA: it needs a
          ToolDev sign-off on the OGame Origin forum before publishing. The DOM selectors for
          the inventory tiles carry v13/v12 fallbacks and may need tuning against a live page.
  - §5    Because it runs inside the OGame page it needs toleration before public distribution.
*/

(function()
{
    'use strict';

    // Only ever run on the shop page.
    const HREF = window.location.href;
    const IS_SHOP = HREF.indexOf('component=shop') >= 0 || HREF.indexOf('page=shop') >= 0;
    if(!IS_SHOP) return;

    // ---- styles (injected as a plain <style>, so the script needs no GM grants) ----
    const CSS = `
        .oih_toggle{position:absolute;top:6px;right:10px;z-index:20;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;cursor:pointer;border-radius:3px;font-size:12px;color:#fff;background:linear-gradient(192deg,#252e3a,#171c24 70%);border:1px solid #3a4756;box-shadow:0 1px 4px rgba(0,0,0,.4)}
        .oih_toggle:hover{border-color:#ffb800}
        .oih_toggle .oih_ico{color:#bf6c4d}
        .oih_panel{position:absolute;top:34px;left:8px;right:8px;z-index:19;max-height:250px;display:flex;flex-direction:column;background:linear-gradient(192deg,rgba(37,46,58,.97),rgba(23,28,36,.97));border:1px solid #3a4756;border-radius:4px;box-shadow:0 4px 18px rgba(0,0,0,.55);padding:8px;box-sizing:border-box}
        .oih_hidden{display:none !important}
        .oih_head{display:flex;align-items:center;gap:8px;margin-bottom:7px;flex:0 0 auto}
        .oih_title{font-size:12px;color:#bf6c4d;font-weight:bold;display:flex;align-items:center;gap:4px;white-space:nowrap}
        .oih_head input{flex:1;min-width:60px;padding:4px 8px;border-radius:3px;border:1px solid #3a4756;background:#0e131a;color:#fff;font-size:12px}
        .oih_head input:focus{outline:none;border-color:#ffb800}
        .oih_close{cursor:pointer;color:#9aa7b4;font-size:18px;line-height:1;padding:0 2px}
        .oih_close:hover{color:#f9392b}
        .oih_grid{flex:1 1 auto;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:6px;padding-right:2px}
        .oih_card{position:relative;display:flex;gap:6px;align-items:center;padding:5px;border-radius:3px;background:rgba(14,19,26,.7);border:1px solid #2b3542}
        .oih_card:hover{border-color:#4a5a6c}
        .oih_thumb{width:34px;height:34px;flex:0 0 auto;border-radius:3px;background-size:cover;background-position:center;background-repeat:no-repeat;background-color:#0b0f14}
        .oih_info{flex:1 1 auto;min-width:0}
        .oih_name{font-size:11px;color:#e6ecf2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .oih_meta{font-size:10px;color:#8aa0b2;display:flex;gap:5px;margin-top:2px}
        .oih_amount{color:#ffb800}
        .oih_actions{display:flex;flex-direction:column;gap:3px;flex:0 0 auto}
        .oih_btn{cursor:pointer;font-size:10px;padding:2px 6px;border-radius:3px;border:1px solid #3a4756;background:linear-gradient(192deg,#252e3a,#171c24 70%);color:#fff;text-align:center;text-decoration:none;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:2px}
        .oih_btn:hover{border-color:#ffb800}
        .oih_btn.oih_activate{color:#bfeecf}
        .oih_btn.oih_next{color:#9ec7ff}
        .oih_empty{color:#8aa0b2;font-size:12px;padding:14px;text-align:center}
        .oih_hint{flex:0 0 auto;margin-top:6px;font-size:10px;color:#6f7f8d;line-height:1.35}
    `;

    function injectStyle()
    {
        if(document.getElementById('oih_style')) return;
        const style = document.createElement('style');
        style.id = 'oih_style';
        style.textContent = CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    // ---------------------------------------------------------------------------
    // Planet list — built from the game's own planet sidebar. The "next planet"
    // link uses the game's `cp` navigation exactly like clicking a planet does.
    // ---------------------------------------------------------------------------
    function getPlanets()
    {
        const planets = [];
        document.querySelectorAll('.smallplanet').forEach(line =>
        {
            const link = line.querySelector('.planetlink') || line.querySelector('a[href*="cp="]');
            if(!link) return;
            const href = link.getAttribute('href') || '';
            const id = new URLSearchParams(href.split('?')[1] || '').get('cp')?.split('#')[0];
            if(!id) return;
            const koords = line.querySelector('.planet-koords, [class*="koords"], [class*="coords"]');
            planets.push({
                id,
                coords: koords ? koords.textContent.replace(/[\[\]]/g, '').trim() : '',
                isCurrent: line.classList.contains('hightlightPlanet') || line.classList.contains('hightlightMoon'),
            });
        });
        return planets;
    }

    function getNextPlanet(planets)
    {
        if(planets.length < 2) return null;
        const idx = planets.findIndex(p => p.isCurrent);
        return planets[(idx + 1) % planets.length];
    }

    // ---------------------------------------------------------------------------
    // Inventory scraping — read only, no fetch. Returns one entry per item type.
    // ---------------------------------------------------------------------------
    function scrapeInventoryItems()
    {
        // v13/v12 compat: inventory tiles carry a uuid (data-uuid) or a ref hash.
        // We search the whole shop content, including hidden tab panels, so the data
        // is available even when the Inventory tab is not the visible one.
        const scope = document.querySelector('#inventory')
            || document.querySelector('#content')
            || document.querySelector('#contentWrapper')
            || document;

        const nodes = scope.querySelectorAll('[data-uuid], .item-grid .element, li.ownage[ref], [ref].thumbnail, .items .item');
        const byUuid = {};

        nodes.forEach(el =>
        {
            const uuid = el.getAttribute('data-uuid') || el.getAttribute('ref') || (el.dataset && el.dataset.itemId);
            if(!uuid || byUuid[uuid]) return;

            const img = el.querySelector('img');
            let image = (img && img.getAttribute('src')) || '';
            if(!image)
            {
                const bg = getComputedStyle(el).backgroundImage;
                const m = bg && bg.match(/url\(["']?(.*?)["']?\)/);
                if(m) image = m[1];
            }

            let name = el.getAttribute('data-title') || el.getAttribute('title')
                || (img && (img.getAttribute('alt') || img.getAttribute('title'))) || '';
            if(name.indexOf('<') >= 0)
            {
                const tmp = document.createElement('div');
                tmp.innerHTML = name;
                name = (tmp.querySelector('.ecke, .text, h3, b')?.textContent || tmp.textContent || '').trim();
            }
            name = name.replace(/\s+/g, ' ').trim() || 'Item';

            const amount = ((el.querySelector('.amount, .quantity, .empire_number')?.textContent) || el.getAttribute('data-amount') || '').replace(/[^\d]/g, '');
            const duration = (el.querySelector('.duration, .time')?.textContent || '').trim();
            const pct = name.match(/[+-]?\d+%/);
            const badge = duration || (pct ? pct[0] : '');

            byUuid[uuid] = { uuid, name, image, amount, badge };
        });

        return Object.values(byUuid);
    }

    // Forward one user click to the game's OWN inventory control for this item.
    // We never call an activation endpoint or game function ourselves (§6) and never
    // fire more than the single click the player just made (§1.1). If we cannot reach
    // the native control, we surface the game's Inventory tab instead of faking anything.
    function activateNativeItem(uuid)
    {
        const scope = document.querySelector('#inventory') || document.querySelector('#content') || document;
        const native = scope.querySelector(`[data-uuid="${uuid}"]`) || scope.querySelector(`[ref="${uuid}"]`);

        if(!native)
        {
            const invTab = document.querySelector('a[href*="inventory"], .ui-tabs-nav a[href*="inventory"]');
            if(invTab) invTab.click();
            return;
        }

        const clickable = native.querySelector('.activate, .js_activate, a, button') || native;
        clickable.click();
    }

    // ---------------------------------------------------------------------------
    // UI
    // ---------------------------------------------------------------------------
    function build()
    {
        // Anchor the overlay to the game's own content wrapper so it uses the shop-image
        // space WITHOUT touching the shop image itself (§1.7).
        const anchor = document.querySelector('#inventory')?.closest('#content, #contentWrapper, #middle')
            || document.querySelector('#content')
            || document.querySelector('#contentWrapper')
            || document.querySelector('#middle');
        if(!anchor || anchor.querySelector('.oih_panel')) return false;

        const items = scrapeInventoryItems();
        // If the inventory has not been rendered into the DOM yet, wait for it instead of
        // guessing — the MutationObserver in start() will call build() again.
        if(!items.length && !document.querySelector('#inventory')) return false;

        injectStyle();
        if(getComputedStyle(anchor).position === 'static') anchor.style.position = 'relative';

        // pgItem in the URL means we just arrived from a "next planet" click and should
        // reopen focused on that item, READY to activate. We never auto-activate (§1.1).
        const requestedUuid = new URLSearchParams(HREF.split('?')[1] || '').get('pgItem') || '';
        const openState = !!requestedUuid || sessionStorage.getItem('oih_open') === '1';

        const el = (tag, cls, parent, html) =>
        {
            const n = document.createElement(tag);
            if(cls) n.className = cls;
            if(html != null) n.innerHTML = html;
            if(parent) parent.appendChild(n);
            return n;
        };

        const toggle = el('div', 'oih_toggle' + (openState ? ' oih_hidden' : ''), anchor,
            '<span class="oih_ico">&#9670;</span><span>Item helper</span>');

        const panel = el('div', 'oih_panel' + (openState ? '' : ' oih_hidden'), anchor);
        const head = el('div', 'oih_head', panel);
        el('div', 'oih_title', head, '&#9670; Inventario');
        const search = el('input', null, head);
        search.type = 'text';
        search.placeholder = 'Cerca per nome...';
        const close = el('div', 'oih_close', head, '&times;');

        const grid = el('div', 'oih_grid', panel);
        el('div', 'oih_hint', panel,
            'Attiva = un clic = un’attivazione (nessun automatismo). "Pianeta succ." apre lo stesso item sul pianeta seguente, pronto da attivare.');

        const open = show =>
        {
            panel.classList.toggle('oih_hidden', !show);
            toggle.classList.toggle('oih_hidden', show);
            sessionStorage.setItem('oih_open', show ? '1' : '0');
            if(show) search.focus();
        };
        toggle.addEventListener('click', () => open(true));
        close.addEventListener('click', () => open(false));

        const planets = getPlanets();
        const nextPlanet = getNextPlanet(planets);

        const render = filter =>
        {
            const needle = (filter || '').trim().toLowerCase();
            grid.innerHTML = '';
            const visible = items.filter(it => !needle || it.name.toLowerCase().indexOf(needle) >= 0);

            if(!visible.length)
            {
                el('div', 'oih_empty', grid, items.length ? 'Nessun item trovato.' : 'Inventario non rilevato su questa pagina.');
                return;
            }

            visible.forEach(it =>
            {
                const card = el('div', 'oih_card', grid);
                const thumb = el('div', 'oih_thumb', card);
                if(it.image) thumb.style.backgroundImage = `url('${it.image}')`;

                const info = el('div', 'oih_info', card);
                const name = el('div', 'oih_name', info, it.name);
                name.title = it.name;
                const meta = el('div', 'oih_meta', info);
                if(it.amount) el('span', 'oih_amount', meta, 'x' + it.amount);
                if(it.badge) el('span', null, meta, it.badge);

                const actions = el('div', 'oih_actions', card);

                // ACTIVATE — forwards THIS single user click to the game's own control.
                // Remembers the search so a second click re-activates the same item.
                const act = el('div', 'oih_btn oih_activate', actions, 'Attiva');
                act.addEventListener('click', () =>
                {
                    sessionStorage.setItem('oih_filter', search.value || '');
                    activateNativeItem(it.uuid);
                });

                // NEXT PLANET — real navigation (one click = one planet change via the
                // game's own cp flow, never a background call). pgItem reopens the panel
                // focused on the same item on arrival.
                if(nextPlanet)
                {
                    const link = el('a', 'oih_btn oih_next', actions, 'Pianeta succ. ›');
                    link.title = 'Vai al pianeta successivo con questo item pronto' + (nextPlanet.coords ? ` (${nextPlanet.coords})` : '');
                    link.href = `https://${window.location.host}/game/index.php?page=ingame&component=shop&cp=${nextPlanet.id}&pgItem=${encodeURIComponent(it.uuid)}`;
                }
            });
        };

        // Initial filter: from the just-clicked item (pgItem) or the persisted "repeat" filter.
        let initialFilter = '';
        if(requestedUuid)
        {
            const match = items.find(it => it.uuid === requestedUuid);
            if(match) initialFilter = match.name;
        }
        if(!initialFilter && openState) initialFilter = sessionStorage.getItem('oih_filter') || '';

        search.value = initialFilter;
        search.addEventListener('input', () => render(search.value));
        render(initialFilter);
        if(openState) requestAnimationFrame(() => search.focus());

        return true;
    }

    // ---------------------------------------------------------------------------
    // Start — try once now; if the inventory renders later (lazy tab), a DOM-only
    // observer builds it when the tiles appear. No timers, no network (§4/§1.3).
    // ---------------------------------------------------------------------------
    function start()
    {
        try
        {
            if(build()) return;

            const target = document.querySelector('#content') || document.querySelector('#contentWrapper') || document.body;
            if(!target) return;

            const observer = new MutationObserver(() =>
            {
                if(build()) observer.disconnect();
            });
            observer.observe(target, { childList: true, subtree: true });

            // Safety: stop observing after the page has clearly settled, so the observer
            // never lingers. This is a local cleanup timer — it makes NO server call.
            setTimeout(() => observer.disconnect(), 15000);
        }
        catch(e)
        {
            console.error('[OGItemHelper] failed:', e);
        }
    }

    start();
})();
