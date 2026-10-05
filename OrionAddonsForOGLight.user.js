// ==UserScript==
// @name         OGLight Orion Addons
// @namespace    https://github.com/nicolagalassi
// @version      0.16.0
// @description  Add-ons for OGLight on the Project Orion test server: real costs for the Orion buildings in OGLight's own layout (level arrows, to-do list), a button on every anomaly-mission wave that opens OGLight's battle simulator pre-filled, and a profitability figure on every scanned anomaly. Display only.
// @author       nicolagalassi
// @match        https://s808-en.ogame.gameforge.com/game/*
// @icon         https://gf1.geo.gfsrv.net/cdn3d/favicon.ico
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

/*
  OGLight Orion Addons — small add-ons that run NEXT TO OGLight for Project Orion.

  WHERE IT RUNS
  Only on the Project Orion test server (s808-en, @match above): Orion does not exist anywhere else yet,
  so there is nothing for it to do on other universes. When Orion reaches other servers, add their
  @match lines.

  Four independent parts, each in its own block below and each with its own notes:
  - PART 0 — KEEP OGLIGHT STARTING: an Orion building in the build queue made OGLight's start-up throw
    on every page showing the queue; this keeps that entry out of OGLight's way while it starts.
  - PART 1 — COSTS: prices of the Orion buildings (Interstellar Anomaly Scanner and the control center)
    in OGLight's cost grid, OGLight's level arrows, OGLight's to-do list.
  - PART 2 — MISSION WAVE SIMULATOR: a button beside the game's Sim button of every anomaly-mission wave
    that opens the simulator chosen in OGLight, pre-filled with the wave and your fleet.
  - PART 3 — ANOMALY PROFITABILITY: on the scanner's results and on the active missions, what each anomaly
    pays per hour of your lithium production, best first and marked.
  They share nothing but this file and onDomReady below.

  The script runs at document-start because PART 0 has to act while the page is still being parsed,
  before OGLight starts. PARTS 1-3 wait for the DOM exactly as they did at document-idle.
*/

const onDomReady = fn => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn, { once:true }) : fn();

/*
  PART 0 — KEEP OGLIGHT STARTING WITH AN ORION BUILDING IN THE QUEUE

  THE PROBLEM
  While it starts, OGLight (checkProductionBoxes, identical in 5.3.3 and 5.4.2) walks every picture in
  the build / research / shipyard queue boxes, takes the first number in the onclick of the link around
  it as the technology id, and prices it with getTechData(). For an id missing from its cost table,
  Datafinder.getTech() returns undefined and getTechData() reads undefined.metal: a TypeError. That one
  throw ends OGLight's whole start-up - window.ogl is never set - so on every page that shows the queue,
  for as long as an Orion building is in it, there is no OGLight at all: no to-do list (the ☰ button
  then says "OGLight did not start"), no planet-list figures, no simulator choice.

  WHAT THIS DOES
  The same loop skips a link with no onclick (`if(!id) return`). So while the page is being parsed -
  OGLight only starts once the document has stopped loading - every queue link whose onclick names an
  Orion id has that onclick moved aside into data-orion-onclick, and as soon as OGLight has started it is
  put back, unchanged.
  - Which ids: OGLight's cost table has nothing at all in 45-99 or 4000-4999 (it ends at 44 for
    buildings; lifeforms are 11101+), and the verified Orion buildings are 45 (scanner) and 4001-4007
    (control center). The guard acts on exactly those two ranges, judged with OGLight's own extraction
    (first number in the onclick), so it never touches an entry OGLight knows.
  - When to put it back: OGLight's init() adds the class "oglight" to <body> as its first step and then
    runs to the end synchronously, managers included. A MutationObserver callback runs only after that
    script has returned, so seeing the class means init() is over. Without OGLight the class never
    comes, so the links are also put back a few seconds after the page has loaded.

  COMPLIANCE (OGame Origin tool rules — see AGENTS.md):
  - §1.1-§1.3/§4  No game action and no request: it moves one attribute and puts it back.
  - Nothing visible changes. For the moment between the page arriving and OGLight's start a click on
    that queue entry does nothing; after that it behaves exactly as the game made it.
  - It changes how another tool reads the page: mention it in the toleration submission.
*/

(function()
{
    'use strict';

    const SAVED = 'data-orion-onclick';
    const isOrionId = id => (id >= 45 && id <= 99) || (id >= 4000 && id <= 4999);

    // OGLight's own extraction: the number it would hand to getTechData
    const queueId = link => parseInt(link.getAttribute('onclick')?.match(/([0-9]+)/)?.[0] || '', 10);

    let restored = false;
    let observer = null;

    const shelve = pic =>
    {
        if(!pic.closest('[id^="productionbox"]')) return; // OGLight only prices the queue boxes

        const link = pic.closest('a');
        if(!link || !link.hasAttribute('onclick') || !isOrionId(queueId(link))) return;

        link.setAttribute(SAVED, link.getAttribute('onclick'));
        link.removeAttribute('onclick');
    };

    const restore = () =>
    {
        if(restored) return;
        restored = true;
        if(observer) observer.disconnect();

        document.querySelectorAll('[' + SAVED + ']').forEach(link =>
        {
            link.setAttribute('onclick', link.getAttribute(SAVED));
            link.removeAttribute(SAVED);
        });
    };

    observer = new MutationObserver(records =>
    {
        if(restored) return;

        for(const record of records)
        {
            if(record.type === 'attributes')
            {
                if(record.target === document.body && document.body.classList.contains('oglight')) { restore(); return; }
                continue;
            }

            record.addedNodes.forEach(node =>
            {
                if(node.nodeType !== 1) return;
                if(node.matches('.queuePic')) shelve(node);
                else node.querySelectorAll('.queuePic').forEach(shelve);
            });
        }
    });

    observer.observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });

    // without OGLight nothing ever adds its class: give the links back once the page has settled
    window.addEventListener('load', () => setTimeout(restore, 3000), { once:true });
})();

/*
  PART 1 — COSTS

  THE PROBLEM
  OGLight replaces the game's cost box in the technology panel (#technologydetails) with its own
  (.ogl_costsWrapper). It does not read the price from the page: it computes it from a table of base
  costs baked into the script (class Datafinder). A technology that is not in that table — the new
  Project Orion building "Interstellar Anomaly Scanner" and its researches — gets base cost 0, so
  OGLight shows 0 metal / 0 crystal / 0 deuterium and drops the build time.

  In practice OGLight does not even get to the zeros: for an id missing from its table its code throws
  after adding the ‹ × › buttons and before drawing the cost grid. On the Orion CONTROL CENTER
  (component=orion, techs 4001-4007) the panel loads later, inside a tab, and OGLight does not run at
  all. In both cases OGLight's stylesheet still hides the game's own cost list: no price is visible.

  WHY WE DO NOT PATCH OGLIGHT'S TABLE
  OGLight runs in its own userscript sandbox; another script cannot reach its Datafinder class.
  And the Orion formulas are not published yet (the public test started 30 Sep 2026): hard-coding
  guessed base costs/factors would print wrong numbers with a straight face.

  WHAT THIS ADD-ON DOES INSTEAD
  0. Where OGLight drew no cost grid, we draw it ourselves in OGLight's layout and class names (so it
     looks like the shipyard's): level header, cost / cumulative / missing per resource, MSU, and the
     "from → to" title. OGLight's ‹ × › buttons drive it. Only when OGLight's stylesheet is hiding the
     game's list, so without OGLight nothing changes.
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
     Until then other levels show "?". A formula verified against the game can be typed into
     MANUAL_FORMULAS below and wins over the estimate (Scanner 45 and control-center buildings
     4001-4007 are all there). A NEW control-center building seen at one level only is estimated with
     the 1.5 factor all the verified ones share.

  COMPLIANCE (OGame Origin tool rules — see AGENTS.md):
  - §1.1/§1.2  Display only. It never builds, queues or clicks anything; no game action at all.
  - §1.3/§4    NO network request of any kind. It reads only the panel the player opened by clicking.
               The MutationObserver watches the DOM only; it never talks to the server.
  - §4.2       No cp=, no planet switching.
  - §1.6       Shows prices; it does not add any queue (no Commander imitation).
  - §1.7       Touches only the technology panel's cost rows; ads, banners, footer, Merchant,
               Officers and Shop are never touched.
  - Other tool  The ☰ button hands the shown prices to OGLight's own addToTodolist() (window.ogl), so
               they land in OGLight's per-planet to-do list. A planning note in another local tool —
               no game action. Mention it in the toleration submission.
  - §1.9       Nothing leaves the machine: the observed prices stay in this browser's localStorage.
  - §5         Runs inside the OGame page → needs toleration before public distribution, like any
               userscript. (It also modifies another tool's display; mention that in the submission.)
*/

onDomReady(function()
{
    'use strict';

    // Formulas typed in by hand, once they are known for certain. Key = technology id as the game uses it
    // (data-technology on the building tile). cost(level) = floor(base * factor^(level - 1)).
    // Only verified entries go here: we do not guess.
    const MANUAL_FORMULAS =
    {
        // Interstellar Anomaly Scanner. Verified against the game's own panel on s808-en (beta,
        // 01 Oct 2026): level 49 = 867,810,695 / 433,905,347 / 144,635,115, i.e. exactly
        // floor(84|42|14 * 1.4^48). Demolition matches too: 84 * 1.4^46 * (1 - 64% ion bonus).
        45: { metal:84, crystal:42, deut:14, factor:1.4 },

        // Control center — Intergalactic Recovery Center. Levels 1, 2 and 3 read off the game on s808-en
        // (beta, 01 Oct 2026): 75,000 / 52,500 / 22,500, then 112.5k / 78.8k / 33.8k, then 168.8k /
        // 118.1k / 50.6k — factor 1.5 to the display's 0.1k precision on all three resources.
        4001: { metal:75000, crystal:52500, deut:22500, factor:1.5 },

        // Control center — Lithium Electrolysis Lab. Exact values from the game, s808-en: levels 3, 5 and
        // 19 (118,125 / 265,781 / 77,589,323 metal) → factor 1.5 to the unit.
        4002: { metal:52500, crystal:37500, deut:37500, factor:1.5 },

        // Control center — Metal Recycling Line, Crystal Processing, Anomaly Analysis Center, High-Pressure
        // Deuterium Tanks. Each checked to the unit against two levels read from the game on s808-en:
        // 4003 levels 1 and 11, 4004 levels 1 and 3, 4005 levels 2 and 3, 4006 levels 1 and 3.
        4003: { metal:112500, crystal:37500, deut:18000, factor:1.5 },
        4004: { metal:37500, crystal:67500, deut:27000, factor:1.5 },
        4005: { metal:67500, crystal:37500, deut:22500, factor:1.5 },
        4006: { metal:30000, crystal:37500, deut:45000, factor:1.5 },

        // Control center — Conversion Catalyst. Level 11 from the game, s808-en: 7,352,292 / 6,487,316 /
        // 3,027,414. Only 1.5 turns that into round bases (1.4, 1.6, 1.75, 2 do not), and
        // floor(127,500|112,500|52,500 * 1.5^10) gives back all three figures to the unit.
        4007: { metal:127500, crystal:112500, deut:52500, factor:1.5 },
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

    // Every control-center building (4001-4007) grows by exactly 1.5 per level. For a future one seen at a
    // single level only, that factor is the best guess for its other levels: used ONLY in
    // that case, and always shown as an estimate ("~"), never as a verified price.
    const CONTROL_CENTER_FACTOR = 1.5;
    const familyEstimate = (id, observed, resource) =>
    {
        if(id < 4001 || id > 4099) return null;

        const levels = Object.keys(observed).map(Number).filter(l => observed[l][resource] > 0);
        if(levels.length !== 1) return null;

        return { refLevel:levels[0], refCost:observed[levels[0]][resource], factor:CONTROL_CENTER_FACTOR };
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

        const fit = estimate(observed, resource) || familyEstimate(id, observed, resource);
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
            ? 'OGLight Orion Addons: open the panel at two different levels to estimate this'
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

    // ---------- our own OGLight-style cost grid ----------
    //
    // For a tech missing from its table OGLight does not get as far as drawing zeros: its getTechData()
    // reads `.metal` of an undefined table entry and throws, AFTER it has added the ‹ × › buttons but
    // BEFORE it draws the cost grid or the "26 → 27" title. On the Orion control center it does not
    // run at all. Either way its stylesheet still hides the game's own cost list, so the player saw
    // no price. We draw the grid OGLight would have drawn, with OGLight's own class names so its
    // stylesheet lays it out exactly like the shipyard's: level header, metal / crystal / deuterium
    // (/ energy) rows with [cost of the level, cumulative over the range, missing on this planet], and
    // the MSU row. The ‹ › buttons OGLight left behind drive it.

    // OGLight's default MSU ratio (options.msu = '3:2:1'). Its own setting lives in OGLight's private
    // storage, which another script cannot read: a player with a custom ratio sees the default here.
    const MSU_RATIO = [3, 2, 1];
    const msuOf = c => Math.ceil((c.metal || 0) + (c.crystal || 0) * MSU_RATIO[0] / MSU_RATIO[1] + (c.deut || 0) * MSU_RATIO[0] / MSU_RATIO[2]);

    // Same number format as OGLight's Util.formatToUnits: fr-FR compact notation mapped onto k / M / B / T.
    const formatUnits = value =>
    {
        value = Math.round(value || 0);
        const abs = Math.abs(value);
        const precision = abs < 1000 ? 0 : abs < 1000000 ? 1 : 2;
        const split = Intl.NumberFormat('fr-FR', { notation:'compact', minimumFractionDigits:precision, maximumFractionDigits:precision })
            .format(value).match(/[a-zA-Z]+|[0-9,\-−]+/g) || [String(value)];
        const number = split[0].replace(/,/g, '.').replace('−', '-');
        const suffix = (split[1] || '').replace('Md', 'B').replace('Bn', 'T');
        return `<span class="ogl_unit"><span>${number}</span><span class="ogl_suffix">${suffix}</span></span>`;
    };

    const cell = (parent, html, cls, title) =>
    {
        const div = document.createElement('div');
        if(cls) div.className = cls;
        if(title) div.setAttribute('title', title);
        div.innerHTML = html;
        parent.appendChild(div);
        return div;
    };

    const estimated = (html, exact) => exact ? html : '~' + html;

    // Which level the ‹ › buttons are showing, as an offset from the next level, PER TECH. It used to live
    // on the panel element, but the page rebuilds the panel from scratch now and then (a countdown that
    // ends, resources ticking over): the new element had no offset and the grid jumped back to the next
    // level under the player's fingers. Keeping it here survives those rebuilds; it is reset only when the
    // player clicks a building tile, i.e. opens a panel on purpose — which is when OGLight resets it too.
    const levelOffsets = new Map();
    const levelOffset = id => levelOffsets.get(id) || 0;

    document.addEventListener('click', event =>
    {
        const tile = event.target.closest && event.target.closest('#technologies .technology[data-technology]');
        if(tile) levelOffsets.delete(parseInt(tile.getAttribute('data-technology'), 10));
    }, true);

    const renderOwn = (panel, id) =>
    {
        const costs = panel.querySelector('.costs');
        const gameCosts = readGameCosts(panel);
        if(!costs || !gameCosts) return;

        const store = loadStore();
        const initial = readGameLevel(panel, id);
        const offset = levelOffset(id);
        const level = initial + offset;

        // OGLight's range: from the level owned to the level shown. Stepping below the next level shows
        // that single level, as OGLight does.
        const first = offset >= 0 ? initial : level;
        const from = first - 1;

        const wrapper = costs.querySelector('.ogl_costsWrapper.oglOrion_own') || document.createElement('div');
        wrapper.className = 'ogl_costsWrapper oglOrion_own';
        wrapper.textContent = '';

        const header = document.createElement('div');
        header.className = 'ogl_icon';
        cell(header, '');
        cell(header, String(level));
        cell(header, `${from} <i class="material-icons">east</i> ${level}`);
        cell(header, 'globe', 'material-icons');
        wrapper.appendChild(header);

        const totals = {};
        let unknown = false;

        RESOURCES.forEach(resource =>
        {
            if(!(resource in gameCosts)) return; // same rule as OGLight: a row per resource the game lists

            const step = costAt(id, level, resource, store);
            let total = { value:0, exact:true };

            if(resource === 'energy') total = step; // energy is a requirement, not a sum
            else
            {
                for(let l = first; l <= level; l++)
                {
                    const c = costAt(id, l, resource, store);
                    if(!c) { total = null; break; }
                    total.value += c.value;
                    total.exact = total.exact && c.exact;
                }
            }

            if(!step || !total) unknown = true;
            if(total) totals[resource] = total;

            const row = document.createElement('div');
            row.className = `ogl_icon ogl_${resource}`;
            const hint = 'OGLight Orion Addons: open the panel at two different levels to estimate this';

            cell(row, step ? estimated(formatUnits(step.value), step.exact) : '?', 'tooltip', step ? formatFull(step.value) : hint);
            cell(row, total ? estimated(formatUnits(total.value), total.exact) : '?', 'ogl_text tooltip', total ? formatFull(total.value) : hint);

            const have = planetResource(resource);
            if(resource === 'energy' || have == null) cell(row, '');
            else if(!total) cell(row, '?');
            else if(have - total.value < 0) cell(row, formatUnits(have - total.value), 'ogl_danger tooltip', formatFull(have - total.value));
            else cell(row, 'check', 'ogl_ok material-icons');

            wrapper.appendChild(row);
        });

        const msuRow = document.createElement('div');
        msuRow.className = 'ogl_icon ogl_msu';
        const levelCosts = {};
        let levelExact = true;
        ['metal', 'crystal', 'deut'].forEach(r =>
        {
            const c = costAt(id, level, r, store);
            levelCosts[r] = c ? c.value : 0;
            if(c && !c.exact) levelExact = false;
        });
        const totalCosts = { metal:totals.metal?.value, crystal:totals.crystal?.value, deut:totals.deut?.value };
        const totalExact = ['metal', 'crystal', 'deut'].every(r => !totals[r] || totals[r].exact);
        cell(msuRow, unknown ? '?' : estimated(formatUnits(msuOf(levelCosts)), levelExact), 'tooltip', unknown ? '' : formatFull(msuOf(levelCosts)));
        cell(msuRow, unknown ? '?' : estimated(formatUnits(msuOf(totalCosts)), totalExact), 'ogl_text tooltip', unknown ? '' : formatFull(msuOf(totalCosts)));
        wrapper.appendChild(msuRow);

        if(!wrapper.parentElement) costs.appendChild(wrapper);

        // OGLight writes the range into the title in place of "Level N"
        const title = panel.querySelector('.information .level');
        if(title) title.innerHTML = `${from} <i class="material-icons">east</i> ${level}`;

        // the game's build time is for the next level only; hide it while another level is shown
        const duration = panel.querySelector('.information .build_duration');
        if(duration) duration.style.visibility = offset === 0 ? '' : 'hidden';

        // like OGLight: ☰ lit when the level shown is already on this planet's to-do list
        const lists = Array.from(panel.querySelectorAll('.ogl_actions .ogl_button')).find(b => b.textContent.trim() === 'lists');
        if(lists) lists.classList.toggle('ogl_active', pinnedLevel(id, level));

        if(typeof window.initTooltips === 'function') { try { window.initTooltips(); } catch(e) { /* cosmetic */ } }
    };

    // OGLight's ‹ × › buttons. Its own handlers throw for these techs (see above); ours run alongside them.
    // Display only: they change which level is SHOWN, nothing is sent to the game.
    const hookArrows = (panel, id) =>
    {
        if(panel.dataset.oglOrionArrows) return;
        panel.dataset.oglOrionArrows = '1';

        panel.addEventListener('click', event =>
        {
            const button = event.target.closest('.ogl_actions .ogl_button');
            if(!button) return;

            const action = button.textContent.trim();
            const initial = readGameLevel(panel, id);
            let offset = levelOffset(id);

            if(action === 'chevron_left' && offset > 1 - initial) offset--;
            else if(action === 'chevron_right') offset++;
            else if(action === 'close') offset = 0;
            else if(action === 'lists') { pinToOGLightTodolist(panel, id, button); return; }
            else return;

            levelOffsets.set(id, offset);
            renderOwn(panel, id);
        });
    };

    // ---------- OGLight's ☰ to-do list ----------
    //
    // The ☰ button pins the shown levels' prices to OGLight's per-planet to-do list. OGLight's own handler
    // computes those prices with getTechData() and throws for these techs, so nothing gets pinned. The
    // list itself lives in OGLight's private Tampermonkey storage, which no other script can write — but
    // OGLight puts its instance on the page (window.ogl), and its tech module exposes addToTodolist(),
    // the very function its ☰ button ends up calling. We call it with the prices we know, in the shape
    // OGLight's handler builds: { level: { id, level, metal, crystal, deut } }. OGLight then stores and
    // saves the entry itself, exactly as for the shipyard.
    // This only writes a planning note into the other tool; nothing is sent to the game (§1.1/§1.3).
    const oglightTech = () =>
    {
        try { return window.ogl && window.ogl._tech && typeof window.ogl._tech.addToTodolist === 'function' ? window.ogl._tech : null; }
        catch(e) { return null; }
    };

    const notify = (message, error) =>
    {
        // the game's own little message box, the one OGLight uses too
        if(typeof window.fadeBox === 'function') { try { window.fadeBox(message, !!error); return; } catch(e) { /* fall through */ } }
        console.info('[OGLight Orion Addons] ' + message);
    };

    const pinnedLevel = (id, level) =>
    {
        try { return !!window.ogl.currentPlanet.obj.todolist[id][level]; }
        catch(e) { return false; }
    };

    const pinToOGLightTodolist = (panel, id, button) =>
    {
        const tech = oglightTech();
        if(!tech)
        {
            // Without window.ogl there is no to-do list to write into. An Orion building in the build queue
            // used to be the usual cause; PART 0 now keeps OGLight starting through that, so if this still
            // shows, OGLight failed for some other reason - its error is in the browser console.
            notify(window.ogl ? 'OGLight to-do list not reachable from this page'
                : 'OGLight did not start on this page: its error is in the browser console (F12)', true);
            return;
        }

        const initial = readGameLevel(panel, id);
        const offset = levelOffset(id);
        if(offset < 0) { notify('Cannot lock previous levels', true); return; } // same rule as OGLight

        const store = loadStore();
        const todo = {};

        for(let level = initial; level <= initial + offset; level++)
        {
            const entry = { id:id, level:level };

            for(const resource of ['metal', 'crystal', 'deut'])
            {
                const cost = costAt(id, level, resource, store);
                if(!cost) { notify(`Price of level ${level} unknown: open the panel at two different levels first`, true); return; }
                entry[resource] = cost.value;
            }

            todo[level] = entry;
        }

        try
        {
            tech.addToTodolist(todo);
            button.classList.add('ogl_active');
        }
        catch(e)
        {
            notify('OGLight refused the to-do entry', true);
        }
    };

    // On the Orion control center OGLight does not run, so its ‹ × › ☰ buttons are missing too. We add the
    // same four, with OGLight's classes and in OGLight's place, so every Orion panel steps through
    // levels the same way. Display only: they change the level shown, nothing is sent to the game.
    const addArrows = details =>
    {
        if(details.querySelector('.ogl_actions')) return;

        const sprite = details.querySelector('.sprite') || details.querySelector('.sprite_large');
        if(!sprite) return;

        const actions = document.createElement('div');
        actions.className = 'ogl_actions oglOrion_actions';

        ['chevron_left', 'close', 'chevron_right', 'lists'].forEach(icon =>
        {
            const button = document.createElement('div');
            button.className = 'material-icons ogl_button';
            button.textContent = icon;
            actions.appendChild(button);
        });

        sprite.appendChild(actions);
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

        // remember what the game showed, so other levels can be estimated later (written only when new)
        store[id] = store[id] || {};
        if(JSON.stringify(store[id][gameLevel]) !== JSON.stringify(gameCosts))
        {
            store[id][gameLevel] = gameCosts;
            saveStore(store);
        }

        const details = panel.querySelector('#technologydetails') || panel;
        const wrapper = panel.querySelector('.costs .ogl_costsWrapper');

        if(wrapper && wrapper.classList.contains('oglOrion_own')) return; // ours, already drawn

        if(!wrapper)
        {
            // only where OGLight's stylesheet hides the game's list: without OGLight the game is untouched
            const list = panel.querySelector('.costs > ul.ipiHintable');
            if(!list || getComputedStyle(list).display !== 'none') return;

            addArrows(details);
            hookArrows(details, id);
            renderOwn(details, id);
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

    // ---------- OGLight's to-do clean-up ----------
    //
    // OGLight drops a to-do entry once the building tile shows that level (or a higher one queued):
    // its checkTodolist() reads every .technology tile on the page. It only runs it while it starts, so
    // on the Orion control center — whose tiles arrive later, inside a tab — finished Orion levels stayed
    // on the list for good. When a tile list with Orion buildings appears, we ask OGLight to run that same
    // check once. It is OGLight's own function on OGLight's own data; nothing is sent to the game.
    const checkedTileLists = new WeakSet();

    const syncTodolist = () =>
    {
        const tiles = document.querySelector('#technologies');
        if(!tiles || checkedTileLists.has(tiles)) return;
        checkedTileLists.add(tiles);

        if(!tiles.querySelector('.technology[data-technology^="40"], .technology[data-technology="45"]')) return;

        try { if(window.ogl && window.ogl._tech && typeof window.ogl._tech.checkTodolist === 'function') window.ogl._tech.checkTodolist(); }
        catch(e) { /* OGLight not ready or changed: the list simply stays as it is */ }
    };

    // ---------- wiring ----------

    // DOM-only observer (no network): reacts when the player opens a technology panel or uses
    // OGLight's level arrows, both of which rebuild the cost rows.
    //
    // It used to do its work on EVERY change anywhere in the page (countdowns, resource ticks, OGLight's
    // own redraws), including a localStorage read and write each time — the small lag on page load.
    // Now a panel is handled once, and again only when its cost rows were rebuilt.
    let scheduled = false;

    const needsWork = () =>
    {
        const details = document.querySelector('#technologydetails');
        if(details && details.querySelector('.costs') && !details.querySelector('.oglOrion_own, .oglOrion_patched'))
        {
            // OGLight redrew zeros for a tech it does not know: always worth another look
            if(unknownToOGLight.has(parseInt(details.getAttribute('data-technology-id'), 10))) return true;

            // already looked at and nothing to do there (a tech OGLight knows, or no OGLight)?
            if(details.dataset.oglOrionSeen === details.querySelector('.costs').childElementCount + '') return syncPending();
            return true;
        }
        return syncPending();
    };

    const syncPending = () =>
    {
        const tiles = document.querySelector('#technologies');
        return !!tiles && !checkedTileLists.has(tiles);
    };

    const observer = new MutationObserver(() =>
    {
        if(scheduled || !needsWork()) return;

        const panel = document.querySelector('#technologydetails_wrapper') || document.querySelector('#technologydetails');
        if(panel) captureDuration(panel);

        scheduled = true;

        // wait for OGLight's own requestAnimationFrame pass, then patch on top of it
        requestAnimationFrame(() => requestAnimationFrame(() =>
        {
            scheduled = false;
            observer.disconnect();
            try
            {
                const current = document.querySelector('#technologydetails_wrapper') || document.querySelector('#technologydetails');
                if(current) patch(current);

                // remember the panel as handled, keyed on its cost block, so OGLight redrawing it re-triggers us
                const details = document.querySelector('#technologydetails');
                const costs = details && details.querySelector('.costs');
                if(costs) details.dataset.oglOrionSeen = costs.childElementCount + '';

                syncTodolist();
            }
            finally { observer.observe(document.body, { childList:true, subtree:true }); }
        }));
    });

    observer.observe(document.body, { childList:true, subtree:true });
});

/*
  PART 2 — MISSION WAVE SIMULATOR

  THE PROBLEM
  Project Orion anomaly missions send waves of NPC fleets at the anomaly you hold. The game has a "Sim"
  button per wave, but it opens the game's own simulator. OGLight players use the external simulator
  they picked in OGLight's settings (the same one its spy-report button opens), and OGLight knows
  nothing about Orion missions.

  WHAT IT DOES
  Next to the game's "Sim" button of every wave (current and upcoming) it adds one more button. One
  click opens ONE new tab on OGLight's simulator, pre-filled the way OGLight pre-fills it for a spy
  report (the Trashsim "#prefill=" format, shared by both simulators OGLight offers):
  - attacker: the wave — every ship and the weapons / shields / armour levels, read from the wave's own
    tooltip that the game already put in the page;
  - defender: you — the fleets of yours that are at the anomaly when the wave lands (holding there past
    its arrival, or flying in and arriving before it), read from the mission's fleet list; your combat
    research, class and lifeform bonuses come from OGLight (window.ogl), with OGLight's own rules.
  If OGLight did not start on this page, the wave and your ships are still filled in, your research is
  left at 0, and a message says so.

  COMPLIANCE (OGame Origin tool rules — see AGENTS.md):
  - §1.1/§1.2  No game action at all: the button opens a simulator tab, that is all. 1 click = 1 tab.
  - §1.3/§4    NO request to the game server. Everything is read from the mission page the player opened;
               the DOM-only observer adds buttons when the game redraws the mission list.
  - §4.2       No cp=, no planet switching.
  - §1.5.1     Nothing to do with probing or targeting: it simulates an NPC wave against your own fleet.
  - §1.7       Adds a button beside the game's own in the wave row's "Sim" cell; the game's button stays
               as it is.
  - §1.9       Data leaves the machine ONLY on the player's click, and only what a simulator needs
               (the wave, your ships at the anomaly, your combat techs/bonuses), in the URL fragment of
               the simulator the player chose in OGLight — exactly what OGLight's own simulator button
               sends for a spy report. The button's tooltip says which site it opens.
  - §5         Runs inside the OGame page → needs toleration before public distribution.
*/

onDomReady(function()
{
    'use strict';

    // The simulators OGLight offers, copied from its Util.simList (identical in 5.3.3 and 5.4.2): the KEYS
    // must match byte for byte, because OGLight stores the chosen key in window.ogl.db.options.sim and
    // this looks it up. An earlier copy had 'osims' where OGLight writes 'Osims' and lacked 'battlesim',
    // so picking either of those in OGLight fell through to the first entry and always opened OGame Tools.
    // OGLight builds every link the same way, base + language + '#prefill=', so this does too.
    const SIMULATORS =
    {
        battlesim: { name:'battlesim.logserver.net', base:'https://battlesim.logserver.net/' },
        'simulator.ogame-tools': { name:'simulator.ogame-tools.com', base:'https://simulator.ogame-tools.com/' },
        Osims: { name:'Osims', base:'https://www.ogameutilities.it/Osims/' },
    };

    // OGLight's choice. It lives in OGLight's private storage, readable only through window.ogl - which
    // does not exist on a page where OGLight failed to start (an Orion building in the queue used to do
    // that). So the choice is copied to localStorage whenever it can be read, and the copy is used when it
    // cannot. With nothing saved at all OGLight itself picks one at random per click; here the first one
    // is used, so the button's tooltip can say which site it opens.
    const SIM_KEY = 'orionAddons.sim';
    const chosenSimulator = o =>
    {
        let key = o?.db?.options?.sim;

        try
        {
            if(SIMULATORS[key]) localStorage.setItem(SIM_KEY, key);
            else key = localStorage.getItem(SIM_KEY);
        }
        catch(e) { /* storage blocked: use what OGLight gave, or the default */ }

        return SIMULATORS[key] || SIMULATORS[Object.keys(SIMULATORS)[0]];
    };

    // <technology-icon> attribute → OGame unit id
    const UNIT_IDS =
    {
        transportersmall:202, transporterlarge:203, fighterlight:204, fighterheavy:205, cruiser:206,
        battleship:207, colonyship:208, recycler:209, espionageprobe:210, bomber:211, solarsatellite:212,
        destroyer:213, deathstar:214, interceptor:215, resbuggy:217, reaper:218, explorer:219,
        weaponstechnology:109, shieldingtechnology:110, shiparmortechnology:111,
    };

    const parseNumber = text => parseInt(String(text || '').replace(/[^\d]/g, ''), 10) || 0;

    const ogl = () =>
    {
        try { return window.ogl && window.ogl.db ? window.ogl : null; }
        catch(e) { return null; }
    };

    const notify = (message, error) =>
    {
        if(typeof window.fadeBox === 'function') { try { window.fadeBox(message, !!error); return; } catch(e) { /* fall through */ } }
        console.info('[OGLight Orion Addons] ' + message);
    };

    // ---------- reading the page ----------

    // A fleet tooltip (.htmlTooltip.fleetTooltip): { ships:{id:{count}}, research:{id:{level}} }
    const readFleetTooltip = tooltip =>
    {
        const fleet = { ships:{}, research:{} };
        if(!tooltip) return fleet;

        tooltip.querySelectorAll('.fleetTooltipRow').forEach(row =>
        {
            const icon = row.querySelector('technology-icon');
            if(!icon) return;

            const name = Array.from(icon.attributes).map(a => a.name).find(n => n in UNIT_IDS);
            if(!name) return;

            const id = UNIT_IDS[name];
            const value = parseNumber(row.querySelector('.fleetTooltipCount')?.textContent);

            if(id >= 109 && id <= 111) fleet.research[id] = { level:value };
            else fleet.ships[id] = { count:(fleet.ships[id]?.count || 0) + value };
        });

        return fleet;
    };

    const coordsOf = link =>
    {
        const params = link ? new URL(link.href, location.href).searchParams : null;
        return params ? [params.get('galaxy'), params.get('system'), params.get('position')].map(v => parseInt(v, 10) || 0) : [0, 0, 0];
    };

    // Your fleets that are at the anomaly when the wave lands. The mission lists every fleet with the
    // seconds until its next event: for a fleet HOLDING there that is when it leaves, for one flying IN
    // it is when it arrives. Returning fleets are gone.
    const ownFleetAt = (mission, waveSeconds) =>
    {
        const total = { ships:{} };
        let origin = null;

        mission.querySelectorAll('.missionFleetEvents .fleetEventRow.own').forEach(row =>
        {
            if(row.classList.contains('returning')) return;

            const seconds = parseNumber(row.querySelector('.feTimer')?.getAttribute('data-seconds'));
            const holding = row.classList.contains('holding');
            if(holding ? seconds < waveSeconds : seconds > waveSeconds) return;

            const fleet = readFleetTooltip(row.querySelector('.feDirection .fleetTooltip'));
            Object.entries(fleet.ships).forEach(([id, ship]) => total.ships[id] = { count:(total.ships[id]?.count || 0) + ship.count });

            origin = origin || coordsOf(row.querySelector('.feOrigin a'));
        });

        return { ships:total.ships, origin:origin };
    };

    // ---------- your side: OGLight's own rules (from OGLight's Util.genTrashsimLink, MIT) ----------

    const fillPlayer = (player, o) =>
    {
        if(!o) return false;

        try
        {
            const planet = o.currentPlanet?.obj || {};
            [109, 110, 111, 114, 115, 117, 118].forEach(id => player.research[id] = { level:planet[id] || 0 });

            player.class = o.account?.class;
            player.characterClassesEnabled = true;
            player.allianceClass = o.db.allianceClass || 0;

            let bonus = 0;
            if(o.account?.class == 2) // general: +2 combat techs, +1 per 50% of its lifeform class boost
            {
                bonus += 2;
                bonus += Math.floor((o.db.lfBonuses?.['Characterclasses' + o.account.class]?.bonus || 0) / 50);
            }
            if(o.db.allianceClass == 1) bonus++; // warrior alliance

            [109, 110, 111].forEach(id => player.research[id].level += bonus);

            player.lifeformBonuses = { BaseStatsBooster:{}, CharacterClassBooster:{} };
            player.lifeformBonuses.CharacterClassBooster[o.account?.class] = (o.db.lfBonuses?.['Characterclasses' + o.account?.class]?.bonus || 0) / 100;

            (o.shipsList || Object.keys(player.ships)).forEach(shipID =>
            {
                const boost = player.lifeformBonuses.BaseStatsBooster[shipID] = {};
                Object.entries(o.db.lfBonuses?.[shipID] || {}).forEach(([key, value]) =>
                {
                    if(key == 'fuel') { if(value) player.lifeformBonuses.ShipFuelConsumption = Math.abs(value / 100); }
                    else boost[key] = value / 100;
                });
            });

            return true;
        }
        catch(e) { return false; }
    };

    // ---------- the link ----------

    const simLink = (mission, waveRow) =>
    {
        const waveSeconds = parseNumber(waveRow.querySelector('.missionCountdown')?.getAttribute('data-seconds'));
        const wave = readFleetTooltip(waveRow.querySelector('.fleetTooltip'));
        const target = coordsOf(waveRow.querySelector('a[href*="galaxy="]'));
        const mine = ownFleetAt(mission, waveSeconds);
        const o = ogl();

        const server = location.hostname.split('.')[0]; // s808-en
        const lang = (o?.account?.lang == 'us' ? 'en' : o?.account?.lang == 'ar' ? 'es' : o?.account?.lang) || server.split('-')[1] || 'en';

        const attacker = { planet:{ galaxy:target[0], system:target[1], position:target[2] }, research:wave.research, ships:wave.ships };
        const defender = { planet:{ galaxy:target[0], system:target[1], position:target[2] }, research:{}, ships:mine.ships, resources:{}, defence:{} };

        const withTechs = fillPlayer(defender, o);

        const data = { settings:{ server:server } };
        data[0] = [attacker];
        data[1] = [defender];

        const sim = chosenSimulator(o);

        return {
            url:sim.base + lang + '#prefill=' + btoa(JSON.stringify(data)),
            sim:sim.name,
            withTechs:withTechs,
            hasShips:Object.keys(mine.ships).length > 0,
        };
    };

    // ---------- the button ----------

    const iconFontReady = () =>
    {
        // OGLight declares the font with @font-face; it is in document.fonts once OGLight's sheet is in
        try { return Array.from(document.fonts || []).some(f => /Material Icons/i.test(f.family)); }
        catch(e) { return false; }
    };

    const addButtons = () =>
    {
        document.querySelectorAll('.anomalyMission .waveSimButton:not([data-orion-sim])').forEach(gameButton =>
        {
            gameButton.setAttribute('data-orion-sim', '1');

            const waveRow = gameButton.closest('.missionDetailsRow');
            const mission = gameButton.closest('.anomalyMission');
            if(!waveRow || !mission) return;

            const o = ogl();
            const choice = chosenSimulator(o);

            // OGLight's own simulate button, as on its spy reports: an ogl_button with the Material Icons
            // "play_arrow" glyph (the icon font is OGLight's). Without that font a plain ▶ stands in.
            const button = document.createElement('div');
            button.className = 'ogl_button material-icons tooltip orionSimButton';
            button.setAttribute('data-tooltip-title', `Open in ${choice.name} (OGLight simulator): this wave against your fleet at the anomaly`);
            button.title = button.getAttribute('data-tooltip-title');
            button.textContent = iconFontReady() ? 'play_arrow' : '▶';

            button.addEventListener('click', event =>
            {
                event.preventDefault();
                event.stopPropagation();

                const link = simLink(mission, waveRow);
                window.open(link.url, '_blank');

                if(!link.withTechs) notify('OGLight is not running on this page: your research and bonuses are not filled in', true);
                else if(!link.hasShips) notify('None of your fleets is at the anomaly when this wave lands: only the wave is filled in');
            });

            // side by side with the game's own Sim button, in the same cell
            const holder = gameButton.closest('gradient-button') || gameButton;
            holder.parentElement.classList.add('orionSimCell');
            holder.insertAdjacentElement('afterend', button);
        });
    };

    const style = document.createElement('style');
    style.textContent = `
        .anomalyMission .orionSimCell { display:flex !important; flex-direction:row; align-items:center; justify-content:center; gap:4px; }
        .anomalyMission .orionSimButton { display:inline-flex !important; align-items:center; justify-content:center; box-sizing:border-box;
            width:28px; height:28px; margin:0 !important; padding:0 !important; font-size:18px !important; line-height:28px !important;
            cursor:pointer; user-select:none; }
        .anomalyMission .orionSimButton:not(.ogl_button) { color:#ffb800; background:#171c24; border:1px solid #2d3743; border-radius:3px; }
    `;
    document.head.appendChild(style);

    // DOM-only observer (no network): the mission tab is loaded and redrawn by the game; add the button
    // to any wave row that does not have one yet.
    let scheduled = false;

    const observer = new MutationObserver(() =>
    {
        if(scheduled || !document.querySelector('.anomalyMission .waveSimButton:not([data-orion-sim])')) return;
        scheduled = true;

        requestAnimationFrame(() =>
        {
            scheduled = false;
            observer.disconnect();
            try { addButtons(); }
            finally { observer.observe(document.body, { childList:true, subtree:true }); }
        });
    });

    addButtons();
    observer.observe(document.body, { childList:true, subtree:true });
});

/*
  PART 3 — ANOMALY PROFITABILITY

  THE PROBLEM
  The scanner lists the anomalies it found, each with its possible rewards and the lithium it costs to
  redeem them, but nothing says which one is worth it: the rewards are in three resources, the cost is in
  lithium, and the two are never put side by side.

  WHAT IT DOES
  Under each scanned anomaly's table, and under each active mission's action bar, it adds one line.
  For an active mission the rewards are what has piled up so far and the cost is the collect button's
  own "lithium costs" figure, so its index reads "what collecting now is worth"; it is redone at every
  wave, since the card stays while those two figures change. The line holds:
  - the index: the rewards' value in MSU per HOUR OF YOUR LITHIUM PRODUCTION the redemption costs.
    Rewards in MSU use OGLight's own formula and ratio (Util.getMSU, options.msu; 3:2:1 when OGLight is
    not running). The hours are the redemption cost divided by the page's own lithiumProduction, which
    is per hour (what the Lithium production tab shows as "Lithium / h"). So "300M" reads: each hour of
    lithium spent on this anomaly brings back 300M MSU. The scan cost is left out: it is already paid by
    the time the results are on screen.
  - the redemption cost in hours of production, and the rewards' total MSU.
  - rewards that are not resources (random ships, and anything else the game adds) are listed apart
    and NOT counted: the page gives only a count range, not which ships, so any value would be invented.
  The cards are reordered best first and the best one gets a gold outline. When Discover removes or hides
  a card, the order and the outline move to what is left at once.
  The amounts are the "≈" figures the game prints; PvP doubling and the like are whatever the game
  already put into them.
  A lithium reward is not MSU: it is taken off the redemption cost, and an anomaly that gives back at
  least what it costs is shown as free and ranked first.
  Each scanner card also gets a launch plan: the lithium at the end of the mission (bar + production -
  what the anomalies already taken on and ending first will cost, + the lithium they give back), how many
  waves that collects, and how long to wait to collect them all. Those anomalies are remembered locally:
  the ones discovered from the scanner (on the Discover click) and the ones on the missions tab.

  COMPLIANCE (OGame Origin tool rules — see AGENTS.md):
  - §1.1/§1.2  Display only: it neither scans, nor discovers, nor redeems anything. The Discover click is
               only read, never stopped or changed.
  - §1.3/§4    NO request to the game server. It reads the scanner tab the player opened; the DOM-only
               observer handles the game redrawing that tab.
  - §4.2       No cp=, no planet switching.
  - §1.9       Nothing leaves the machine; the anomalies taken on stay in this browser's localStorage.
  - §5         Runs inside the OGame page → needs toleration before public distribution.
*/

onDomReady(function()
{
    'use strict';

    const parseNumber = text => parseInt(String(text || '').replace(/[^\d]/g, ''), 10) || 0;

    // OGLight's Util.getMSU, formula and rounding included, so the figure matches every MSU OGLight shows
    const toMSU = (metal, crystal, deut) =>
    {
        let ratio = '3:2:1';
        try { ratio = window.ogl?.db?.options?.msu || ratio; } catch(e) { /* OGLight not running */ }

        const r = String(ratio).split(':').map(Number);
        if(!(r[0] > 0 && r[1] > 0)) return Math.ceil(metal + crystal * 1.5 + deut * 3);
        return Math.ceil(metal + crystal * r[0] / r[1] + deut * r[0]);
    };

    // Lithium per hour, from whichever tab is open. The scanner tab declares `var lithiumProduction`; the
    // missions tab passes it as `orion.initMissions({ lithiumPerHour: … })`. Both are inline scripts the
    // game fetched into the page, so the script text is read when the global is not there.
    const lithiumPerHour = () =>
    {
        const value = Number(window.lithiumProduction);
        if(value > 0) return value;

        for(const script of document.querySelectorAll('#orionContent script, #orioncomponent script, #orionMission script'))
        {
            const match = script.textContent.match(/lithiumProduction\s*=\s*([\d.]+)/) || script.textContent.match(/lithiumPerHour\s*:\s*([\d.]+)/);
            if(match && Number(match[1]) > 0) return Number(match[1]);
        }

        return 0;
    };

    const compact = value =>
    {
        const abs = Math.abs(value);
        if(abs >= 1e9) return (value / 1e9).toFixed(2) + 'B';
        if(abs >= 1e6) return (value / 1e6).toFixed(1) + 'M';
        if(abs >= 1e3) return (value / 1e3).toFixed(1) + 'k';
        return String(Math.round(value));
    };

    const hoursText = hours =>
    {
        const minutes = Math.round(hours * 60);
        return Math.floor(minutes / 60) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm';
    };

    // "3h 15m", "1g 3o 20m", "45m 10s": the game writes durations with the language's own letters
    // (Italian uses g for days and o for hours), so both spellings are read.
    const durationHours = text =>
    {
        const part = re => parseInt(String(text || '').match(re)?.[1] || '0', 10);
        return part(/(\d+)\s*[dg]\b/) * 24 + part(/(\d+)\s*[ho]\b/) + part(/(\d+)\s*m\b/) / 60 + part(/(\d+)\s*s\b/) / 3600;
    };

    // Lithium in the bar right now. The text is the game's own running counter; data-value is the figure
    // the page was built with, used only when the text cannot be read.
    const lithiumNow = () =>
    {
        const el = document.querySelector('#lithiumAmount, .orionLithiumAmount');
        if(!el) return null;
        return parseNumber(el.textContent) || Math.floor(Number(el.getAttribute('data-value')) || 0);
    };

    // When the resources being converted into lithium run out, production stops. The page says when
    // (lithiumDepletionSeconds / depletionSeconds); 0 means it does not stop.
    const depletionHours = () =>
    {
        for(const script of document.querySelectorAll('#orionContent script, #orioncomponent script, #orionMission script'))
        {
            const match = script.textContent.match(/lithiumDepletionSeconds\s*=\s*(\d+)/) || script.textContent.match(/depletionSeconds\s*:\s*(\d+)/);
            if(match) return Number(match[1]) > 0 ? Number(match[1]) / 3600 : Infinity;
        }
        return Infinity;
    };

    // ---------- the anomalies already taken on ----------
    //
    // Lithium in the bar is not all free: every anomaly already discovered or running will want its
    // redemption cost, and some give lithium back as a reward. Those are kept here, in this browser only,
    // keyed by the anomaly's coordinates (the one thing the scanner card and the mission share):
    //   { coords, name, cost, lithium, endAt, source:'scanner'|'mission', at }
    // - cost / lithium: the WHOLE redemption cost and lithium reward, at the last wave.
    // - source 'scanner': written when Discover is clicked, from the card's own figures; endAt assumes
    //   the fleet leaves right away. Replaced as soon as the missions tab shows that anomaly, dropped
    //   24h after discovery if it never does.
    // - source 'mission': written every time the missions tab is drawn, with the real end timer and
    //   costs projected from the waves already done. A mission that is no longer listed has been
    //   collected or has expired, so it is dropped.
    const LEDGER_KEY = 'orionAddons.anomalies';
    const SCANNER_RECORD_TTL = 24 * 3600 * 1000;

    const loadLedger = () =>
    {
        try { return JSON.parse(localStorage.getItem(LEDGER_KEY) || '{}') || {}; }
        catch(e) { return {}; }
    };

    const saveLedger = ledger =>
    {
        try { localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger)); }
        catch(e) { /* storage blocked: the plan simply does not see other anomalies */ }
    };

    const liveLedger = () =>
    {
        const ledger = loadLedger();
        const now = Date.now();
        let changed = false;

        Object.keys(ledger).forEach(key =>
        {
            if(ledger[key].source === 'scanner' && now - ledger[key].at > SCANNER_RECORD_TTL) { delete ledger[key]; changed = true; }
        });

        if(changed) saveLedger(ledger);
        return Object.values(ledger);
    };

    const coordsText = text => (String(text || '').match(/\d+:\d+:\d+/) || [''])[0];

    // Launching NOW and collecting at the end.
    // Every anomaly already taken on has to be paid when IT ends, wherever that falls: one ending in 4h
    // still needs its lithium in 4h, so whatever this one spends before then must leave enough behind.
    // So the bar is followed over time - lithium now, plus production (until the conversion runs dry),
    // minus each taken-on anomaly's cost and plus its lithium back at its end - and the lithium free for
    // this one is the LOWEST the bar would go from this one's collection onwards. This one's own lithium
    // back arrives with its collection, so it helps the later checkpoints but cannot pay for itself.
    // The redemption cost is split evenly over the waves, as their rewards are, so the free lithium buys
    // a whole number of waves.
    // `wait` is how long from now to launch so that all waves are covered: launching that late OR LATER
    // works, since waiting only adds lithium. If no wait is ever enough (the conversion stops first),
    // wait is null. The card's own coordinates are left out, should a record for it exist.
    const launchPlan = (data, hours, waves, perHour, ownCoords) =>
    {
        const now = lithiumNow();
        if(now === null || !(perHour > 0) || !(hours > 0) || !(waves > 0) || !data.cost) return null;

        const stopsIn = depletionHours();
        const t0 = Date.now();
        const due = liveLedger()
            .filter(r => r.coords !== ownCoords)
            .map(r => ({ ...r, h:Math.max(0, (r.endAt - t0) / 3600000) }))   // already over: due now
            .sort((a, b) => a.h - b.h);

        const poolAt = h => now + perHour * Math.min(h, stopsIn) - due.reduce((sum, r) => r.h <= h ? sum + (r.cost || 0) - (r.lithium || 0) : sum, 0);
        const freeAt = h => Math.min(poolAt(h), ...due.filter(r => r.h > h).map(r => poolAt(r.h) + data.lithium));

        const free = freeAt(hours);
        const covered = Math.max(0, Math.min(waves, Math.floor(free / (data.cost / waves))));

        // freeAt only grows with a later collection, so the earliest launch that covers everything is
        // found by halving. Past the last due anomaly and the end of the conversion nothing changes any
        // more: if it is not enough there, it never is.
        let wait = 0;
        if(free < data.cost)
        {
            const totalNet = due.reduce((sum, r) => sum + (r.cost || 0) - (r.lithium || 0), 0);
            const last = due.length ? due[due.length - 1].h : 0;
            const top = Math.max(hours, last, Number.isFinite(stopsIn) ? stopsIn : (data.cost + totalNet - now) / perHour) + 1;

            if(freeAt(top) < data.cost) wait = null;
            else
            {
                let lo = hours, hi = top;
                for(let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if(freeAt(mid) >= data.cost) hi = mid; else lo = mid; }
                wait = hi - hours;
            }
        }

        return {
            free, covered, waves, due,
            reserved:Math.max(0, now + perHour * Math.min(hours, stopsIn) - free),
            msu:data.msu * covered / waves,
            wait,
        };
    };

    // The two lists the index is shown on. Each says where its cards are, where their redemption cost and
    // rewards sit, and where the line goes.
    const KINDS =
    [
        {
            // scanner results: the cost is the cell holding the lithium icon. Its exact figure is in the
            // tooltip; the cell text is rounded ("17,627M"), so only the tooltip is trusted.
            card:'.scannerResultCard',
            costText:card =>
            {
                const row = card.querySelector('.scannerResultRow:not(.header)');
                const cell = row ? Array.from(row.querySelectorAll('.cell')).find(c => c.querySelector('lithium-icon')) : null;
                return cell?.getAttribute('data-tooltip-title') || cell?.getAttribute('title') || '';
            },
            rewards:'.scannerResultRewardsList .rewardLine',
            after:'.scannerResultTable',
            coords:card => coordsText(card.querySelector('.scannerResultRow:not(.header) a')?.textContent),
            // the result row's own columns: level, target, duration, waves, distance, type, cost
            mission:card =>
            {
                const cells = card.querySelectorAll('.scannerResultRow:not(.header) > .cell');
                return { hours:durationHours(cells[2]?.textContent), waves:parseNumber(cells[3]?.textContent) };
            },
        },
        {
            // the projection of an active mission onto its last wave, for the ledger. The collect cost grows
            // by the same amount every wave (Chaos: 2.567.018 after 1 of 7 = 17.969.126 / 7, the scanner's
            // figure), so total = now / waves done * all waves. "Wave: 2 / 7" is the one on its way, so one
            // fewer is done; with no wave label left, every wave is done.
            coords:card => coordsText(card.querySelectorAll('.missionRouteLabels .routeLabelCell')[1]?.querySelector('.nodeCoords')?.textContent),
            project:(card, data, known) =>
            {
                const [incoming, total] = ((card.querySelector('.nodeWave')?.textContent || '').match(/(\d+)\s*\/\s*(\d+)/) || []).slice(1).map(Number);
                const done = total ? Math.max(0, incoming - 1) : 0;
                const scale = total && done ? total / done : 0;
                const seconds = Number(card.querySelector('[id^="despawn_"]')?.getAttribute('data-seconds')) || 0;

                // The total never shrinks, so the largest figure ever seen for this anomaly wins - the
                // scanner's own cost recorded at Discover included. With no wave done and nothing recorded,
                // the cost so far is all there is: it is kept, and flagged as partial.
                const cost = Math.max(scale ? Math.round(data.cost * scale) : data.cost, known?.cost || 0);
                const lithium = Math.max(scale ? Math.round(data.lithium * scale) : data.lithium, known?.lithium || 0);

                return {
                    cost, lithium,
                    partial:!scale && !(known?.cost > data.cost) && !!total && done < total,
                    endAt:seconds ? Date.now() + seconds * 1000 : (known?.endAt || Date.now()),
                };
            },
            // active missions: the cost is the collect button's own line ("Lithium costs: 2.567.018"), the
            // rewards are what has piled up so far, so the index is "what collecting NOW is worth". The line
            // goes under the action bar, which stays visible when the mission is collapsed.
            card:'.anomalyMission',
            costText:card => (card.querySelector('.collectRewards .btnSub')?.textContent || '').split(':').pop(),
            rewards:'.rewardsCell .rewardLine',
            after:'.missionActionBar',
        },
    ];

    // A lithium reward is told apart by the game's lithium icon, or by its name if the icon ever changes
    // ("Litio", "Lithium"). It is not MSU: it pays back part of the redemption cost instead.
    const isLithium = line => !!line.querySelector('lithium-icon') || /^\s*lit(h)?i/i.test(line.querySelector('.rewardName')?.textContent || '');

    const readCard = (card, kind) =>
    {
        const resources = { metal:0, crystal:0, deuterium:0 };
        const excluded = [];
        let lithium = 0;

        card.querySelectorAll(kind.rewards).forEach(line =>
        {
            const icon = line.querySelector('resource-icon');
            const type = icon ? Object.keys(resources).find(k => icon.classList.contains(k)) : null;
            const amount = (line.querySelector('.rewardAmount')?.textContent || '').replace(/\s+/g, ' ').trim();

            if(type) resources[type] += parseNumber(amount);
            else if(isLithium(line)) lithium += parseNumber(amount);
            else excluded.push(((line.querySelector('.rewardName')?.textContent || '').trim() + ' ' + amount).trim());
        });

        return { cost:parseNumber(kind.costText(card)), lithium, msu:toMSU(resources.metal, resources.crystal, resources.deuterium), excluded };
    };

    // The missions tab is the full list of anomalies under way: write each one into the ledger with its
    // projected totals, and drop the missions it no longer lists (collected or expired). Records from the
    // scanner are only replaced, never dropped here - an anomaly discovered but not yet flown may not be
    // on this list.
    const syncMissions = () =>
    {
        const tab = document.querySelector('#orionMission');
        if(!tab) return;
        tab.setAttribute('data-orion-synced', '1'); // see outOfDate: an empty list must be synced too

        const kind = KINDS[1];
        const ledger = loadLedger();
        const listed = new Set();

        document.querySelectorAll(kind.card).forEach(card =>
        {
            const coords = kind.coords(card);
            if(!coords) return;

            listed.add(coords);
            const data = readCard(card, kind);
            const projected = kind.project(card, data, ledger[coords]);
            const name = card.querySelector('.missionNameText')?.textContent.trim() || coords;

            ledger[coords] = { coords, name, ...projected, source:'mission', at:Date.now() };
        });

        Object.keys(ledger).forEach(key =>
        {
            if(ledger[key].source === 'mission' && !listed.has(key)) delete ledger[key];
        });

        saveLedger(ledger);
    };

    // Discover on a scanner card: note the anomaly before the game takes the card away. A capture
    // listener only reads; the click carries on to the game's own handler untouched.
    // It is only PENDING here: the game can refuse (discovery limit reached, position taken) and leave
    // the card where it is. commitPending() writes it once the card is really gone from the scanner, and
    // forgets it if the card is still there a few seconds later.
    const pending = new Map();
    const PENDING_TTL = 15000;

    document.addEventListener('click', event =>
    {
        const card = event.target.closest?.('.scannerResultCard');
        if(!card || !event.target.closest('.discoverButton')) return;

        const kind = KINDS[0];
        const coords = kind.coords(card);
        const data = readCard(card, kind);
        if(!coords || !data.cost) return;

        pending.set(coords,
        {
            coords,
            name:card.querySelector('.scannerResultName')?.textContent.trim() || coords,
            cost:data.cost,
            lithium:data.lithium,
            endAt:Date.now() + (kind.mission(card).hours || 0) * 3600 * 1000,
            source:'scanner',
            at:Date.now(),
        });
    }, true);

    const commitPending = () =>
    {
        if(!pending.size) return;

        const onScreen = new Set(Array.from(document.querySelectorAll(KINDS[0].card)).filter(isShown).map(KINDS[0].coords));
        const ledger = loadLedger();

        pending.forEach((record, coords) =>
        {
            if(!onScreen.has(coords))
            {
                if(ledger[coords]?.source !== 'mission') ledger[coords] = record; // real figures win
                pending.delete(coords);
            }
            else if(Date.now() - record.at > PENDING_TTL) pending.delete(coords); // refused by the game
        });

        saveLedger(ledger);
    };

    const endsIn = r => r.endAt <= Date.now() ? 'over, due now' : 'ends in ' + hoursText((r.endAt - Date.now()) / 3600000);
    const recordList = records => records.map(r => `${r.name} [${r.coords}] ${compact(r.cost)}` + (r.partial ? ' (so far)' : '') +
        (r.lithium ? ` −${compact(r.lithium)} back` : '') + `, ${endsIn(r)}`).join('\n  ');

    // Above the scanner results: what the plans below are holding back, so the memory can be checked.
    const renderReserve = () =>
    {
        document.querySelectorAll('.orionReserve').forEach(n => n.remove());

        const first = document.querySelector(KINDS[0].card);
        if(!first) return;

        const records = liveLedger().sort((a, b) => a.endAt - b.endAt);
        const box = document.createElement('div');
        box.className = 'orionReserve';

        if(!records.length)
        {
            box.innerHTML = 'No anomaly under way is remembered. If you have some, open the missions tab once so their lithium is counted.';
        }
        else
        {
            const total = records.reduce((sum, r) => sum + (r.cost || 0) - (r.lithium || 0), 0);
            box.innerHTML = `Lithium still to pay for <b>${records.length}</b> anomal${records.length > 1 ? 'ies' : 'y'} under way: <b>${compact(total)}</b>` +
                records.map(r => `<div class="orionReserveRow">${r.name} [${r.coords}] · <b>${compact(r.cost)}</b>` +
                    (r.partial ? ' <span class="orionProfitShortText">cost so far - total not known yet</span>' : '') +
                    (r.lithium ? ` · ${compact(r.lithium)} back` : '') + ` · ${endsIn(r)}</div>`).join('');
        }

        // before the list, not inside it: the game owns that container
        first.parentElement.insertAdjacentElement('beforebegin', box);
    };

    // What the index depends on. A mission keeps its card while each wave adds rewards and raises the
    // collect cost, so a changed fingerprint has to redo it just like a new card would.
    const fingerprint = (card, kind) =>
        kind.costText(card) + '|' + Array.from(card.querySelectorAll(kind.rewards)).map(l => l.textContent).join('|').replace(/\s+/g, ' ');

    // A card counts while it is in the page AND shown: after "Discover" the game may remove it or just
    // hide it, and either way it must stop being the best.
    const isShown = card => card.isConnected && card.getClientRects().length > 0;

    let rendered = [];   // the shown cards as of the last render, all lists together

    const renderKind = (kind, perHour) =>
    {
        const cards = Array.from(document.querySelectorAll(kind.card));
        const scored = [];

        cards.forEach(card =>
        {
            card.setAttribute('data-orion-profit', fingerprint(card, kind));
            card.classList.remove('orionProfitBest');
            card.querySelector('.orionProfit')?.remove();

            const data = readCard(card, kind);
            const box = document.createElement('div');
            box.className = 'orionProfit';
            let index = -1;   // no readable cost: ranked last, never best

            if(!data.cost)
            {
                box.innerHTML = `<span>rewards <b>${compact(data.msu)}</b> MSU</span><span class="orionProfitMuted">no lithium cost shown</span>`;
            }
            else
            {
                // What the anomaly really costs in lithium is the redemption minus the lithium it gives back.
                // One that gives back at least as much costs nothing: it ranks above every other, and among
                // those the larger reward wins.
                const net = data.cost - data.lithium;
                const unit = perHour > 0 ? 'MSU per hour of lithium' : 'MSU per 1M lithium';

                if(net > 0)
                {
                    // MSU per hour of lithium production; without the production figure the same ratio per
                    // million lithium, which ranks the anomalies identically
                    index = perHour > 0 ? data.msu * perHour / net : data.msu * 1e6 / net;
                    box.innerHTML =
                        `<span class="orionProfitIndex"><b>${compact(index)}</b> ${unit}</span>` +
                        (perHour > 0 ? `<span>redeeming = <b>${hoursText(net / perHour)}</b> of production</span>` : '');
                }
                else
                {
                    index = 1e18 + data.msu;
                    box.innerHTML = `<span class="orionProfitIndex"><b>free</b> - the lithium it gives back covers its cost</span>`;
                }

                box.innerHTML += `<span>rewards <b>${compact(data.msu)}</b> MSU</span>` +
                    (data.lithium ? `<span>lithium <b>${compact(data.cost)}</b> paid, <b>${compact(data.lithium)}</b> back</span>` : '');

                const shape = kind.mission ? kind.mission(card) : null;
                const plan = shape ? launchPlan(data, shape.hours, shape.waves, perHour, kind.coords(card)) : null;

                if(plan)
                {
                    const line = document.createElement('span');
                    line.className = 'orionProfitPlan' + (plan.covered < plan.waves ? ' orionProfitShort' : '');
                    line.title =
                        `Lithium now plus ${hoursText(shape.hours)} of production, collected at the end, keeping back what the anomalies under way will need when they end:` +
                        (plan.due.length ? `\n  ${recordList(plan.due)}` : ' none remembered.') +
                        (data.lithium ? `\nThis anomaly's own ${compact(data.lithium)} lithium back arrives with the collection, so it cannot pay for it.` : '');

                    const heldText = plan.reserved > 0 ? ` (<b>${compact(plan.reserved)}</b> held back for ${plan.due.length} under way)` : '';
                    line.innerHTML = plan.covered >= plan.waves
                        ? `launch now: <b>${compact(plan.free)}</b> lithium free at the end${heldText} collects <b>all ${plan.waves} waves</b>, ≈<b>${compact(plan.msu)}</b> MSU`
                        : `launch now: <b>${compact(Math.max(0, plan.free))}</b> lithium free at the end${heldText} collects <b>${plan.covered}/${plan.waves} waves</b>, ≈<b>${compact(plan.msu)}</b> MSU` +
                          (plan.wait === null
                              ? ` · not all ${plan.waves}: lithium production stops before it gets there`
                              : ` · all ${plan.waves} if launched <b>${hoursText(plan.wait)}</b> from now or later`);
                    box.appendChild(line);
                }
            }

            if(data.excluded.length)
            {
                const extra = document.createElement('span');
                extra.className = 'orionProfitMuted';
                extra.textContent = 'not counted: ' + data.excluded.join(', ');
                box.appendChild(extra);
            }

            const anchor = card.querySelector(kind.after);
            if(anchor) anchor.insertAdjacentElement('afterend', box);
            else card.appendChild(box);

            scored.push({ card, index });
        });

        // best first, within the list each card already sits in. Only the cards move: each keeps its own
        // buttons and the anomaly id inside them, so what a click does is unchanged.
        scored.sort((a, b) => b.index - a.index);
        scored.forEach(({ card }) => card.parentElement.appendChild(card));

        const shown = scored.filter(s => isShown(s.card));
        if(shown.length > 1 && shown[0].index >= 0) shown[0].card.classList.add('orionProfitBest');

        return shown.map(s => s.card);
    };

    const render = () =>
    {
        const perHour = lithiumPerHour();
        syncMissions();
        commitPending();
        rendered = KINDS.flatMap(kind => renderKind(kind, perHour));
        renderReserve();
    };

    // Something changed for the cards since the last render: a new one, one gone, one hidden/shown, or
    // its cost or rewards moved.
    const outOfDate = () =>
    {
        // a freshly fetched missions tab, even one listing no mission at all, still has to clear the ledger
        if(document.querySelector('#orionMission:not([data-orion-synced])')) return true;

        const shown = [];

        for(const kind of KINDS)
        {
            for(const card of document.querySelectorAll(kind.card))
            {
                if(card.getAttribute('data-orion-profit') !== fingerprint(card, kind)) return true;
                if(isShown(card)) shown.push(card);
            }
        }

        return shown.length !== rendered.length || shown.some(card => !rendered.includes(card));
    };

    const style = document.createElement('style');
    style.textContent = `
        .orionProfit { display:flex; flex-wrap:wrap; align-items:baseline; gap:3px 14px; margin:6px 0 2px; padding:5px 8px;
            font-size:11px; color:#a9b7c6; background:rgba(0,0,0,.28); border-radius:3px; }
        .orionProfit b { color:#fff; }
        .orionProfit .orionProfitIndex { font-size:13px; }
        .orionProfit .orionProfitMuted { color:#7c8a99; }
        .orionProfitBest { outline:2px solid #ffb800; outline-offset:-2px; }
        .orionProfitBest .orionProfitIndex b { color:#ffb800; }
        .orionProfit .orionProfitPlan { flex-basis:100%; padding-top:3px; border-top:1px solid rgba(255,255,255,.06); color:#8fd19e; }
        .orionProfit .orionProfitPlan.orionProfitShort { color:#e0b25a; }
        .orionReserve { margin:4px 0 8px; padding:6px 9px; font-size:11px; color:#a9b7c6; background:rgba(0,0,0,.35); border:1px solid rgba(224,178,90,.35); border-radius:3px; }
        .orionReserve b { color:#fff; }
        .orionReserve .orionReserveRow { margin-top:2px; color:#8d9bab; }
        .orionReserve .orionProfitShortText { color:#e0b25a; }
    `;
    document.head.appendChild(style);

    // DOM-only observer (no network): the game fetches and redraws both tabs, Discover removes or hides a
    // scanner card, and every wave changes an active mission's rewards. Any of those redoes the list, so
    // the order and the best one always follow what is on screen. Our own changes happen with the
    // observer disconnected.
    let scheduled = false;
    const watch = () => observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['style', 'class', 'hidden'] });

    const observer = new MutationObserver(() =>
    {
        if(scheduled) return;
        scheduled = true;

        requestAnimationFrame(() =>
        {
            scheduled = false;
            if(!outOfDate()) return;

            observer.disconnect();
            try { render(); }
            finally { watch(); }
        });
    });

    if(document.querySelector('#orionMission') || KINDS.some(kind => document.querySelector(kind.card))) render();
    watch();
});
