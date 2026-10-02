// ==UserScript==
// @name         Orion Sim for OGLight
// @namespace    https://github.com/nicolagalassi
// @version      0.2.0
// @description  Add-on for OGLight: a button next to each anomaly-mission wave that opens the battle simulator chosen in OGLight, pre-filled with that wave's NPC fleet and your fleet at the anomaly. Display only.
// @author       nicolagalassi
// @match        https://*.ogame.gameforge.com/game/*
// @icon         https://gf1.geo.gfsrv.net/cdn3d/favicon.ico
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/*
  Orion Sim for OGLight — a small add-on that runs NEXT TO OGLight.

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

(function()
{
    'use strict';

    // The simulators OGLight offers (OGLight 5.3.3, Util.simList) and how each takes the pre-fill.
    // OGLight's choice is window.ogl.db.options.sim; an unknown or missing choice uses the first one.
    const SIMULATORS =
    {
        'simulator.ogame-tools': { name:'simulator.ogame-tools.com', url:lang => `https://simulator.ogame-tools.com/${lang}` },
        osims: { name:'Osims', url:() => 'https://www.ogameutilities.it/Osims/' },
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
        console.info('[Orion Sim for OGLight] ' + message);
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

        const choice = o?.db?.options?.sim;
        const sim = SIMULATORS[choice] || SIMULATORS[Object.keys(SIMULATORS)[0]];

        return {
            url:sim.url(lang) + '#prefill=' + btoa(JSON.stringify(data)),
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
            const choice = SIMULATORS[o?.db?.options?.sim] || SIMULATORS[Object.keys(SIMULATORS)[0]];

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
})();
