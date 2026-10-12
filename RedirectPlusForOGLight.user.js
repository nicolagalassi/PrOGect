// ==UserScript==
// @name         OGLight Redirect Plus
// @namespace    https://github.com/nicolagalassi
// @version      0.1.0
// @description  Two options for OGLight's "Redirect to the next planet/moon" after an expedition: move on only after N sends from the same planet/moon, and skip chosen planets/moons. The send stays yours: one Enter, one fleet.
// @author       nicolagalassi
// @match        https://*.ogame.gameforge.com/game/*
// @icon         https://gf1.geo.gfsrv.net/cdn3d/favicon.ico
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/*
  OGLight Redirect Plus — runs NEXT TO OGLight and changes one thing: where OGLight's expedition
  redirect goes after a send.

  WHAT OGLIGHT DOES ON ITS OWN
  In expedition mode (the L / expedition shortcut) OGLight fills the dispatch and the player sends with
  Enter. After the send OGLight reloads the fleet page with the expedition pre-filled again:
  - option "Redirect to the next planet/moon" OFF → on the SAME planet/moon (redirectToPlanet(0));
  - option ON → on the NEXT planet/moon of the list (redirectToPlanet(1)).

  WHAT THIS ADDS (only while that OGLight option is ON)
  1. Sends per planet/moon (N): OGLight stays on the same body for the first N-1 sends - exactly what it
     does with the option OFF - and goes to the next one after the N-th. N = 1 is OGLight unchanged.
     Example, N = 5: 5 expeditions from the first moon, then 5 from the second, then 5 from the third.
  2. Skip list: a planet/moon on the list is jumped over by the redirect; it goes to the next one that
     is not skipped. "Skip this planet/moon" on the fleet page adds or removes the body you are on.
  Bodies on the skip list get a dashed red outline in the planet list.

  HOW IT HOOKS INTO OGLIGHT
  OGLight puts its instance on the page as window.ogl. Its fleet manager (ogl._fleet.fleetSent) runs
  after the game has confirmed a send and calls ogl._shortcut.redirectToPlanet(1) when the redirect
  option is on. This script wraps those two methods of the running instance:
  - fleetSent only raises a flag for the duration of the call, so the redirect wrapper can tell the
    after-send redirect apart from the player's own arrow-key planet switch (left untouched);
  - redirectToPlanet(1) after a send becomes redirectToPlanet(0) until the N-th send, and on the N-th
    the cp OGLight would navigate to is replaced with the next body that is not skipped.
  Built against OGLight's structure as of 5.3.3 / 5.4.x (fleetSent, redirectToPlanet, getRedirectionLink,
  account.planets). If a future OGLight renames them, the panel says "not compatible" and the script
  does nothing at all - OGLight keeps working exactly as before.

  COMPLIANCE (OGame Origin tool rules — see AGENTS.md):
  - GRAY AREA: requires ToolDev approval before publishing — see AGENTS.md §3. It is a comfort feature
    that changes the game flow after a send (which page loads next). It adds no game action and no
    navigation that OGLight does not already do: it only picks between OGLight's own two outcomes
    (stay / go next) and which "next". Ask a ToolDev before publishing anyway, and mention that it
    changes how another tool (OGLight) behaves.
  - §1.1 1 click = 1 action: nothing is ever sent by this script. Every fleet still leaves only on the
    player's own Enter / click in the game's dispatch; the counter only decides which page loads next.
  - §1.2 / §1.3 no scheduling, no auto-refresh: the redirect happens only as the direct result of a
    send the player just made, exactly when OGLight would redirect anyway. No timer fires a navigation.
  - §4 no background calls: the script makes no request to the game. The cp= in the redirect is a
    normal page navigation (the same one OGLight makes), not a background call. The only timer is a
    local check, for a few seconds after page load, waiting for OGLight to finish starting.
  - §1.6 not a Dark Matter feature: no queue of any kind, nothing is prepared ahead of time.
  - §1.9 nothing leaves the machine: settings, skip list and the counter live in this browser's
    localStorage, per universe.
*/

(function()
{
    'use strict';

    const STORE_KEY = 'orp_redirect_plus_' + location.host;   // one set of settings per universe
    const MAX_PER_BODY = 50;

    // ---------- storage (localStorage, this browser only — §1.9) ----------

    function load()
    {
        let s = null;
        try { s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch(e) { s = null; }
        s = s && typeof s === 'object' ? s : {};
        return {
            perBody: clamp(parseInt(s.perBody) || 1),
            skipped: Array.isArray(s.skipped) ? s.skipped.filter(b => b && b.id) : [],
            // the running streak: how many expeditions have been sent from body `id` in a row
            streak: s.streak && s.streak.id ? { id:String(s.streak.id), count:parseInt(s.streak.count) || 0 } : null,
        };
    }

    function save(s)
    {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch(e) { /* private window: settings just don't stick */ }
    }

    const clamp = n => Math.max(1, Math.min(MAX_PER_BODY, n));

    // ---------- the body the player is on ----------

    const meta = name => document.querySelector(`head meta[name="${name}"]`)?.getAttribute('content') || '';
    const currentId = () => meta('ogame-planet-id');
    const currentIsMoon = () => meta('ogame-planet-type') === 'moon';
    const currentLabel = () => `[${meta('ogame-planet-coordinates')}] ${currentIsMoon() ? 'moon' : 'planet'}`;

    const isSkipped = (s, id) => s.skipped.some(b => String(b.id) === String(id));

    // Planets in planet-list order, from OGLight's own list (the order its redirect follows); read from the
    // planet list if OGLight's list is not there. Each entry: { id, moonID } (moonID -1 when no moon).
    function planetList(ogl)
    {
        const own = ogl?.account?.planets;
        if(Array.isArray(own) && own.length) return own.map(p => ({ id:String(p.id), moonID:String(p.moonID) }));

        const cpOf = a => a ? (new URLSearchParams((a.getAttribute('href') || '').split('?')[1] || '').get('cp') || '').split('#')[0] : '';
        return [...document.querySelectorAll('#planetList .smallplanet')].map(line => ({
            id: cpOf(line.querySelector('.planetlink')) || '-1',
            moonID: cpOf(line.querySelector('.moonlink')) || '-1',
        })).filter(p => p.id !== '-1');
    }

    // The next body of the same kind (moon → moon, planet → planet) after the current one that is not on
    // the skip list and is not the fleet's destination (OGLight skips the destination too). null when there
    // is none, e.g. every other moon is skipped.
    function nextGoodBody(ogl, s)
    {
        const moon = currentIsMoon();
        const ids = planetList(ogl).map(p => moon ? p.moonID : p.id).filter(id => id && id !== '-1' && id !== 'undefined');
        const here = ids.indexOf(currentId());
        if(here < 0 || ids.length < 2) return null;

        const destination = new URLSearchParams(location.search).get('ogldestinationid');
        for(let i = 1; i < ids.length; i++)
        {
            const id = ids[(here + i) % ids.length];
            if(id === currentId()) continue;
            if(destination && id === String(destination)) continue;
            if(isSkipped(s, id)) continue;
            return id;
        }
        return null;
    }

    // ---------- the hook into OGLight ----------

    function compatible(ogl)
    {
        return !!(ogl && ogl._fleet && typeof ogl._fleet.fleetSent === 'function'
            && ogl._shortcut && typeof ogl._shortcut.redirectToPlanet === 'function'
            && typeof ogl._shortcut.getRedirectionLink === 'function');
    }

    function install(ogl)
    {
        const fleet = ogl._fleet;
        const shortcut = ogl._shortcut;
        if(shortcut.__orpInstalled) return;
        shortcut.__orpInstalled = true;

        // Raised only while OGLight handles a send the game has just confirmed — the player's own send.
        let inFleetSent = false;

        const originalSent = fleet.fleetSent;
        fleet.fleetSent = function(...args)
        {
            inFleetSent = true;
            try { return originalSent.apply(this, args); }
            finally { inFleetSent = false; }
        };

        const originalRedirect = shortcut.redirectToPlanet;
        shortcut.redirectToPlanet = function(direction, ...rest)
        {
            // Not the after-send expedition redirect (arrow keys, other OGLight modes, redirect option off):
            // OGLight as it is. ogl.mode is 5 here only for a real expedition (mission 15) — OGLight resets it
            // to 0 for any other mission before redirecting.
            if(!inFleetSent || direction !== 1 || ogl.mode !== 5) return originalRedirect.call(this, direction, ...rest);

            const s = load();
            const here = currentId();
            const done = (s.streak && s.streak.id === here ? s.streak.count : 0) + 1;

            // Fewer than N sends from this body: stay, i.e. what OGLight does with its redirect option off.
            if(done < s.perBody)
            {
                s.streak = { id:here, count:done };
                save(s);
                return originalRedirect.call(this, 0, ...rest);
            }

            s.streak = null;
            save(s);

            const target = nextGoodBody(ogl, s);
            if(!target) return originalRedirect.call(this, 0, ...rest);   // nothing else to go to: stay

            // Let OGLight build its own link (same page, same oglmode, same params) and only swap the cp it
            // picked for ours. Restored right after: nothing else ever sees the swapped method.
            const hadOwn = Object.prototype.hasOwnProperty.call(this, 'getRedirectionLink');
            const originalLink = this.getRedirectionLink;
            this.getRedirectionLink = function(params)
            {
                params = params || {};
                if(params.cp) params.cp = target;
                return originalLink.call(this, params);
            };
            try { return originalRedirect.call(this, 1, ...rest); }
            finally
            {
                if(hadOwn) this.getRedirectionLink = originalLink;
                else delete this.getRedirectionLink;
            }
        };
    }

    // ---------- UI ----------

    function addStyle()
    {
        const css = `
            #orp_panel{margin:6px 0 8px;padding:6px 10px;background:#0d1014;border:1px solid #2b3440;border-radius:4px;color:#9aa6b2;font:11px Verdana,Arial,sans-serif;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
            #orp_panel b{color:#d3dae2}
            #orp_panel .orp_title{color:#6f9fd8;font-weight:bold}
            #orp_panel button{background:#1c232c;border:1px solid #3a4655;color:#d3dae2;border-radius:3px;cursor:pointer;padding:0 6px;line-height:16px;font:inherit}
            #orp_panel button:hover{border-color:#6f9fd8}
            #orp_panel .orp_n{display:inline-block;min-width:18px;text-align:center;color:#fff;font-weight:bold}
            #orp_panel label{cursor:pointer}
            #orp_panel .orp_warn{color:#d8a43f;flex-basis:100%}
            #orp_panel .orp_chip{display:inline-block;background:#1c232c;border:1px solid #3a4655;border-radius:3px;padding:0 4px;margin:0 3px 0 0}
            #orp_panel .orp_chip button{border:0;background:none;padding:0 0 0 3px;color:#c55}
            #planetList .orp_skipped{outline:1px dashed #c33;outline-offset:-1px}
        `;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    // Dashed outline on the planet list for bodies on the skip list (display only).
    function markPlanetList(s)
    {
        document.querySelectorAll('#planetList .orp_skipped').forEach(a => { a.classList.remove('orp_skipped'); a.removeAttribute('data-orp-title'); });
        document.querySelectorAll('#planetList .planetlink, #planetList .moonlink').forEach(a =>
        {
            const id = (new URLSearchParams((a.getAttribute('href') || '').split('?')[1] || '').get('cp') || '').split('#')[0];
            if(id && isSkipped(s, id)) a.classList.add('orp_skipped');
        });
    }

    const el = (tag, props, ...children) =>
    {
        const e = document.createElement(tag);
        Object.assign(e, props || {});
        children.forEach(c => e.append(c));
        return e;
    };

    function renderPanel(ogl)
    {
        const host = document.querySelector('#fleetdispatchcomponent');
        if(!host || !document.querySelector('#fleet1')) return;   // only on the first fleet-dispatch step

        let panel = document.querySelector('#orp_panel');
        if(!panel)
        {
            panel = el('div', { id:'orp_panel' });
            host.prepend(panel);
        }
        panel.textContent = '';

        const s = load();
        const here = currentId();
        const bodyWord = currentIsMoon() ? 'moon' : 'planet';

        panel.append(el('span', { className:'orp_title', textContent:'Redirect Plus' }));

        if(!compatible(ogl))
        {
            panel.append(el('span', { className:'orp_warn', textContent: ogl
                ? 'This OGLight version is not compatible: Redirect Plus is doing nothing, OGLight works as usual.'
                : 'OGLight not found: Redirect Plus only works together with OGLight.' }));
            return;
        }

        // sends per body
        const setN = n => { const t = load(); t.perBody = clamp(n); save(t); renderPanel(ogl); };
        panel.append(el('span', {},
            'Sends per planet/moon: ',
            el('button', { type:'button', textContent:'−', title:'One less', onclick:() => setN(s.perBody - 1) }),
            el('span', { className:'orp_n', textContent:String(s.perBody) }),
            el('button', { type:'button', textContent:'+', title:'One more', onclick:() => setN(s.perBody + 1) })));

        // progress on this body
        const done = s.streak && s.streak.id === here ? s.streak.count : 0;
        if(s.perBody > 1)
        {
            panel.append(el('span', {}, `This ${bodyWord}: `, el('b', { textContent:`${done}/${s.perBody}` }), ' sent ',
                el('button', { type:'button', textContent:'reset', title:'Start counting again from 0 on this ' + bodyWord, onclick:() =>
                {
                    const t = load(); t.streak = null; save(t); renderPanel(ogl);
                }})));
        }

        // skip this body
        const box = el('input', { type:'checkbox', checked:isSkipped(s, here), onchange:() =>
        {
            const t = load();
            if(isSkipped(t, here)) t.skipped = t.skipped.filter(b => String(b.id) !== String(here));
            else t.skipped.push({ id:here, label:currentLabel() });
            save(t);
            markPlanetList(t);
            renderPanel(ogl);
        }});
        panel.append(el('label', { title:`The redirect jumps over this ${bodyWord} and goes to the next one` }, box, ` Skip this ${bodyWord}`));

        // the skip list, with a way to take any body off it from here
        if(s.skipped.length)
        {
            const list = el('span', {}, 'Skipped: ');
            s.skipped.forEach(b => list.append(el('span', { className:'orp_chip' }, b.label || b.id,
                el('button', { type:'button', textContent:'×', title:'Stop skipping it', onclick:() =>
                {
                    const t = load();
                    t.skipped = t.skipped.filter(x => String(x.id) !== String(b.id));
                    save(t);
                    markPlanetList(t);
                    renderPanel(ogl);
                }}))));
            panel.append(list);
        }

        // Everything above only acts through OGLight's own redirect: say so when that option is off.
        if(!ogl.db?.options?.expeditionRedirect)
        {
            panel.append(el('span', { className:'orp_warn',
                textContent:'OGLight\'s "Redirect to the next planet/moon" option is off: after a send OGLight stays on this ' + bodyWord + ' and Redirect Plus does nothing. Turn it on in OGLight\'s settings to use it.' }));
        }
    }

    // ---------- start ----------

    addStyle();
    markPlanetList(load());

    // OGLight starts asynchronously; wait for its instance. A local check only (no request to the game),
    // given up after ~10 seconds.
    let tries = 0;
    (function waitForOGLight()
    {
        const ogl = window.ogl;
        if(compatible(ogl))
        {
            install(ogl);
            renderPanel(ogl);
            return;
        }
        if(++tries < 40) return setTimeout(waitForOGLight, 250);
        renderPanel(ogl || null);   // shows why it does nothing
    })();
})();
