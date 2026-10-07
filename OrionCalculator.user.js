// ==UserScript==
// @name         OGame Orion Calculator
// @namespace    https://github.com/nicolagalassi
// @version      1.2.0
// @description  Project Orion test server: what each scanned anomaly and each active mission pays per hour of lithium production, best first; a launch plan per anomaly that keeps the lithium for the anomalies already under way; how many scans the lithium can pay for without starving them; and a searchable archive of every anomaly taken on (level, stars, PvP/PvE, type, lithium, rewards collected). Display only.
// @author       nicolagalassi
// @match        https://s808-en.ogame.gameforge.com/game/*
// @icon         https://gf1.geo.gfsrv.net/cdn3d/favicon.ico
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/*
  OGame Orion Calculator — profitability and lithium planning for Project Orion anomalies.

  WHERE IT RUNS
  Only on the Project Orion test server (s808-en, @match above): Orion does not exist anywhere else yet.
  When Orion reaches other servers, add their @match lines.

  It does not need OGLight. When OGLight is running, its MSU ratio (options.msu) is used; otherwise 3:2:1.
  It used to be PART 3 of "OGLight Orion Addons" and was split out so the OGLight fixes and this
  calculator can be installed, updated and tolerated separately.

  THE PROBLEM
  The scanner lists the anomalies it found, each with its possible rewards and the lithium it costs to
  redeem them, but nothing says which one is worth it: the rewards are in three resources, the cost is in
  lithium, and the two are never put side by side. Nor does anything say whether the lithium in the bar
  is really free, when anomalies already under way will want theirs.

  WHAT IT DOES
  Under each scanned anomaly's table, and under each active mission's action bar, it adds one line:
  - the index: the rewards' value in MSU per HOUR OF YOUR LITHIUM PRODUCTION the redemption costs.
    Rewards in MSU use OGLight's own formula (Util.getMSU) and ratio. The hours are the redemption cost
    divided by the page's own lithium production per hour. So "300M" reads: each hour of lithium spent
    on this anomaly brings back 300M MSU. The scan cost is left out: it is already paid by the time the
    results are on screen.
    For an active mission the rewards are what has piled up so far and the cost is the collect button's
    own "lithium costs" figure, so its index reads "what collecting now is worth"; it is redone at every
    wave, since the card stays while those two figures change.
  - the redemption cost in hours of production, and the rewards' total MSU.
  - a lithium reward is not MSU: it is taken off the redemption cost, and an anomaly that gives back at
    least what it costs is shown as free and ranked first.
  - rewards that are not resources (random ships, and anything else the game adds) are listed apart
    and NOT counted: the page gives only a count range, not which ships, so any value would be invented.
  The cards are reordered best first and the best one gets a gold outline. When Discover removes or hides
  a card, the order and the outline move to what is left at once.
  The amounts are the "≈" figures the game prints; PvP doubling and the like are whatever the game
  already put into them.

  LITHIUM PLANNING
  - The anomalies taken on are remembered locally, by coordinates: the ones discovered from the scanner
    (recorded once the card has really left the scanner, so a refused Discover is not) and the ones on the
    missions tab, whose total cost is projected from the waves already done.
  - The bar is followed over time: lithium now, plus production until the conversion runs dry, minus each
    anomaly's cost and plus its lithium back at its own end.
  - Each scanner card gets a launch plan: the lithium free at the end is the lowest the bar would go from
    its collection onwards, the number of waves that buys, and the earliest launch that collects them all
    ("from now or later": waiting only adds lithium).
  - Above the results: how many scans can be paid now, i.e. the lowest the bar would go from now on
    divided by the scan cost, and the list of anomalies being held back for.

  ANOMALY ARCHIVE
  The ledger above forgets an anomaly once it is collected; the archive keeps it, in this browser only
  (localStorage "orionArchive.v1"), keyed by the game's own id for it (data-space-object-id).
  - Every time the missions tab is drawn, each anomaly listed is written down or updated: name,
    coordinates, level, difficulty stars, PvP/PvE, type (e.g. "Battle"), when it appeared, waves reached.
  - A press of the game's collect button is READ by a capture listener: the rewards on screen and the
    lithium the button says it costs are noted, and saved as a collection once the game has really paid
    them out (the card's rewards changed or the card is gone). A click the game refuses is forgotten
    after 20 s. Lithium back is taken from the lithium rewards; resources are also given in MSU; rewards
    that are not resources (ships…) are kept as the game's text.
  - An anomaly no longer listed is closed: "collected" with at least one collection saved, "expired"
    otherwise.
  - A button above every Orion tab opens it as a table: search, filters (mode, type, stars, status),
    sorting by any column, totals of the rows shown, CSV/JSON export (a file saved on your own computer,
    only when clicked), delete a row or clear everything.
  It cannot know rewards collected while the script was not installed, or on another browser.

  COMPLIANCE (OGame Origin tool rules — see AGENTS.md):
  - §1.1/§1.2  Display only: it neither scans, nor discovers, nor redeems anything. The Discover and
               collect clicks are only read, never stopped, delayed, changed or repeated.
  - §1.3/§4    NO request to the game server. It reads the Orion tabs the player opened; the DOM-only
               observer handles the game redrawing them.
  - §4.2       No cp=, no planet switching.
  - §1.9       Nothing leaves the machine; the anomalies taken on and the archive stay in this browser's
               localStorage. Export only writes a file locally, on an explicit click.
  - §1.4       No alarm or notification of any kind.
  - §5         Runs inside the OGame page → needs toleration before public distribution.
*/

const onDomReady = fn => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn, { once:true }) : fn();

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

    // How many scans the bar can pay for right now. A scan is paid on the spot, so the lithium free for
    // scans is the lowest the bar would go from NOW onwards, given every anomaly under way paid at its
    // own end - the same timeline as the launch plan, seen from the present. Spending more than that
    // would leave one of them unredeemable when it ends. The anomalies a scan might find are not known
    // yet, so they are not reserved for.
    const scanCost = () =>
    {
        const el = document.querySelector('#scanCostValue');
        return el ? parseNumber(el.getAttribute('data-tooltip-title')) || parseNumber(el.textContent) : 0;
    };

    const scansPossible = perHour =>
    {
        const now = lithiumNow(), cost = scanCost();
        if(now === null || !cost) return null;

        const stopsIn = depletionHours();
        const t0 = Date.now();
        const due = liveLedger().map(r => ({ ...r, h:Math.max(0, (r.endAt - t0) / 3600000) }));
        const poolAt = h => now + (perHour > 0 ? perHour : 0) * Math.min(h, stopsIn) - due.reduce((sum, r) => r.h <= h ? sum + (r.cost || 0) - (r.lithium || 0) : sum, 0);

        const free = Math.min(poolAt(0), ...due.map(r => poolAt(r.h)));
        return { cost, free, count:Math.max(0, Math.floor(free / cost)) };
    };

    // Above the scanner results: how many scans are safe, and what is being held back for, so the
    // memory can be checked. Shown even when the scanner has no result yet.
    const renderReserve = () =>
    {
        document.querySelectorAll('.orionReserve, .orionScanWarning').forEach(n => n.remove());

        const holder = document.querySelector('#scannerResultHolder') || document.querySelector(KINDS[0].card)?.parentElement;
        if(!holder) return;

        const records = liveLedger().sort((a, b) => a.endAt - b.endAt);
        const scans = scansPossible(lithiumPerHour());
        const box = document.createElement('div');
        box.className = 'orionReserve';

        if(scans)
        {
            box.innerHTML += scans.count > 0
                ? `<div class="orionReserveScans">Scans you can make now: <b>${scans.count}</b> at <b>${compact(scans.cost)}</b> each, ` +
                  `keeping ${records.length ? 'every anomaly under way redeemable' : 'nothing back - none under way'} (<b>${compact(scans.free)}</b> free)</div>`
                : `<div class="orionReserveScans orionProfitShortText">Scans you can make now: <b>0</b> - ` +
                  (scans.free < 0 ? `the anomalies under way are already short by <b>${compact(-scans.free)}</b>` : `<b>${compact(scans.free)}</b> free, one scan costs <b>${compact(scans.cost)}</b>`) + `</div>`;
        }

        // The case that costs something: anomalies are under way and one more scan would leave one of them
        // unredeemable. Said right under the scan panel, where it is read before the Scan button is
        // pressed. Without anomalies under way a zero only means the bar cannot pay one scan, which the
        // game refuses by itself, so no warning is needed then.
        const panel = document.querySelector('#scannerPanelGroup');
        if(scans && scans.count === 0 && records.length && panel)
        {
            const warning = document.createElement('div');
            warning.className = 'orionScanWarning';
            warning.innerHTML =
                `<b>⚠ Warning:</b> scanning now leaves too little lithium to redeem every anomaly under way. ` +
                (scans.free < 0
                    ? `They are already short by <b>${compact(-scans.free)}</b>, before any scan.`
                    : `Only <b>${compact(scans.free)}</b> is free and one scan costs <b>${compact(scans.cost)}</b>.`);
            panel.insertAdjacentElement('afterend', warning);
        }

        if(!records.length)
        {
            box.innerHTML += 'No anomaly under way is remembered. If you have some, open the missions tab once so their lithium is counted.';
        }
        else
        {
            const total = records.reduce((sum, r) => sum + (r.cost || 0) - (r.lithium || 0), 0);
            box.innerHTML += `Lithium still to pay for <b>${records.length}</b> anomal${records.length > 1 ? 'ies' : 'y'} under way: <b>${compact(total)}</b>` +
                records.map(r => `<div class="orionReserveRow">${r.name} [${r.coords}] · <b>${compact(r.cost)}</b>` +
                    (r.partial ? ' <span class="orionProfitShortText">cost so far - total not known yet</span>' : '') +
                    (r.lithium ? ` · ${compact(r.lithium)} back` : '') + ` · ${endsIn(r)}</div>`).join('');
        }

        // before the list, not inside it: the game owns that container
        holder.insertAdjacentElement('beforebegin', box);
        lastScanCost = scanCost();
    };

    // the scan cost follows the level and range the player picks, without any card changing
    let lastScanCost = null;

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
        // the scanner tab: a new scan cost (level or range changed), or the box missing (no results yet)
        if(document.querySelector('#scannerResultHolder') && (!document.querySelector('.orionReserve') || scanCost() !== lastScanCost)) return true;

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
        .orionReserve .orionReserveScans { margin-bottom:4px; font-size:12px; color:#8fd19e; }
        .orionScanWarning { margin:6px 0; padding:7px 10px; font-size:12px; color:#ffd7d2; background:rgba(160,30,20,.45);
            border:1px solid #e0533f; border-radius:3px; }
        .orionScanWarning b { color:#fff; }
    `;
    document.head.appendChild(style);


    // =====================================================================================================
    // ANOMALY ARCHIVE
    // The history of every anomaly taken on, kept in this browser (separate from the live ledger above,
    // which forgets an anomaly once it is collected). See the header comment.
    // =====================================================================================================
    const archive = (() =>
    {
        // ---------- language ----------
        const LANG = /^it/i.test(document.documentElement.lang || navigator.language || '') ? 'it' : 'en';
        const T = ({
            it: { button:'Archivio anomalie', title:'Archivio anomalie Orion', search:'Cerca nome o coordinate…', all:'tutte',
                  mode:'Modalità', kind:'Tipologia', stars:'Stelle', status:'Stato', running:'in corso', collected:'riscattata', expired:'scaduta',
                  spawned:'Apparsa', name:'Nome', coords:'Coord.', level:'Liv.', waves:'Ondate', paid:'Litio pagato', back:'Litio reso',
                  metal:'Metallo', crystal:'Cristallo', deut:'Deuterio', msu:'MSU', other:'Altro', collections:'Riscatti',
                  totals:'Totale ({n} anomalie)', csv:'Esporta CSV', json:'Esporta JSON', clear:'Svuota archivio', close:'Chiudi',
                  confirmClear:"Cancellare tutto l'archivio delle anomalie? Non si può annullare.", confirmDel:'Togliere questa anomalia dall\'archivio?',
                  empty:'Ancora nessuna anomalia registrata. Apri la scheda Missioni di Orion: le anomalie elencate vengono salvate qui.',
                  note:"Salvato solo in questo browser. Le ricompense sono registrate quando premi il pulsante del gioco per riscattarle." },
            en: { button:'Anomaly archive', title:'Orion anomaly archive', search:'Search name or coordinates…', all:'all',
                  mode:'Mode', kind:'Type', stars:'Stars', status:'Status', running:'running', collected:'collected', expired:'expired',
                  spawned:'Appeared', name:'Name', coords:'Coords', level:'Lvl', waves:'Waves', paid:'Lithium paid', back:'Lithium back',
                  metal:'Metal', crystal:'Crystal', deut:'Deuterium', msu:'MSU', other:'Other', collections:'Collections',
                  totals:'Total ({n} anomalies)', csv:'Export CSV', json:'Export JSON', clear:'Clear archive', close:'Close',
                  confirmClear:'Delete the whole anomaly archive? This cannot be undone.', confirmDel:'Remove this anomaly from the archive?',
                  empty:'No anomaly recorded yet. Open the Orion missions tab: the anomalies listed there are saved here.',
                  note:'Stored in this browser only. Rewards are recorded when you press the game\'s own collect button.' },
        })[LANG];

        // ---------- helpers ----------
        const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
        const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);

        // "02.10.2026 09:05:49" -> timestamp (0 when unreadable)
        const parseGameDate = text =>
        {
            const m = String(text || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
            return m ? new Date(+m[3], m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime() : 0;
        };

        const dateText = ts => ts ? new Date(ts).toLocaleString(LANG === 'it' ? 'it-IT' : 'en-GB', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';

        // ---------- storage (this browser only) ----------
        const DB_KEY = 'orionArchive.v1';
        const PENDING_KEY = 'orionArchive.pending';
        const PENDING_TTL = 20000;

        const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch(e) { return fallback; } };
        const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) { /* storage blocked */ } };
        const loadDb = () => load(DB_KEY, { entries:{} });

        // ---------- reading a mission card ----------
        const missionId = card => card.getAttribute('data-space-object-id') || '';

        // rewards on the card right now: resources by their icon, lithium by its icon or name, the rest as text
        const readRewards = card =>
        {
            const res = { metal:0, crystal:0, deuterium:0, lithium:0, other:[] };
            card.querySelectorAll('.rewardsCell .rewardLine:not(.rewardLineEmpty)').forEach(line =>
            {
                const icon = line.querySelector('resource-icon');
                const type = icon ? ['metal', 'crystal', 'deuterium'].find(k => icon.classList.contains(k)) : null;
                const amount = clean(line.querySelector('.rewardAmount')?.textContent);
                const name = clean(line.querySelector('.rewardName')?.textContent);

                if(type) res[type] += parseNumber(amount);
                else if(line.querySelector('lithium-icon') || /^lit(h)?i/i.test(name)) res.lithium += parseNumber(amount);
                else { const t = clean(name + ' ' + amount) || clean(line.textContent); if(t) res.other.push(t); }
            });
            return res;
        };

        const rewardsPrint = card => Array.from(card.querySelectorAll('.rewardsCell .rewardLine')).map(l => clean(l.textContent)).join('|');

        const readMission = card =>
        {
            const tags = Array.from(card.querySelectorAll('.missionDetailsSubtitle .titleTypeIcon')).map(t => clean(t.textContent));
            const [wave, total] = (clean(card.querySelector('.nodeWave')?.textContent).match(/(\d+)\s*\/\s*(\d+)/) || []).slice(1).map(Number);
            const coords = (clean(card.querySelector('.missionRouteLabels .nodeCoords')?.textContent) ||
                            clean(card.querySelector('.missionDetailsTable .cell:nth-child(3) span:last-child')?.textContent)).match(/\d+:\d+:\d+/)?.[0] || '';
            const mode = tags[0] || (card.classList.contains('pvp') ? 'PvP' : card.classList.contains('pve') ? 'PvE' : '');

            return {
                name:   clean(card.querySelector('.missionNameText')?.textContent) || clean(card.querySelector('.missionNameCompact')?.textContent),
                coords,
                level:  parseNumber(card.querySelector('.missionLevel')?.textContent),
                stars:  card.querySelectorAll('.missionDifficultyStars img').length,
                mode,
                kind:   tags.slice(1).join(' / '),
                spawnedAt: parseGameDate(card.querySelector('.spawnedCell')?.textContent),
                wave:   wave || 0,
                waves:  total || 0,
            };
        };

        // ---------- the collect click: read only ----------
        // The click goes on to the game untouched; we only note what is on screen. It becomes a collection
        // once the game has paid out (rewards changed or card gone), see settlePending().
        document.addEventListener('click', event =>
        {
            const button = event.target.closest?.('.collectRewards');
            const card = button?.closest('.anomalyMission');
            if(!card || button.disabled) return;

            const id = missionId(card);
            if(!id) return;

            const pending = load(PENDING_KEY, {});
            pending[id] =
            {
                at: Date.now(),
                print: rewardsPrint(card),
                cost: parseNumber((card.querySelector('.collectRewards .btnSub')?.textContent || '').split(':').pop()),
                rewards: readRewards(card),
                wave: readMission(card).wave,
            };
            save(PENDING_KEY, pending);
        }, true);

        const settlePending = (db, cards) =>
        {
            const pending = load(PENDING_KEY, {});
            let changed = false;

            Object.entries(pending).forEach(([id, p]) =>
            {
                const card = cards.get(id);
                if(card && rewardsPrint(card) === p.print)
                {
                    if(Date.now() - p.at > PENDING_TTL) { delete pending[id]; changed = true; }   // refused by the game
                    return;
                }

                const entry = db.entries[id];
                if(entry)
                {
                    const r = p.rewards;
                    entry.collections = entry.collections || [];
                    entry.collections.push({ at:p.at, wave:p.wave, cost:p.cost, lithium:r.lithium, metal:r.metal, crystal:r.crystal, deuterium:r.deuterium,
                                             msu:toMSU(r.metal, r.crystal, r.deuterium), other:r.other });
                }
                delete pending[id];
                changed = true;
            });

            if(changed) save(PENDING_KEY, pending);
        };

        // ---------- syncing the missions tab ----------
        let lastPrint = '';

        const sync = () =>
        {
            const wrapper = document.querySelector('.orionTabContentWrapper.anomalyMissions');
            if(!wrapper) return;

            const cardList = Array.from(wrapper.querySelectorAll('.anomalyMission'));
            const print = cardList.map(c => missionId(c) + ':' + rewardsPrint(c) + ':' + clean(c.querySelector('.nodeWave')?.textContent)).join('#');
            const hasPending = Object.keys(load(PENDING_KEY, {})).length > 0;
            if(print === lastPrint && !hasPending) return;
            lastPrint = print;

            const db = loadDb();
            const cards = new Map(cardList.map(c => [missionId(c), c]).filter(([id]) => id));
            const now = Date.now();

            cards.forEach((card, id) =>
            {
                const seen = readMission(card);
                const old = db.entries[id] || { id, firstSeen:now, collections:[] };
                db.entries[id] =
                {
                    ...old,
                    ...Object.fromEntries(Object.entries(seen).filter(([, v]) => v !== '' && v !== 0)),   // never blank what was known
                    wave: Math.max(old.wave || 0, seen.wave || 0),
                    lastSeen: now,
                    status: 'running',
                    endedAt: 0,
                };
            });

            settlePending(db, cards);

            // no longer listed: collected or expired
            Object.values(db.entries).forEach(e =>
            {
                if(e.status === 'running' && !cards.has(e.id))
                {
                    e.status = (e.collections || []).length ? 'collected' : 'expired';
                    e.endedAt = now;
                }
            });

            save(DB_KEY, db);
            updateButtons();
        };

        // ---------- totals per anomaly ----------
        const sum = (e, key) => (e.collections || []).reduce((s, c) => s + (c[key] || 0), 0);
        const row = e => ({
            ...e,
            paid: sum(e, 'cost'), back: sum(e, 'lithium'), metal: sum(e, 'metal'), crystal: sum(e, 'crystal'), deuterium: sum(e, 'deuterium'),
            msu: sum(e, 'msu'), other: (e.collections || []).flatMap(c => c.other || []).join(', '), ncoll: (e.collections || []).length,
            date: e.spawnedAt || e.firstSeen || 0,
        });

        // ---------- the viewer ----------
        const COLUMNS =
        [
            ['date', T.spawned, r => dateText(r.date)],
            ['name', T.name, r => esc(r.name)],
            ['coords', T.coords, r => esc(r.coords)],
            ['level', T.level, r => r.level || ''],
            ['stars', T.stars, r => r.stars ? '★'.repeat(r.stars) : ''],
            ['mode', T.mode, r => `<span class="oaTag oa${esc(String(r.mode).toLowerCase())}">${esc(r.mode)}</span>`],
            ['kind', T.kind, r => esc(r.kind)],
            ['wave', T.waves, r => r.waves ? `${r.wave || 0}/${r.waves}` : ''],
            ['status', T.status, r => `<span class="oaStatus oa_${r.status}">${T[r.status] || r.status}</span>`],
            ['ncoll', T.collections, r => r.ncoll || ''],
            ['paid', T.paid, r => r.paid ? compact(r.paid) : ''],
            ['back', T.back, r => r.back ? compact(r.back) : ''],
            ['metal', T.metal, r => r.metal ? compact(r.metal) : ''],
            ['crystal', T.crystal, r => r.crystal ? compact(r.crystal) : ''],
            ['deuterium', T.deut, r => r.deuterium ? compact(r.deuterium) : ''],
            ['msu', T.msu, r => r.msu ? compact(r.msu) : ''],
            ['other', T.other, r => esc(r.other)],
        ];
        const NUMERIC = new Set(['date', 'level', 'stars', 'wave', 'ncoll', 'paid', 'back', 'metal', 'crystal', 'deuterium', 'msu']);

        const view = { q:'', mode:'', kind:'', stars:'', status:'', sort:'date', desc:true };

        const filtered = () =>
        {
            const q = view.q.toLowerCase();
            return Object.values(loadDb().entries).map(row).filter(r =>
                (!q || (r.name + ' ' + r.coords).toLowerCase().includes(q)) &&
                (!view.mode || r.mode === view.mode) &&
                (!view.kind || r.kind === view.kind) &&
                (!view.stars || String(r.stars) === view.stars) &&
                (!view.status || r.status === view.status))
            .sort((a, b) =>
            {
                const x = a[view.sort], y = b[view.sort];
                const d = NUMERIC.has(view.sort) ? (x || 0) - (y || 0) : String(x || '').localeCompare(String(y || ''));
                return view.desc ? -d : d;
            });
        };

        const options = (values, current) => `<option value="">${T.all}</option>` +
            [...new Set(values.filter(v => v !== '' && v !== undefined))].sort().map(v => `<option${String(v) === current ? ' selected' : ''}>${esc(v)}</option>`).join('');

        const renderModal = () =>
        {
            const modal = document.querySelector('#orionArchiveModal');
            if(!modal) return;

            const all = Object.values(loadDb().entries);
            const rows = filtered();
            const total = key => rows.reduce((s, r) => s + (r[key] || 0), 0);

            modal.querySelector('.oaBody').innerHTML = !all.length ? `<p class="oaEmpty">${T.empty}</p>` : `
                <div class="oaFilters">
                    <input type="search" class="oaQ" placeholder="${T.search}" value="${esc(view.q)}">
                    <label>${T.mode} <select data-f="mode">${options(all.map(e => e.mode), view.mode)}</select></label>
                    <label>${T.kind} <select data-f="kind">${options(all.map(e => e.kind), view.kind)}</select></label>
                    <label>${T.stars} <select data-f="stars">${options(all.map(e => e.stars ? String(e.stars) : ''), view.stars)}</select></label>
                    <label>${T.status} <select data-f="status"><option value="">${T.all}</option>${['running', 'collected', 'expired']
                        .map(s => `<option value="${s}"${s === view.status ? ' selected' : ''}>${T[s]}</option>`).join('')}</select></label>
                </div>
                <div class="oaScroll"><table>
                    <thead><tr>${COLUMNS.map(([k, label]) => `<th data-k="${k}">${label}${view.sort === k ? (view.desc ? ' ▾' : ' ▴') : ''}</th>`).join('')}<th></th></tr></thead>
                    <tbody>${rows.map(r => `<tr>${COLUMNS.map(([k, , f]) => `<td class="${NUMERIC.has(k) ? 'oaNum' : ''}">${f(r)}</td>`).join('')}
                        <td><a class="oaDel" data-id="${esc(r.id)}" title="×">×</a></td></tr>`).join('')}</tbody>
                    <tfoot><tr><td colspan="9">${T.totals.replace('{n}', rows.length)}</td><td class="oaNum">${total('ncoll')}</td>
                        ${['paid', 'back', 'metal', 'crystal', 'deuterium', 'msu'].map(k => `<td class="oaNum">${compact(total(k))}</td>`).join('')}<td colspan="2"></td></tr></tfoot>
                </table></div>`;
        };

        const download = (name, text, type) =>
        {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([text], { type }));
            a.download = name;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
        };

        const exportCsv = () =>
        {
            const keys = ['id', 'date', 'name', 'coords', 'level', 'stars', 'mode', 'kind', 'wave', 'waves', 'status', 'ncoll', 'paid', 'back', 'metal', 'crystal', 'deuterium', 'msu', 'other'];
            const cell = v => /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
            const lines = [keys.join(';')].concat(filtered().map(r => keys.map(k => cell(k === 'date' ? new Date(r.date || 0).toISOString() : r[k])).join(';')));
            download('orion-anomalies.csv', '﻿' + lines.join('\n'), 'text/csv');
        };

        const openModal = () =>
        {
            if(document.querySelector('#orionArchiveModal')) return;

            const modal = document.createElement('div');
            modal.id = 'orionArchiveModal';
            modal.innerHTML = `<div class="oaWindow">
                <div class="oaHead"><b>${T.title}</b>
                    <span class="oaActions"><button data-a="csv">${T.csv}</button><button data-a="json">${T.json}</button>
                    <button data-a="clear">${T.clear}</button><button data-a="close">${T.close}</button></span></div>
                <div class="oaBody"></div>
                <div class="oaNote">${T.note}</div></div>`;
            document.body.appendChild(modal);

            modal.addEventListener('click', event =>
            {
                if(event.target === modal) return modal.remove();
                const action = event.target.closest('[data-a]')?.getAttribute('data-a');
                if(action === 'close') modal.remove();
                if(action === 'csv') exportCsv();
                if(action === 'json') download('orion-anomalies.json', JSON.stringify(loadDb(), null, 1), 'application/json');
                if(action === 'clear' && confirm(T.confirmClear)) { save(DB_KEY, { entries:{} }); renderModal(); updateButtons(); }

                const th = event.target.closest('th[data-k]');
                if(th) { const k = th.getAttribute('data-k'); view.desc = view.sort === k ? !view.desc : NUMERIC.has(k); view.sort = k; renderModal(); }

                const del = event.target.closest('.oaDel');
                if(del && confirm(T.confirmDel)) { const db = loadDb(); delete db.entries[del.getAttribute('data-id')]; save(DB_KEY, db); renderModal(); updateButtons(); }
            });

            modal.addEventListener('change', event =>
            {
                const f = event.target.getAttribute('data-f');
                if(f) { view[f] = event.target.value; renderModal(); }
            });

            modal.addEventListener('input', event =>
            {
                if(!event.target.classList.contains('oaQ')) return;
                view.q = event.target.value;
                const pos = event.target.selectionStart;
                renderModal();
                const q = modal.querySelector('.oaQ');
                if(q) { q.focus(); q.setSelectionRange(pos, pos); }
            });

            renderModal();
        };

        // ---------- the button above every Orion tab ----------
        const updateButtons = () =>
        {
            const n = Object.keys(loadDb().entries).length;
            document.querySelectorAll('.orionArchiveButton span').forEach(s => { s.textContent = `${T.button} (${n})`; });
        };

        const placeButtons = () =>
        {
            let added = false;
            document.querySelectorAll('.orionTabContentWrapper').forEach(wrapper =>
            {
                if(wrapper.previousElementSibling?.classList.contains('orionArchiveBar')) return;
                added = true;
                const bar = document.createElement('div');
                bar.className = 'orionArchiveBar';
                bar.innerHTML = `<a href="javascript:void(0);" class="orionArchiveButton">📜 <span></span></a>`;
                bar.querySelector('a').addEventListener('click', openModal);
                wrapper.insertAdjacentElement('beforebegin', bar);
            });
            if(added) updateButtons();
        };

        const archiveStyle = document.createElement('style');
        archiveStyle.textContent = `
            .orionArchiveBar { margin:4px 0 6px; text-align:right; }
            .orionArchiveButton { display:inline-block; padding:3px 9px; font-size:11px; color:#d7e3ef !important; background:rgba(0,0,0,.4);
                border:1px solid rgba(143,209,158,.45); border-radius:3px; text-decoration:none !important; }
            .orionArchiveButton:hover { border-color:#8fd19e; color:#fff !important; }
            #orionArchiveModal { position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; }
            #orionArchiveModal .oaWindow { width:min(1250px, 96vw); max-height:88vh; display:flex; flex-direction:column; background:#0d1014;
                border:1px solid #2c3a47; border-radius:4px; color:#a9b7c6; font:11px Verdana, Arial, sans-serif; box-shadow:0 8px 30px rgba(0,0,0,.7); }
            #orionArchiveModal .oaHead { display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border-bottom:1px solid #2c3a47; color:#fff; font-size:13px; }
            #orionArchiveModal button { margin-left:5px; padding:3px 8px; font-size:11px; color:#d7e3ef; background:#1b2530; border:1px solid #3a4b5c; border-radius:3px; cursor:pointer; }
            #orionArchiveModal button:hover { background:#25384a; }
            #orionArchiveModal .oaBody { display:flex; flex-direction:column; min-height:0; padding:8px 10px; }
            #orionArchiveModal .oaFilters { display:flex; flex-wrap:wrap; gap:6px 12px; align-items:center; margin-bottom:8px; }
            #orionArchiveModal input, #orionArchiveModal select { font-size:11px; color:#d7e3ef; background:#151c24; border:1px solid #3a4b5c; border-radius:3px; padding:2px 4px; }
            #orionArchiveModal .oaQ { width:220px; }
            #orionArchiveModal .oaScroll { overflow:auto; max-height:64vh; }
            #orionArchiveModal table { width:100%; border-collapse:collapse; }
            #orionArchiveModal th { position:sticky; top:0; background:#16202a; color:#fff; padding:4px 5px; text-align:left; cursor:pointer; white-space:nowrap; }
            #orionArchiveModal td { padding:3px 5px; border-bottom:1px solid #1d2731; white-space:nowrap; }
            #orionArchiveModal tbody tr:hover { background:#141d26; }
            #orionArchiveModal tfoot td { color:#fff; font-weight:bold; border-top:1px solid #3a4b5c; background:#121a22; position:sticky; bottom:0; }
            #orionArchiveModal .oaNum { text-align:right; }
            #orionArchiveModal .oaTag { padding:0 4px; border-radius:2px; background:#2a3542; color:#fff; }
            #orionArchiveModal .oapvp { background:#7a2a22; }
            #orionArchiveModal .oapve { background:#24563a; }
            #orionArchiveModal .oa_running { color:#e0b25a; }
            #orionArchiveModal .oa_collected { color:#8fd19e; }
            #orionArchiveModal .oa_expired { color:#7c8a99; }
            #orionArchiveModal .oaDel { color:#c06050; cursor:pointer; font-weight:bold; text-decoration:none; }
            #orionArchiveModal .oaEmpty, #orionArchiveModal .oaNote { padding:8px 10px; color:#7c8a99; }
        `;
        document.head.appendChild(archiveStyle);

        // called by the calculator's observer, with the observer disconnected
        const tick = () =>
        {
            if(!document.querySelector('.orionTabContentWrapper')) return;
            placeButtons();
            sync();
        };

        return { tick };
    })();

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
            const stale = outOfDate();

            observer.disconnect();
            try { archive.tick(); if(stale) render(); }   // the archive returns at once when nothing changed
            finally { watch(); }
        });
    });

    if(document.querySelector('#orionMission, #scannerResultHolder') || KINDS.some(kind => document.querySelector(kind.card))) render();
    archive.tick();
    watch();
});
