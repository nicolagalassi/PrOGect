// ==UserScript==
// @name         OGame Orion Calculator
// @namespace    https://github.com/nicolagalassi
// @version      1.1.0
// @description  Project Orion test server: what each scanned anomaly and each active mission pays per hour of lithium production, best first; a launch plan per anomaly that keeps the lithium for the anomalies already under way; and how many scans the lithium can pay for without starving them. Display only.
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

  COMPLIANCE (OGame Origin tool rules — see AGENTS.md):
  - §1.1/§1.2  Display only: it neither scans, nor discovers, nor redeems anything. The Discover click is
               only read, never stopped or changed.
  - §1.3/§4    NO request to the game server. It reads the Orion tabs the player opened; the DOM-only
               observer handles the game redrawing them.
  - §4.2       No cp=, no planet switching.
  - §1.9       Nothing leaves the machine; the anomalies taken on stay in this browser's localStorage.
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

    if(document.querySelector('#orionMission, #scannerResultHolder') || KINDS.some(kind => document.querySelector(kind.card))) render();
    watch();
});
