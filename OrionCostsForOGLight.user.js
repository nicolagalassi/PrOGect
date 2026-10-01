// ==UserScript==
// @name         Orion Costs for OGLight
// @namespace    https://github.com/nicolagalassi
// @version      0.2.0
// @description  Add-on for OGLight: fills in the cost of buildings and researches OGLight does not know yet (Project Orion: Interstellar Anomaly Scanner and its researches), reading the price the game itself puts on the page. Display only.
// @author       nicolagalassi
// @match        https://*.ogame.gameforge.com/game/*
// @icon         https://gf1.geo.gfsrv.net/cdn3d/favicon.ico
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/*
  Orion Costs for OGLight — a small add-on that runs NEXT TO OGLight.

  THE PROBLEM
  OGLight replaces the game's cost box in the technology panel (#technologydetails) with its own
  (.ogl_costsWrapper). It does not read the price from the page: it computes it from a table of base
  costs baked into the script (class Datafinder). A technology that is not in that table — the new
  Project Orion building "Interstellar Anomaly Scanner" and its researches — gets base cost 0, so
  OGLight shows 0 metal / 0 crystal / 0 deuterium and drops the build time.

  On the Orion CONTROL CENTER (component=orion, tab "Centro controllo", techs 4001-4007) it is worse:
  the panel is loaded later, inside a tab, so OGLight's script never draws its cost box there — but
  OGLight's stylesheet still hides the game's own cost list. The player sees no price at all.

  WHY WE DO NOT PATCH OGLIGHT'S TABLE
  OGLight runs in its own userscript sandbox; another script cannot reach its Datafinder class.
  And the Orion formulas are not published yet (the public test started 30 Sep 2026): hard-coding
  guessed base costs/factors would print wrong numbers with a straight face.

  WHAT THIS ADD-ON DOES INSTEAD
  0. Where OGLight drew no cost box at all (the control center), we just un-hide the game's own
     cost list — only if something actually hides it, so without OGLight nothing changes.
  1. The game still puts the REAL price of the next level in the panel — OGLight only hides that
     list with CSS (.costs .ipiHintable). We read it from there. It is exact: it already includes
     every cost reduction the player has, because the server computed it.
  2. We detect "OGLight doesn't know this tech" generically: the game shows a price > 0 while every
     OGLight cost cell reads 0. No list of IDs, so it also covers future techs, and it stays out of
     the way for every tech OGLight already handles.
  3. We write the real numbers into OGLight's own cells (cost / cumulative / missing-on-planet), and
     put back the build time the game showed, which OGLight removed.
  4. OGLight's ‹ › arrows show other levels. For those we need a formula. Each time the player opens
     the panel we remember (in localStorage) the price the game showed for that level. Once two
     different levels of the same tech have been seen, we estimate the growth factor per resource
     (cost(L) = cost(L0) * f^(L - L0), the standard OGame shape) and use it, marked with "~".
     Until then other levels show "?". If the formula turns out to be published, it can be typed
     into MANUAL_FORMULAS below and wins over the estimate.

  COMPLIANCE (OGame Origin tool rules — see AGENTS.md):
  - §1.1/§1.2  Display only. It never builds, queues or clicks anything; no game action at all.
  - §1.3/§4    NO network request of any kind. It reads only the panel the player opened by clicking.
               The MutationObserver watches the DOM only; it never talks to the server.
  - §4.2       No cp=, no planet switching.
  - §1.6       Shows prices; it does not add any queue (no Commander imitation).
  - §1.7       Touches only the technology panel's cost rows; ads, banners, footer, Merchant,
               Officers and Shop are never touched.
  - §1.9       Nothing leaves the machine: the observed prices stay in this browser's localStorage.
  - §5         Runs inside the OGame page → needs toleration before public distribution, like any
               userscript. (It also modifies another tool's display; mention that in the submission.)
*/

(function()
{
    'use strict';

    // Formulas typed in by hand, once they are known for certain (e.g. confirmed by the game data or a
    // ToolDev). Key = technology id as the game uses it (data-technology on the building tile).
    // cost(level) = base * factor^(level - 1). Left empty on purpose: we do not guess. Example shape:
    //   12345: { metal:84, crystal:42, deut:14, factor:1.5 },
    const MANUAL_FORMULAS =
    {
    };

    const STORAGE_KEY = 'oglOrionCosts_v1';
    const RESOURCES = ['metal', 'crystal', 'deut', 'energy'];
    const GAME_CLASS = { metal:'metal', crystal:'crystal', deut:'deuterium', energy:'energy' };

    // Ids where OGLight was seen showing 0 for a priced tech. Kept for this page so that its other levels
    // (where the game price is not on the page) are filled in too.
    const unknownToOGLight = new Set();
    // Build time the game showed, captured before OGLight wipes the list (it does so in a later frame).
    const gameDuration = {};

    // ---------- storage (local only, §1.9) ----------

    const loadStore = () =>
    {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
        catch(e) { return {}; }
    };

    const saveStore = store =>
    {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
        catch(e) { /* private window / blocked storage: the current-level fix still works */ }
    };

    // ---------- reading the game's own data from the page ----------

    const parseNumber = text => parseInt(String(text || '').replace(/[^\d-]/g, ''), 10) || 0;

    // The price the GAME put in the panel (the list OGLight hides with CSS).
    const readGameCosts = panel =>
    {
        const costs = {};
        let any = false;

        RESOURCES.forEach(resource =>
        {
            const li = panel.querySelector(`.costs .ipiHintable .${GAME_CLASS[resource]}`)
                || panel.querySelector(`.costs li.${GAME_CLASS[resource]}`);
            if(!li) return;

            const value = li.hasAttribute('data-value') ? parseNumber(li.getAttribute('data-value')) : parseNumber(li.textContent);
            costs[resource] = value;
            if(value > 0) any = true;
        });

        return any ? costs : null;
    };

    // Same arithmetic OGLight uses to label the level whose price the game shows, so the numbers line up.
    const readGameLevel = (panel, id) =>
    {
        let level = parseNumber(panel.querySelector('.information .level')?.getAttribute('data-value'));
        const target = document.querySelector(`#technologies .technology[data-technology="${id}"] .targetlevel`);
        if(target && parseNumber(target.getAttribute('data-value')) >= level) level += 1;
        return level;
    };

    const planetResource = resource =>
    {
        const el = document.querySelector(`#resources_${GAME_CLASS[resource]}`);
        if(!el) return null;
        return el.hasAttribute('data-raw') ? parseFloat(el.getAttribute('data-raw')) : parseNumber(el.textContent);
    };

    // ---------- formula: manual > estimated from two observed levels > unknown ----------

    // Geometric fit using the two observed levels furthest apart (the game floors prices, so a wider gap
    // gives a steadier factor). Returns null when fewer than two levels have been seen.
    const estimate = (observed, resource) =>
    {
        const levels = Object.keys(observed).map(Number).filter(l => observed[l][resource] > 0).sort((a, b) => a - b);
        if(levels.length < 2) return null;

        const lo = levels[0];
        const hi = levels[levels.length - 1];
        const factor = Math.pow(observed[hi][resource] / observed[lo][resource], 1 / (hi - lo));

        return { refLevel:hi, refCost:observed[hi][resource], factor:factor };
    };

    // { value, exact } for one resource at one level, or null when we cannot know it.
    const costAt = (id, level, resource, store) =>
    {
        const observed = store[id] || {};

        if(observed[level] && resource in observed[level]) return { value:observed[level][resource], exact:true };

        const manual = MANUAL_FORMULAS[id];
        if(manual) return { value:Math.floor((manual[resource] || 0) * Math.pow(manual.factor, level - 1)), exact:true };

        // a resource the tech never cost at any observed level stays at 0
        const seen = Object.values(observed);
        if(seen.length && seen.every(c => !c[resource])) return { value:0, exact:true };

        const fit = estimate(observed, resource);
        if(!fit) return null;

        return { value:Math.floor(fit.refCost * Math.pow(fit.factor, level - fit.refLevel)), exact:false };
    };

    // ---------- writing into OGLight's cost rows ----------

    const formatShort = value =>
    {
        const abs = Math.abs(value);
        const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']];

        for(const [size, suffix] of units)
        {
            if(abs >= size) return (value / size).toFixed(abs >= 1e6 ? 2 : 1).replace(/\.?0+$/, '') + suffix;
        }

        return String(Math.round(value));
    };

    const formatFull = value => Math.round(value).toLocaleString('de-DE');

    const setCell = (cell, value, exact) =>
    {
        if(!cell) return;
        cell.textContent = value == null ? '?' : (exact ? '' : '~') + formatShort(value);
        cell.setAttribute('title', value == null
            ? 'Orion Costs for OGLight: open the panel at two different levels to estimate this'
            : (exact ? '' : 'Estimated from the levels seen so far: ') + formatFull(value));
        cell.classList.add('oglOrion_patched');
    };

    // The cells OGLight drew for one resource row: [cost, cumulative, missing-or-check].
    const rowCells = (wrapper, resource) =>
    {
        const row = wrapper.querySelector(`.ogl_icon.ogl_${resource}`);
        return row ? Array.from(row.children) : null;
    };

    const oglightShowsZero = wrapper =>
    {
        let rows = 0;

        for(const resource of ['metal', 'crystal', 'deut'])
        {
            const cells = rowCells(wrapper, resource);
            if(!cells || !cells[0]) continue;
            rows++;
            if(cells[0].classList.contains('oglOrion_patched')) return true; // already ours from a previous level
            if(parseNumber(cells[0].textContent) !== 0) return false;
        }

        return rows > 0;
    };

    // OGLight's header row: [icon, level-or-amount, "from → to" (level mode only), globe]
    const readDisplayed = wrapper =>
    {
        const header = wrapper.querySelector('.ogl_icon');
        if(!header) return null;

        const cells = Array.from(header.children);
        const shown = parseNumber(cells[1]?.textContent);
        const range = cells.length >= 4 ? cells[2].textContent.match(/(-?\d+)\D+(-?\d+)/) : null;

        return range ? { mode:'level', level:shown, from:parseInt(range[1], 10), to:parseInt(range[2], 10) } : { mode:'amount', amount:Math.max(shown, 1) };
    };

    // OGLight's stylesheet hides the game's own cost list everywhere (.costs .ipiHintable and the
    // "Required for level N" line), on the assumption that its script draws a replacement. Its script
    // only does that on pages where the game's technologyDetails object exists when OGLight starts.
    // The Orion control center loads its panel later, inside a tab, so there OGLight draws nothing and
    // the player sees no price at all. In that case we simply un-hide the game's list: it is the game's
    // own UI and its own exact numbers. The CSS keeps a :has() guard so the list is hidden again the
    // moment OGLight's wrapper does appear.
    const STYLE = `
        #technologydetails .costs.oglOrion_showGameCosts:not(:has(.ogl_costsWrapper)) > p { display:block !important; }
        #technologydetails .costs.oglOrion_showGameCosts:not(:has(.ogl_costsWrapper)) > ul.ipiHintable { display:flex !important; gap:5px; }
    `;

    const injectStyle = () =>
    {
        if(document.querySelector('#oglOrion_style')) return;
        const style = document.createElement('style');
        style.id = 'oglOrion_style';
        style.textContent = STYLE;
        document.head.appendChild(style);
    };

    const showGameCosts = panel =>
    {
        const costs = panel.querySelector('.costs');
        const list = costs?.querySelector(':scope > ul.ipiHintable');
        if(!list || costs.classList.contains('oglOrion_showGameCosts')) return;

        // only when something (OGLight's CSS) actually hides it: without OGLight the game's layout is untouched
        if(getComputedStyle(list).display !== 'none') return;

        injectStyle();
        costs.classList.add('oglOrion_showGameCosts');
    };

    const patch = panel =>
    {
        const id = parseNumber(panel.querySelector('[data-technology-id]')?.getAttribute('data-technology-id'))
            || parseNumber(document.querySelector('#technologies .technology.showsDetails')?.getAttribute('data-technology'));
        if(!id) return;

        const gameCosts = readGameCosts(panel);
        if(!gameCosts) return;

        const store = loadStore();
        const gameLevel = readGameLevel(panel, id);

        // remember what the game showed, so other levels can be estimated later
        store[id] = store[id] || {};
        store[id][gameLevel] = gameCosts;
        saveStore(store);

        const wrapper = panel.querySelector('.costs .ogl_costsWrapper');

        if(!wrapper)
        {
            showGameCosts(panel);
            return;
        }

        if(!unknownToOGLight.has(id))
        {
            if(!oglightShowsZero(wrapper)) return; // OGLight knows this tech: leave it alone
            unknownToOGLight.add(id);
        }

        const shown = readDisplayed(wrapper);
        if(!shown) return;

        RESOURCES.forEach(resource =>
        {
            const cells = rowCells(wrapper, resource);
            if(!cells) return;

            let cost, total;

            if(shown.mode === 'amount')
            {
                // ships/defence style: the game price is per unit
                cost = { value:(gameCosts[resource] || 0) * shown.amount, exact:true };
                total = null;
            }
            else
            {
                cost = costAt(id, shown.level, resource, store);

                // OGLight shows energy as the requirement of the level, not a sum over the range
                if(resource === 'energy') total = cost;
                else
                {
                    // cumulative over OGLight's "from → to" range (from is the level already owned)
                    total = { value:0, exact:true };
                    for(let l = shown.from + 1; l <= shown.to; l++)
                    {
                        const step = costAt(id, l, resource, store);
                        if(!step) { total = null; break; }
                        total.value += step.value;
                        total.exact = total.exact && step.exact;
                    }
                }
            }

            setCell(cells[0], cost ? cost.value : null, cost ? cost.exact : true);

            if(shown.mode === 'level')
            {
                setCell(cells[1], total ? total.value : null, total ? total.exact : true);
            }

            // last cell: what is missing on this planet, or a check mark — energy is not stocked, skip it
            const last = shown.mode === 'level' ? cells[2] : cells[1];
            const needed = shown.mode === 'level' ? total : cost;
            const have = planetResource(resource);

            if(last && resource !== 'energy' && needed && have != null)
            {
                const diff = have - needed.value;
                last.className = diff < 0 ? 'ogl_danger oglOrion_patched' : 'ogl_ok material-icons oglOrion_patched';
                last.textContent = diff < 0 ? formatShort(diff) : 'check';
                last.setAttribute('title', diff < 0 ? formatFull(diff) : '');
            }
            else if(last && resource !== 'energy' && !needed)
            {
                // unknown price: OGLight's check mark (computed against 0) would be a false "affordable"
                last.className = 'oglOrion_patched';
                last.textContent = '?';
                last.setAttribute('title', '');
            }
        });

        restoreDuration(panel, id);
    };

    // ---------- build time ----------

    // OGLight rebuilds the info list in a requestAnimationFrame and leaves the duration out when its own
    // computed value is 0. The game's value is captured as soon as the panel content arrives (before that
    // frame) and put back as a plain line. Only for the level the game priced: we do not estimate times.
    const captureDuration = panel =>
    {
        const id = parseNumber(panel.querySelector('[data-technology-id]')?.getAttribute('data-technology-id'));
        const li = panel.querySelector('.information .build_duration');
        if(!id || !li || li.classList.contains('oglOrion_duration')) return;

        const value = li.querySelector('.value');
        if(value && value.textContent.trim()) gameDuration[id] = { text:value.textContent.trim(), datetime:value.getAttribute('datetime') };
    };

    const restoreDuration = (panel, id) =>
    {
        const captured = gameDuration[id];
        const list = panel.querySelector('.information .narrow') || panel.querySelector('.information ul');
        if(!captured || !list || list.querySelector('.build_duration')) return;

        const shown = readDisplayed(panel.querySelector('.costs .ogl_costsWrapper'));
        if(!shown || (shown.mode === 'level' && shown.level !== readGameLevel(panel, id))) return;

        const li = document.createElement('li');
        li.className = 'build_duration oglOrion_duration';
        li.innerHTML = '<strong></strong>';
        const span = document.createElement('span');
        span.className = 'value';
        span.textContent = captured.text;
        if(captured.datetime) span.setAttribute('datetime', captured.datetime);
        li.appendChild(span);
        list.prepend(li);
    };

    // ---------- wiring ----------

    // DOM-only observer (no network): reacts when the player opens a technology panel or uses
    // OGLight's level arrows, both of which rebuild the cost rows.
    let scheduled = false;

    const observer = new MutationObserver(() =>
    {
        const panel = document.querySelector('#technologydetails_wrapper') || document.querySelector('#technologydetails');
        if(!panel) return;

        captureDuration(panel);

        if(scheduled) return;
        scheduled = true;

        // wait for OGLight's own requestAnimationFrame pass, then patch on top of it
        requestAnimationFrame(() => requestAnimationFrame(() =>
        {
            scheduled = false;
            observer.disconnect();
            try { patch(panel); }
            finally { observer.observe(document.body, { childList:true, subtree:true }); }
        }));
    });

    observer.observe(document.body, { childList:true, subtree:true });
})();
