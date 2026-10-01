// ==UserScript==
// @name         Orion Costs for OGLight
// @namespace    https://github.com/nicolagalassi
// @version      0.5.0
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
     MANUAL_FORMULAS below and wins over the estimate (the Scanner, 45, and the Recovery Center, 4001,
     are already there).

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

    const renderOwn = (panel, id) =>
    {
        const costs = panel.querySelector('.costs');
        const gameCosts = readGameCosts(panel);
        if(!costs || !gameCosts) return;

        const store = loadStore();
        const initial = readGameLevel(panel, id);
        const offset = parseInt(panel.dataset.oglOrionOffset || '0', 10);
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
            const hint = 'Orion Costs for OGLight: open the panel at two different levels to estimate this';

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
        ['metal', 'crystal', 'deut'].forEach(r => { const c = costAt(id, level, r, store); levelCosts[r] = c ? c.value : 0; });
        const totalCosts = { metal:totals.metal?.value, crystal:totals.crystal?.value, deut:totals.deut?.value };
        cell(msuRow, unknown ? '?' : formatUnits(msuOf(levelCosts)), 'tooltip', unknown ? '' : formatFull(msuOf(levelCosts)));
        cell(msuRow, unknown ? '?' : formatUnits(msuOf(totalCosts)), 'ogl_text tooltip', unknown ? '' : formatFull(msuOf(totalCosts)));
        wrapper.appendChild(msuRow);

        if(!wrapper.parentElement) costs.appendChild(wrapper);

        // OGLight writes the range into the title in place of "Level N"
        const title = panel.querySelector('.information .level');
        if(title) title.innerHTML = `${from} <i class="material-icons">east</i> ${level}`;

        // the game's build time is for the next level only; hide it while another level is shown
        const duration = panel.querySelector('.information .build_duration');
        if(duration) duration.style.visibility = offset === 0 ? '' : 'hidden';

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
            let offset = parseInt(panel.dataset.oglOrionOffset || '0', 10);

            if(action === 'chevron_left' && offset > 1 - initial) offset--;
            else if(action === 'chevron_right') offset++;
            else if(action === 'close') offset = 0;
            else return;

            panel.dataset.oglOrionOffset = String(offset);
            renderOwn(panel, id);
        });
    };

    // On the Orion control center OGLight does not run, so its ‹ × › buttons are missing too. We add the
    // same three, with OGLight's classes and in OGLight's place, so every Orion panel steps through
    // levels the same way. Display only: they change the level shown, nothing is sent to the game.
    const addArrows = details =>
    {
        if(details.querySelector('.ogl_actions')) return;

        const sprite = details.querySelector('.sprite') || details.querySelector('.sprite_large');
        if(!sprite) return;

        const actions = document.createElement('div');
        actions.className = 'ogl_actions oglOrion_actions';

        ['chevron_left', 'close', 'chevron_right'].forEach(icon =>
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

        // remember what the game showed, so other levels can be estimated later
        store[id] = store[id] || {};
        store[id][gameLevel] = gameCosts;
        saveStore(store);

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
