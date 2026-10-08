// ==UserScript==
// @name         OGame Orion Calculator
// @namespace    https://github.com/nicolagalassi
// @version      1.3.6
// @description  Project Orion test server: what each scanned anomaly and each active mission pays per hour of lithium production, best first; a launch plan per anomaly that keeps the lithium for the anomalies already under way; how many scans the lithium can pay for without starving them; and an archive with daily results of every anomaly taken on (level, stars, PvP/PvE, type, lithium, rewards collected, ships received, fuel spent, ships lost). Display only.
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

  ANOMALY ARCHIVE AND DAILY RESULTS
  The ledger above forgets an anomaly once it is collected; the archive keeps it, in this browser only
  (localStorage "orionArchive.v1"), keyed by the game's own id for it (data-space-object-id).
  - Every time the missions tab is drawn, each anomaly listed is written down or updated: name,
    coordinates, level, difficulty stars, PvP/PvE, type (e.g. "Battle"), when it appeared, waves reached.
  - Collections are READ by a capture listener. The card's collect button only opens the game's
    "collect rewards" dialog (waves, total lithium cost, Accept / Cancel): what is noted is Accept in
    that dialog, with the dialog's own figures. Cancel notes nothing. With "don't show again today"
    ticked there is no dialog, and the card button itself is noted with the card's figures. Either way
    it is saved only once the game has really paid out: the card's collect cost (or, without one, its
    rewards) went DOWN, or the card stayed gone. A new wave only adds to both, so it never counts as a
    payout, and a card missing for an instant while the game redraws the list does not either. A
    disabled button is not noted. Anything else is forgotten after 60 s.
    Only what was really collected counts (1.3.4): the dialog's paid waves (its summary only when the
    waves carry no rewards of their own), each resource capped at what actually left the card between
    the click and the payout, so rewards of waves the lithium did not pay for are never counted.
  - Fuel: when the player sends a fleet, the game's own send request and its answer are READ through
    jQuery's global ajaxSend / ajaxComplete events. If the answer says the fleet left and the target is an
    anomaly (deep space type 4, the anomaly mission 14, or coordinates the archive knows), the fuel the
    dispatch page itself computes (fleetDispatcher.getConsumption()) is noted with the time.
  - Ships lost: the combat reports the player opens in the messages carry their data in the page
    (.rawMessageData, as OGLight reads them). A report fought at an anomaly (not on a planet or moon)
    counts when it names an archived anomaly by its id, or else falls at its coordinates during its life:
    the player's own ships destroyed in the last round, valued at their build cost in MSU (the ships this
    script knows; others are counted, not valued).
  - Ships received as a reward: a collected reward line that names a ship this script knows (Italian
    or English name, e.g. "Caccia leggero 120") is valued at the ship's build cost in MSU, like ships lost,
    and shown in its own "Ships reward" column; it counts in the balance. Any other non-resource reward
    stays under "Other", not valued. Read from the reward text already saved, so older collections count too.
    Up to 1.3.1 an anomaly's coordinates were taken from the start of the mission's route, i.e. the
    player's own planet or moon: no battle at an anomaly matched, fights at home did, and flights home
    were taken for anomaly fuel. 1.3.2 reads the anomaly's coordinates, fixes old entries from the reports
    that name them, drops the battles noted before and leaves out fuel sent to the player's own planets
    and moons outside the anomaly mission.
  - Each anomaly no longer listed is closed: "collected" with at least one collection, "expired" otherwise.
  The panel - "Orion stats" in the game's left menu on every page, and a button above the Orion missions
  overview (1.3.6: only there, no longer above every Orion tab) -
  shows the results per DAY, like OGLight's expedition days: pick a day (◀ ▶, Today), the last 7 or 30
  days, or everything; tiles with anomalies, collections and waves, rewards in MSU and per resource, net
  lithium spent, ships received, fuel, ships lost and the balance (rewards + ships received − ships lost
  − fuel, in MSU; lithium apart);
  a bar per day (rewards above the line, costs below; a click opens that day without moving the chart,
  ‹ › scroll it a week); the ships received and lost by type; "Other" rewards with the same name added up;
  and the anomalies that APPEARED in the period (1.3.4; before, every anomaly still alive in it was listed),
  with the period's own figures (search, filters, sorting).
  Export: a CSV with one line per day, or the whole archive as JSON (files saved on your own computer,
  only when clicked).
  Under the left menu, like OGLight's daily expedition box, a small box shows TODAY's rewards collected
  (metal, crystal, deuterium) and the day's balance in MSU; a click opens the panel on today. It is
  redrawn from the archive in this browser only when the archive or the day changes.
  It cannot know what happened while the script was not installed, or on another browser; ships lost
  are only counted once their combat report has been opened.

  COMPLIANCE (OGame Origin tool rules — see AGENTS.md):
  - §1.1/§1.2  Display only: it neither scans, nor discovers, nor redeems anything. The Discover and
               collect clicks are only read, never stopped, delayed, changed or repeated.
  - §1.3/§4    NO request to the game server; the game's own send-fleet request is only observed
               (jQuery ajaxSend/ajaxComplete), never made, changed or repeated. It reads the Orion tabs the player opened; the DOM-only
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
            it: { button:'Archivio anomalie', menu:'Orion stats', title:'Anomalie Orion: risultati giornalieri', search:'Cerca nome o coordinate…', all:'tutte',
                  mode:'Modalità', kind:'Tipologia', stars:'Stelle', status:'Stato', running:'in corso', collected:'riscattata', expired:'scaduta',
                  spawned:'Apparsa', name:'Nome', coords:'Coord.', level:'Liv.', waves:'Ondate', paid:'Litio pagato', back:'Litio reso',
                  gain:'Ricompense', fuel:'Carburante', lost:'Navi perse', lostShort:'Navi perse', costs:'Costi: navi perse + carburante', gainAll:'Ricompense + navi ricevute',
                  net:'Bilancio', netHint:'ricompense + navi ricevute − navi perse − carburante (litio a parte)', other:'Altro', shipsGot:'Navi ricevute', shipsGotShort:'Ships reward', lithium:'Litio netto speso',
                  paidShort:'pagato', backShort:'reso', anomalies:'Anomalie', collectionsShort:'riscatti', wavesShort:'ondate',
                  ships:'navi', battlesShort:'battaglie', day:'Giorno', daysShort:'giorni', allTime:'Tutto', today:'Oggi',
                  prevDay:'Giorno prima', nextDay:'Giorno dopo', lastDays:'Ultimi {n} giorni fino a {d}',
                  chartHint:'clic su una barra per aprire quel giorno', chartPrev:'Settimana prima', boxHint:'Oggi: ricompense riscattate e bilancio in MSU. Clic per aprire le statistiche Orion.', chartNext:'Settimana dopo', chartAria:'Ricompense e costi in MSU per giorno',
                  rowsHint:'anomalie apparse nel periodo; cifre della riga = solo il periodo scelto', noneInPeriod:'Nessuna anomalia apparsa in questo periodo.',
                  csv:'CSV per giorno', json:'Esporta JSON', clear:'Svuota archivio', close:'Chiudi',
                  confirmClear:"Cancellare tutto l'archivio delle anomalie (anche carburante e battaglie)? Non si può annullare.", confirmDel:'Togliere questa anomalia dall\'archivio?',
                  empty:'Ancora nessuna anomalia registrata. Apri la scheda Missioni di Orion: le anomalie elencate vengono salvate qui.',
                  note:'Salvato solo in questo browser. Ricompense: quando accetti il riscatto. Carburante: quando invii una flotta verso un\'anomalia. Navi perse: quando apri i rapporti di combattimento nella posta.' },
            en: { button:'Anomaly archive', menu:'Orion stats', title:'Orion anomalies: daily results', search:'Search name or coordinates…', all:'all',
                  mode:'Mode', kind:'Type', stars:'Stars', status:'Status', running:'running', collected:'collected', expired:'expired',
                  spawned:'Appeared', name:'Name', coords:'Coords', level:'Lvl', waves:'Waves', paid:'Lithium paid', back:'Lithium back',
                  gain:'Rewards', fuel:'Fuel', lost:'Ships lost', lostShort:'Ships lost', costs:'Costs: ships lost + fuel', gainAll:'Rewards + ships received',
                  net:'Balance', netHint:'rewards + ships received − ships lost − fuel (lithium apart)', other:'Other', shipsGot:'Ships received', shipsGotShort:'Ships reward', lithium:'Net lithium spent',
                  paidShort:'paid', backShort:'back', anomalies:'Anomalies', collectionsShort:'collections', wavesShort:'waves',
                  ships:'ships', battlesShort:'battles', day:'Day', daysShort:'days', allTime:'All', today:'Today',
                  prevDay:'Previous day', nextDay:'Next day', lastDays:'Last {n} days up to {d}',
                  chartHint:'click a bar to open that day', chartPrev:'Previous week', boxHint:'Today: rewards collected and balance in MSU. Click to open the Orion stats.', chartNext:'Next week', chartAria:'Rewards and costs in MSU per day',
                  rowsHint:'anomalies appeared in the period; row figures = chosen period only', noneInPeriod:'No anomaly appeared in this period.',
                  csv:'CSV per day', json:'Export JSON', clear:'Clear archive', close:'Close',
                  confirmClear:'Delete the whole anomaly archive (fuel and battles too)? This cannot be undone.', confirmDel:'Remove this anomaly from the archive?',
                  empty:'No anomaly recorded yet. Open the Orion missions tab: the anomalies listed there are saved here.',
                  note:'Stored in this browser only. Rewards: when you accept a collection. Fuel: when you send a fleet to an anomaly. Ships lost: when you open your combat reports.' },
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
        const PENDING_TTL = 60000;
        const GONE_SETTLE = 3000;   // a card missing this long is really gone, not being redrawn

        const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch(e) { return fallback; } };
        const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) { /* storage blocked */ } };
        // { entries:{ id:anomaly }, fuel:[ {at, coords, deut} ], battles:{ messageId:{at, coords, entry, lost} } }
        const loadDb = () =>
        {
            const db = load(DB_KEY, {});
            db.entries = db.entries || {}; db.fuel = db.fuel || []; db.battles = db.battles || {};
            // battles noted before 1.3.2 matched the anomaly by the planet its fleet left from, so they are
            // fights on the player's own planet or moon: dropped, and read again from the combat reports
            Object.keys(db.battles).forEach(id => { if(!db.battles[id].v) delete db.battles[id]; });
            return db;
        };

        // ---------- reading a mission card ----------
        const missionId = card => card.getAttribute('data-space-object-id') || '';

        // rewards inside `box`: resources by their icon, lithium by its icon or name, the rest as text.
        // The mission card lists them in .rewardsCell, the collect dialog in .collectSummaryRewards.
        const readRewards = (box, selector = '.rewardsCell .rewardLine') =>
        {
            const res = { metal:0, crystal:0, deuterium:0, lithium:0, other:[] };
            box.querySelectorAll(selector).forEach(line =>
            {
                if(line.classList.contains('rewardLineEmpty')) return;

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

        // What is waiting to be collected on the card: the collect button's lithium cost, and the rewards
        // in MSU plus lithium. A wave arriving only ever adds to both; a payout takes away what it paid.
        const cardCost = card => parseNumber((card.querySelector('.collectRewards .btnSub')?.textContent || '').split(':').pop());
        const cardValue = card => { const r = readRewards(card); return toMSU(r.metal, r.crystal, r.deuterium) + r.lithium; };

        // The game greys a refused button out with the attribute, a class or aria-disabled, depending on
        // the element; a click on it does nothing, so nothing is noted.
        const isDisabled = el => !!(el.disabled || el.classList.contains('disabled') || el.getAttribute('aria-disabled') === 'true');

        const readMission = card =>
        {
            const tags = Array.from(card.querySelectorAll('.missionDetailsSubtitle .titleTypeIcon')).map(t => clean(t.textContent));
            const [wave, total] = (clean(card.querySelector('.nodeWave')?.textContent).match(/(\d+)\s*\/\s*(\d+)/) || []).slice(1).map(Number);
            // the route reads origin → anomaly: the second label is the anomaly (as the ledger reads it). Up to
            // 1.3.1 the first one was taken, i.e. the player's own planet or moon the fleet left from.
            const coords = (clean(card.querySelectorAll('.missionRouteLabels .routeLabelCell')[1]?.querySelector('.nodeCoords')?.textContent) ||
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
                ...(coords ? { located:true } : {}),   // coords are the anomaly's own (entries saved before 1.3.2 lack this)
            };
        };

        // ---------- the collect: read only ----------
        // The game's "collect" button on the card does NOT collect: it opens a dialog ("Raccogli le
        // ricompense") with every wave to be collected, the total lithium cost and Accept / Cancel. So:
        // - Accept in that dialog is what gets noted, with the dialog's own figures (summary rewards,
        //   total cost, waves). Cancel or closing the dialog notes nothing.
        // - With "don't show this again today" ticked the card button collects straight away and no
        //   dialog appears; only then is the card button itself noted, from the card's figures.
        // Either way it is still only PENDING: it becomes a collection once the game has paid out (the
        // card's rewards changed or the card is gone) and is forgotten if nothing changes within 60 s.
        // These listeners only read: the click goes on to the game untouched.
        const cardOf = id => document.querySelector(`.anomalyMission[data-space-object-id="${String(id).replace(/"/g, "")}"]`);
        const dialogOpen = () => !!document.querySelector('.orionCollectRewards');
        let dialogSeen = 0;   // last time a collect dialog was on screen or clicked in

        const addPending = (id, record) =>
        {
            const pending = load(PENDING_KEY, {});
            pending[id] = record;
            save(PENDING_KEY, pending);
        };

        document.addEventListener('click', event =>
        {
            if(event.target.closest?.('.ui-dialog')?.querySelector('.orionCollectRewards') || event.target.closest?.('.orionCollectRewards')) dialogSeen = Date.now();

            // Accept in the collect dialog
            const confirm = event.target.closest?.('.orionCollectConfirm');
            const dialog = confirm?.closest('.orionCollectRewards');
            if(dialog && !isDisabled(confirm))
            {
                const id = dialog.getAttribute('data-space-object-id') || '';
                if(!id) return;

                // the game marks the waves the lithium can pay for as .affordable; only those are collected
                const rows = Array.from(dialog.querySelectorAll(dialog.querySelector('.collectWaveRow.affordable') ? '.collectWaveRow.affordable' : '.collectWaveRow'));
                const waves = rows.map(r => parseNumber(r.querySelector('.cwWave')?.textContent)).filter(Boolean);
                // what the paid waves give: the affordable rows' own rewards first, the summary only without
                // them (it may total every wave, also those the lithium does not pay for)
                const rewards = dialog.querySelector('.collectWaveRow.affordable .cwRewards .rewardLine')
                    ? readRewards(dialog, '.collectWaveRow.affordable .cwRewards .rewardLine')
                    : readRewards(dialog, '.collectSummaryRewards .rewardLine');
                const cost = parseNumber(dialog.querySelector('.collectTotalValue')?.textContent) ||
                             rows.reduce((s, r) => s + parseNumber((r.querySelector('.cwCost')?.textContent || '').split(':').pop()), 0);
                const card = cardOf(id);

                addPending(id, { at:Date.now(), via:'dialog', print:card ? rewardsPrint(card) : '', cost, rewards, before:card ? readRewards(card) : null,
                                 cardCost:card ? cardCost(card) : 0, cardValue:card ? cardValue(card) : 0,
                                 wave:waves.length ? Math.max(...waves) : (card ? readMission(card).wave : 0), waves:waves.length });
                return;
            }

            // the card's own button: only counts when no dialog follows
            const button = event.target.closest?.('.collectRewards');
            const card = button?.closest('.anomalyMission');
            if(!card || isDisabled(button)) return;

            const id = missionId(card);
            if(!id) return;

            const record = { at:Date.now(), via:'card', print:rewardsPrint(card), cost:cardCost(card),
                             rewards:readRewards(card), before:readRewards(card), wave:readMission(card).wave, cardCost:cardCost(card), cardValue:cardValue(card) };

            // a local UI timer, no request: give the game time to open its dialog. If one came (even if
            // already closed again), the dialog's Accept decides; if none came, the button collected directly.
            setTimeout(() => { if(!dialogOpen() && dialogSeen < record.at) addPending(id, record); }, 1500);
        }, true);

        // Only what was really collected counts, never what the dialog or the card promised. The card's
        // rewards at the click (`before`) and after the payout (`after`, null when the card is gone) bound
        // it: each resource is at most what left the card. Non-resource lines ("name 120") likewise, when
        // their count is a plain number; anything else is kept as read.
        // "Esperienza delle Forme di vita 15.794" -> ['Esperienza delle Forme di vita', 15794]; null when the
        // line does not end in a plain number
        const splitCount = text => { const m = clean(text).match(/^(.*?)\s*(\d[\d.,' ]*)$/); return m && m[1] ? [m[1], parseNumber(m[2])] : null; };

        const collectedOnly = (r, before, after) =>
        {
            if(!before) return r;
            const out = { ...r, other:[] };
            ['metal', 'crystal', 'deuterium', 'lithium'].forEach(k =>
            {
                const left = Math.max(0, (before[k] || 0) - (after ? after[k] || 0 : 0));
                out[k] = Math.min(r[k] || 0, left);
            });
            const split = splitCount;
            const counts = list => (list || []).reduce((acc, text) => { const x = split(text); if(x) acc[x[0]] = (acc[x[0]] || 0) + x[1]; return acc; }, {});
            const had = counts(before.other), still = after ? counts(after.other) : {};
            (r.other || []).forEach(text =>
            {
                const x = split(text);
                if(!x || !(x[0] in had)) { out.other.push(text); return; }
                const n = Math.min(x[1], Math.max(0, had[x[0]] - (still[x[0]] || 0)));
                if(n) out.other.push(n === x[1] ? text : `${x[0]} ${n}`);
            });
            return out;
        };

        const settlePending = (db, cards) =>
        {
            const pending = load(PENDING_KEY, {});
            let changed = false;

            Object.entries(pending).forEach(([id, p]) =>
            {
                // a dialog came late after all: the card-button note is not a collection, Accept will be
                if(p.via === 'card' && document.querySelector(`.orionCollectRewards[data-space-object-id="${String(id).replace(/"/g, "")}"]`))
                {
                    delete pending[id]; changed = true; return;
                }

                // Has the game paid out? Not "the card changed": a wave arriving in the meantime changes it
                // too, and turned a refused or unconfirmed collect into lithium paid. Only what was waiting
                // on the card going DOWN says so. (Notes from 1.3.0 and older carry no figures: the old test.)
                const card = cards.get(id);
                if(card)
                {
                    if(p.goneSince) { delete p.goneSince; changed = true; }   // it was only being redrawn
                    const paid = !('cardCost' in p) ? rewardsPrint(card) !== p.print
                               : p.cardCost ? cardCost(card) < p.cardCost
                               : cardValue(card) < p.cardValue;
                    if(!paid)
                    {
                        if(Date.now() - p.at > PENDING_TTL) { delete pending[id]; changed = true; }   // refused or never confirmed
                        return;
                    }
                }
                else
                {
                    // Gone from the list: collected for good, unless the game is just redrawing the tab (it
                    // empties the list and refills it). It counts once it has stayed gone for a while.
                    if(!p.goneSince) { p.goneSince = Date.now(); changed = true; return; }
                    if(Date.now() - p.goneSince < GONE_SETTLE) return;
                }

                const entry = db.entries[id];
                if(entry)
                {
                    const r = collectedOnly(p.rewards, p.before, card ? readRewards(card) : null);
                    entry.collections = entry.collections || [];
                    entry.collections.push({ at:p.at, wave:p.wave, waves:p.waves || 0, cost:p.cost, lithium:r.lithium, metal:r.metal, crystal:r.crystal, deuterium:r.deuterium,
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
                // its collection is settled a moment after the card goes (see GONE_SETTLE)
                else if(e.status === 'expired' && (e.collections || []).length) e.status = 'collected';
            });

            save(DB_KEY, db);
            updateButtons();
        };

        // ---------- which anomaly an event at `coords` / `at` belongs to ----------
        // The same coordinates can host several anomalies over time, so the one whose life (from its
        // appearance to its end, with a margin either side) covers the moment wins; the nearest start if
        // more than one does.
        const MARGIN = 12 * 3600 * 1000;
        const matchEntry = (entries, coords, at) =>
        {
            const fits = entries.filter(e => e.coords === coords &&
                at >= (e.spawnedAt || e.firstSeen || 0) - MARGIN && at <= (e.endedAt || Date.now()) + MARGIN);
            return fits.sort((a, b) => Math.abs(at - (a.spawnedAt || a.firstSeen)) - Math.abs(at - (b.spawnedAt || b.firstSeen)))[0] || null;
        };

        // ---------- fuel: deuterium spent sending fleets to an anomaly ----------
        // The game sends a fleet with its own request (fleetdispatch, action=sendFleet). jQuery's global
        // ajaxSend / ajaxComplete events let us READ that request and the game's answer: no request of ours,
        // nothing changed, nothing delayed. The fuel is the figure the game itself shows on the dispatch page
        // (fleetDispatcher.getConsumption()), noted only when the answer says the fleet left and the target is
        // an anomaly: deep space (type 4), the anomaly mission, or coordinates the archive knows.
        // The game's own "Send fleet" link on an anomaly card uses mission=14 and type=4.
        const ANOMALY_MISSION = 14;
        const jq = window.jQuery;
        const fuelSnapshots = new Map();

        if(jq && /component=fleetdispatch/.test(location.search))
        {
            jq(document).on('ajaxSend', (event, xhr, settings) =>
            {
                if(!/action=sendFleet/.test(settings?.url || '')) return;
                try
                {
                    const fd = window.fleetDispatcher;
                    const t = fd?.targetPlanet || {};
                    fuelSnapshots.set(xhr, {
                        coords: [t.galaxy, t.system, t.position].join(':'),
                        type: Number(t.type),
                        mission: Number(fd?.mission),
                        deut: Math.round(parseFloat(fd?.getConsumption?.() || 0)) || 0,
                    });
                }
                catch(e) { /* dispatch page changed: no fuel noted */ }
            });

            jq(document).on('ajaxComplete', (event, xhr) =>
            {
                const snap = fuelSnapshots.get(xhr);
                fuelSnapshots.delete(xhr);
                if(!snap || !snap.deut) return;

                let sent = false;
                try { const json = xhr.responseJSON || JSON.parse(xhr.responseText || '{}'); sent = json.success === true; } catch(e) { /* not JSON */ }
                if(!sent) return;

                const db = loadDb();
                const known = new Set(Object.values(db.entries).filter(e => e.located).map(e => e.coords));
                if(!(snap.type === 4 || snap.mission === ANOMALY_MISSION || known.has(snap.coords))) return;

                db.fuel.push({ at:Date.now(), coords:snap.coords, deut:snap.deut, mission:snap.mission });
                save(DB_KEY, db);
            });
        }

        // ---------- battles at an anomaly: ships lost ----------
        // Combat reports carry their data in the message list itself (.rawMessageData, the same attributes
        // OGLight reads). A report counts when its coordinates and time match an archived anomaly; the ships
        // lost are the own fleets' destroyed totals in the last round. Read when the player opens the combat
        // reports; each report once (by message id).
        const SHIPS =
        {
            202:['Cargo leggero', 'Small Cargo', 2000, 2000, 0],          203:['Cargo pesante', 'Large Cargo', 6000, 6000, 0],
            204:['Caccia leggero', 'Light Fighter', 3000, 1000, 0],       205:['Caccia pesante', 'Heavy Fighter', 6000, 4000, 0],
            206:['Incrociatore', 'Cruiser', 20000, 7000, 2000],           207:['Nave da battaglia', 'Battleship', 45000, 15000, 0],
            208:['Colonizzatrice', 'Colony Ship', 10000, 20000, 10000],   209:['Riciclatrice', 'Recycler', 10000, 6000, 2000],
            210:['Sonda spia', 'Espionage Probe', 0, 1000, 0],            211:['Bombardiere', 'Bomber', 50000, 25000, 15000],
            212:['Satellite solare', 'Solar Satellite', 0, 2000, 500],    213:['Corazzata', 'Destroyer', 60000, 50000, 15000],
            214:['Morte nera', 'Deathstar', 5000000, 4000000, 1000000],   215:['Incrociatore da battaglia', 'Battlecruiser', 30000, 40000, 15000],
            217:['Crawler', 'Crawler', 2000, 2000, 1000],                 218:['Reaper', 'Reaper', 85000, 55000, 20000],
            219:['Pathfinder', 'Pathfinder', 8000, 15000, 8000],
        };
        const shipName = id => SHIPS[id] ? SHIPS[id][LANG === 'it' ? 0 : 1] : '#' + id;
        const lostMsu = lost => Object.entries(lost || {}).reduce((s, [id, n]) => s + (SHIPS[id] ? toMSU(SHIPS[id][2] * n, SHIPS[id][3] * n, SHIPS[id][4] * n) : 0), 0);
        const lostCount = lost => Object.values(lost || {}).reduce((s, n) => s + n, 0);

        // A reward line that is not a resource is saved as its text ("Caccia leggero 120"). When it names a
        // ship this script knows, it is a ship received: { id, n }. Longest names first, so "Incrociatore da
        // battaglia" is not read as "Incrociatore". A ship line without a count, or a ship the table does
        // not know, stays under "Other", not valued (nothing is invented).
        const SHIP_NAMES = Object.entries(SHIPS).flatMap(([id, s]) => [[id, s[0]], [id, s[1]]]).sort((a, b) => b[1].length - a[1].length);
        const shipReward = text =>
        {
            const t = clean(text).toLowerCase();
            const hit = SHIP_NAMES.find(([, name]) => t.startsWith(name.toLowerCase()) && !/[a-zà-ù]/i.test(t.charAt(name.length)));
            if(!hit) return null;
            const n = parseNumber(t.slice(hit[1].length));
            return n ? { id:hit[0], n } : null;
        };

        const readBattles = () =>
        {
            const fresh = document.querySelectorAll('.rawMessageData[data-raw-messagetype="25"]:not([data-orion-read])');
            if(!fresh.length) return;

            const me = document.querySelector('meta[name="ogame-player-id"]')?.getAttribute('content') || '';
            const db = loadDb();
            const known = Object.values(db.entries).filter(e => e.coords);
            let changed = false;

            fresh.forEach(raw =>
            {
                raw.setAttribute('data-orion-read', '1');
                const id = raw.closest('[data-msg-id]')?.getAttribute('data-msg-id') || raw.getAttribute('data-raw-hashcode') || '';
                if(!id || db.battles[id]) return;

                const coords = (raw.getAttribute('data-raw-coords') || '').match(/\d+:\d+:\d+/)?.[0] || '';
                const at = (parseInt(raw.getAttribute('data-raw-timestamp') || raw.getAttribute('data-raw-datetime') || '0', 10) * 1000) || Date.now();

                let fleets, rounds, result, target;
                try
                {
                    fleets = JSON.parse(raw.getAttribute('data-raw-fleets') || '[]');
                    rounds = JSON.parse(raw.getAttribute('data-raw-combatrounds') || '[]');
                    result = JSON.parse(raw.getAttribute('data-raw-result') || '{}');
                    target = JSON.parse(raw.getAttribute('data-raw-defenderspaceobject') || '{}');
                }
                catch(e) { return; }

                // the report says itself where it was fought: a battle on the player's planet or moon is not
                // an anomaly's, even when an archived anomaly carries that planet's coords (see below)
                if(target?.type && target.type !== 'anomaly') return;

                const own = (fleets || []).filter(f => String(f.player?.id) === String(me));
                if(!own.length) return;

                // which anomaly: the report names it by the same id the mission card carries (the archive's key);
                // failing that, by coords and time. Entries saved before 1.3.2 carry the coords the fleet left
                // from, not the anomaly's, so they are found by id only, and take the report's coords.
                const entry = (target?.id && db.entries[target.id]) || matchEntry(known.filter(e => e.located), coords, at);
                if(!entry) return;   // not at an anomaly the archive knows
                if(!entry.located && coords) { entry.coords = coords; entry.located = true; }

                const ownIds = new Set(own.map(f => f.fleetId));
                const lost = {};
                (rounds[rounds.length - 1]?.fleets || []).forEach(f =>
                {
                    if(!ownIds.has(f.fleetId)) return;
                    (f.technologies || []).forEach(t => { if(t.destroyedTotal) lost[t.technologyId] = (lost[t.technologyId] || 0) + t.destroyedTotal; });
                });

                db.battles[id] = { v:2, at, coords, entry:entry.id, lost, won:own.some(f => f.side === result?.winner), draw:result?.winner === 'none' };
                changed = true;
            });

            if(changed) save(DB_KEY, db);
        };

        // ---------- days ----------
        const DAY = 24 * 3600 * 1000;
        const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
        const dayStart = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
        const nextDay = key => { const [y, m, d] = key.split('-').map(Number); return dayKey(new Date(y, m - 1, d + 1).getTime()); };
        const prevDay = key => { const [y, m, d] = key.split('-').map(Number); return dayKey(new Date(y, m - 1, d - 1).getTime()); };
        const dayLabel = key => new Date(dayStart(key)).toLocaleDateString(LANG === 'it' ? 'it-IT' : 'en-GB', { weekday:'short', day:'2-digit', month:'2-digit', year:'numeric' });

        // every dated event, each tied to its anomaly
        const allEvents = db =>
        {
            const entries = Object.values(db.entries);
            const out = [];
            entries.forEach(e => (e.collections || []).forEach(c => out.push({ kind:'collect', entry:e.id, ...c })));
            const located = entries.filter(e => e.located);
            // before 1.3.2 an anomaly's coords were the player's own planet or moon, so flights home were noted
            // as anomaly fuel: a flight to one of the player's planets (the game's own planet list) is left out
            // unless it carries the anomaly mission
            const home = new Set(Array.from(document.querySelectorAll('#planetList .planet-koords')).map(el => coordsText(el.textContent)));
            db.fuel.forEach(f =>
            {
                if(f.mission !== ANOMALY_MISSION && home.has(f.coords)) return;
                out.push({ kind:'fuel', entry:matchEntry(located, f.coords, f.at)?.id || '', ...f });
            });
            Object.entries(db.battles).forEach(([id, b]) => out.push({ kind:'battle', id, ...b }));
            return out;
        };

        const blank = () => ({ collections:0, waves:0, paid:0, back:0, metal:0, crystal:0, deuterium:0, gain:0, other:[],
                               got:{}, gotN:0, gotMsu:0,
                               fuel:0, fuelMsu:0, battles:0, lost:{}, lostN:0, lostMsu:0 });

        const add = (t, ev) =>
        {
            if(ev.kind === 'collect')
            {
                t.collections++; t.waves += ev.waves || 0; t.paid += ev.cost || 0; t.back += ev.lithium || 0;
                t.metal += ev.metal || 0; t.crystal += ev.crystal || 0; t.deuterium += ev.deuterium || 0;
                t.gain += ev.msu || 0;
                (ev.other || []).forEach(text =>
                {
                    const ship = shipReward(text);
                    if(!ship) { t.other.push(text); return; }
                    t.got[ship.id] = (t.got[ship.id] || 0) + ship.n;
                    t.gotN += ship.n; t.gotMsu += lostMsu({ [ship.id]:ship.n });   // build cost in MSU, as for ships lost
                });
            }
            else if(ev.kind === 'fuel') { t.fuel += ev.deut || 0; t.fuelMsu += toMSU(0, 0, ev.deut || 0); }
            else if(ev.kind === 'battle')
            {
                t.battles++;
                Object.entries(ev.lost || {}).forEach(([id, n]) => { t.lost[id] = (t.lost[id] || 0) + n; });
                t.lostN += lostCount(ev.lost); t.lostMsu += lostMsu(ev.lost);
            }
            return t;
        };

        const net = t => t.gain + t.gotMsu - t.lostMsu - t.fuelMsu;

        // "Other" with the same reward added up: two "Esperienza delle Forme di vita" lines become one with
        // the sum; a line without a plain number is listed once with ×count.
        const otherText = list =>
        {
            const sums = new Map();
            (list || []).forEach(text =>
            {
                const x = splitCount(text);
                const key = x ? x[0] : clean(text);
                const cur = sums.get(key) || { n:0, times:0, counted:!!x };
                if(x) cur.n += x[1];
                cur.times++;
                sums.set(key, cur);
            });
            return Array.from(sums, ([name, v]) => v.counted ? `${name} ${v.n.toLocaleString(LANG === 'it' ? 'it-IT' : 'en-GB')}` : name + (v.times > 1 ? ` ×${v.times}` : '')).join(', ');
        };

        // ---------- the panel ----------
        // chartEnd: the chart's last day. It stays put while the selected day is inside the chart, so clicking
        // a bar never pushes the days after it out of sight (up to 1.3.4 the chart always ended on the
        // selected day); ‹ › next to the chart move it a week without changing the selected day.
        const view = { range:'day', day:dayKey(Date.now()), chartEnd:dayKey(Date.now()), q:'', mode:'', kind:'', stars:'', status:'', sort:'date', desc:true };
        const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return dayKey(new Date(y, m - 1, d + n).getTime()); };

        const period = () =>
        {
            if(view.range === 'all') return [0, Infinity];
            const to = dayStart(nextDay(view.day));
            if(view.range === 'day') return [dayStart(view.day), to];
            let from = view.day;
            for(let i = 1; i < Number(view.range); i++) from = prevDay(from);
            return [dayStart(from), to];
        };

        const periodLabel = () => view.range === 'all' ? T.allTime : view.range === 'day' ? dayLabel(view.day) :
            T.lastDays.replace('{n}', view.range).replace('{d}', dayLabel(view.day));

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
            ['paid', T.paid, r => r.t.paid ? compact(r.t.paid) : ''],
            ['back', T.back, r => r.t.back ? compact(r.t.back) : ''],
            ['gain', T.gain, r => r.t.gain ? compact(r.t.gain) : ''],
            ['gotMsu', T.shipsGotShort, r => r.t.gotN ? `${compact(r.t.gotMsu)} <span class="oaMuted">(${compact(r.t.gotN)})</span>` : ''],
            ['fuel', T.fuel, r => r.t.fuel ? compact(r.t.fuel) : ''],
            ['lostMsu', T.lost, r => r.t.lostN ? `${compact(r.t.lostMsu)} <span class="oaMuted">(${compact(r.t.lostN)})</span>` : ''],
            ['net', T.net, r => (r.t.gain || r.t.gotMsu || r.t.lostMsu || r.t.fuelMsu) ? `<span class="${net(r.t) < 0 ? 'oaNeg' : ''}">${compact(net(r.t))}</span>` : ''],
            ['other', T.other, r => esc(otherText(r.t.other))],
        ];
        const NUMERIC = new Set(['date', 'level', 'stars', 'wave', 'paid', 'back', 'gain', 'gotMsu', 'fuel', 'lostMsu', 'net']);
        const sortValue = (r, k) => ({ paid:r.t.paid, back:r.t.back, gain:r.t.gain, gotMsu:r.t.gotMsu, fuel:r.t.fuel, lostMsu:r.t.lostMsu, net:net(r.t) })[k] ?? r[k];

        // the anomalies that appeared in the period (the selected day, by default), with the period's own
        // figures. Up to 1.3.3 every anomaly still alive in the period was listed, so yesterday's showed up today.
        const rowsFor = (db, events, from, to) =>
        {
            const q = view.q.toLowerCase();
            return Object.values(db.entries)
                .filter(e => { const at = e.spawnedAt || e.firstSeen || 0; return at >= from && at < to; })
                .map(e => ({ ...e, date:e.spawnedAt || e.firstSeen || 0, t:events.filter(ev => ev.entry === e.id).reduce(add, blank()) }))
                .filter(r =>
                    (!q || (r.name + ' ' + r.coords).toLowerCase().includes(q)) &&
                    (!view.mode || r.mode === view.mode) && (!view.kind || r.kind === view.kind) &&
                    (!view.stars || String(r.stars) === view.stars) && (!view.status || r.status === view.status))
                .sort((a, b) =>
                {
                    const x = sortValue(a, view.sort), y = sortValue(b, view.sort);
                    const d = NUMERIC.has(view.sort) ? (x || 0) - (y || 0) : String(x || '').localeCompare(String(y || ''));
                    return view.desc ? -d : d;
                });
        };

        const options = (values, current) => `<option value="">${T.all}</option>` +
            [...new Set(values.filter(v => v !== '' && v !== undefined))].sort().map(v => `<option${String(v) === current ? ' selected' : ''}>${esc(v)}</option>`).join('');

        // Daily bars, like OGLight's expedition days: rewards above the line (blue), what the day cost below
        // it (red: ships lost + fuel, both in MSU). Lithium is not MSU and stays out of the chart.
        // Colours: the reference diverging pair, validated against the panel's dark surface. Drawn as HTML
        // columns (not a stretched SVG), so bars keep a sane width and labels are not squashed.
        const chartDays = () => view.range === '30' ? 30 : 14;
        const chart = events =>
        {
            const n = chartDays(), today = dayKey(Date.now());
            // keep a newly selected day in view: move the chart only when it falls outside, and then centre it
            // (not after ‹ ›: those may scroll the selected day away on purpose)
            if(view.chartEnd > today) view.chartEnd = today;
            const moved = view.chartFor !== view.day + view.range;
            view.chartFor = view.day + view.range;
            if(moved && (view.day > view.chartEnd || view.day <= addDays(view.chartEnd, -n)))
            {
                view.chartEnd = addDays(view.day, Math.floor(n / 2));
                if(view.chartEnd > today) view.chartEnd = today;
            }
            const keys = [];
            for(let k = view.chartEnd, i = 0; i < n; i++, k = prevDay(k)) keys.unshift(k);

            const days = keys.map(k =>
            {
                const from = dayStart(k), to = dayStart(nextDay(k));
                const t = events.filter(ev => ev.at >= from && ev.at < to).reduce(add, blank());
                return { k, gain:t.gain + t.gotMsu, cost:t.lostMsu + t.fuelMsu, t };
            });

            const maxUp = Math.max(0, ...days.map(d => d.gain)), maxDown = Math.max(0, ...days.map(d => d.cost));
            const H = 150, VAL = 14;                         // plot height; room for the value over a bar
            const upH = maxUp + maxDown ? Math.round((H - VAL) * maxUp / (maxUp + maxDown)) : H - VAL;
            const downH = H - VAL - upH;
            const every = n > 14 ? 3 : 1;

            const cols = days.map((d, i) =>
            {
                const up = maxUp ? Math.round(upH * d.gain / maxUp) : 0;
                const down = maxDown ? Math.round(downH * d.cost / maxDown) : 0;
                const sel = d.k === view.day && view.range === 'day';
                const tip = `${dayLabel(d.k)}|${T.gain}: ${compact(d.t.gain)} MSU|${T.shipsGot}: ${compact(d.t.gotMsu)} MSU|${T.lostShort}: ${compact(d.t.lostMsu)} MSU|${T.fuel}: ${compact(d.t.fuel)} deut|${T.net}: ${compact(net(d.t))} MSU`;
                const label = (sel || d.k === today || i % every === 0) ? `${d.k.slice(8)}/${d.k.slice(5, 7)}` : '';
                return `<div class="oaBar${sel ? ' oaSel' : ''}${d.k === today ? ' oaToday' : ''}" data-day="${d.k}" data-tip="${esc(tip)}">
                    <div class="oaUpArea" style="height:${upH + VAL}px">${d.gain > 0 && (n <= 14 || sel) ? `<span class="oaVal">${compact(d.gain)}</span>` : ''}${up > 0 ? `<i class="oaUp" style="height:${Math.max(2, up)}px"></i>` : ''}</div>
                    <div class="oaDownArea" style="height:${downH}px">${down > 0 ? `<i class="oaDown" style="height:${Math.max(2, down)}px"></i>` : ''}</div>
                    <span class="oaLbl">${label}</span>
                </div>`;
            }).join('');

            return `<div class="oaChart">
                <div class="oaLegend"><span><i class="oaSwUp"></i>${T.gainAll} (MSU)</span><span><i class="oaSwDown"></i>${T.costs} (MSU)</span>
                    <span class="oaMuted">${T.chartHint}</span></div>
                <div class="oaPlot" role="img" aria-label="${esc(T.chartAria)}">
                    <button class="oaPan" data-a="chartPrev" title="${T.chartPrev}">‹</button>
                    <div class="oaCols" style="--oaZero:${upH + VAL}px">${cols}</div>
                    <button class="oaPan" data-a="chartNext" title="${T.chartNext}"${view.chartEnd >= today ? ' disabled' : ''}>›</button>
                </div><div class="oaTip"></div></div>`;
        };

        const tile = (label, value, sub, cls = '') => `<div class="oaTile ${cls}"><span>${label}</span><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;

        const renderModal = () =>
        {
            const modal = document.querySelector('#orionArchiveModal');
            if(!modal) return;

            const db = loadDb();
            const events = allEvents(db);
            const [from, to] = period();
            const inRange = events.filter(ev => ev.at >= from && ev.at < to);
            const t = inRange.reduce(add, blank());
            const rows = rowsFor(db, inRange, from, to);
            const all = Object.values(db.entries);

            modal.querySelector('.oaPeriod').textContent = periodLabel();
            modal.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('oaOn', b.getAttribute('data-range') === view.range));

            if(!all.length && !db.fuel.length) { modal.querySelector('.oaBody').innerHTML = `<p class="oaEmpty">${T.empty}</p>`; return; }

            const gotList = Object.entries(t.got).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${esc(shipName(id))} ×${compact(n)}`).join(', ');
            const lostList = Object.entries(t.lost).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${esc(shipName(id))} ×${compact(n)}`).join(', ');

            modal.querySelector('.oaBody').innerHTML = `
                <div class="oaTiles">
                    ${tile(T.anomalies, rows.length, `${t.collections} ${T.collectionsShort}${t.waves ? ` · ${t.waves} ${T.wavesShort}` : ''}`)}
                    ${tile(T.gain, compact(t.gain) + ' MSU', `M ${compact(t.metal)} · C ${compact(t.crystal)} · D ${compact(t.deuterium)}`)}
                    ${tile(T.shipsGot, compact(t.gotMsu) + ' MSU', `${compact(t.gotN)} ${T.ships}`)}
                    ${tile(T.lithium, compact(t.paid - t.back), `${T.paidShort} ${compact(t.paid)} · ${T.backShort} ${compact(t.back)}`)}
                    ${tile(T.fuel, compact(t.fuel) + ' deut', `≈ ${compact(t.fuelMsu)} MSU`)}
                    ${tile(T.lost, compact(t.lostMsu) + ' MSU', t.lostN ? `${compact(t.lostN)} ${T.ships} · ${t.battles} ${T.battlesShort}` : `${t.battles} ${T.battlesShort}`)}
                    ${tile(T.net, compact(net(t)) + ' MSU', T.netHint, net(t) < 0 ? 'oaNegTile' : 'oaPosTile')}
                </div>
                ${chart(events)}
                ${gotList || lostList || t.other.length ? `<div class="oaDetail">${gotList ? `<div><b>${T.shipsGot}:</b> ${gotList}</div>` : ''}${lostList ? `<div><b>${T.lost}:</b> ${lostList}</div>` : ''}${t.other.length ? `<div><b>${T.other}:</b> ${esc(otherText(t.other))}</div>` : ''}</div>` : ''}
                <div class="oaFilters">
                    <input type="search" class="oaQ" placeholder="${T.search}" value="${esc(view.q)}">
                    <label>${T.mode} <select data-f="mode">${options(all.map(e => e.mode), view.mode)}</select></label>
                    <label>${T.kind} <select data-f="kind">${options(all.map(e => e.kind), view.kind)}</select></label>
                    <label>${T.stars} <select data-f="stars">${options(all.map(e => e.stars ? String(e.stars) : ''), view.stars)}</select></label>
                    <label>${T.status} <select data-f="status"><option value="">${T.all}</option>${['running', 'collected', 'expired']
                        .map(s => `<option value="${s}"${s === view.status ? ' selected' : ''}>${T[s]}</option>`).join('')}</select></label>
                    <span class="oaMuted">${T.rowsHint}</span>
                </div>
                <div class="oaScroll">${rows.length ? `<table>
                    <thead><tr>${COLUMNS.map(([k, label]) => `<th data-k="${k}">${label}${view.sort === k ? (view.desc ? ' ▾' : ' ▴') : ''}</th>`).join('')}<th></th></tr></thead>
                    <tbody>${rows.map(r => `<tr>${COLUMNS.map(([k, , f]) => `<td class="${NUMERIC.has(k) ? 'oaNum' : ''}">${f(r)}</td>`).join('')}
                        <td><a class="oaDel" data-id="${esc(r.id)}" title="×">×</a></td></tr>`).join('')}</tbody>
                </table>` : `<p class="oaEmpty">${T.noneInPeriod}</p>`}</div>`;
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

        // one line per day, the same figures as the tiles
        const exportCsv = () =>
        {
            const events = allEvents(loadDb());
            const keys = [...new Set(events.map(ev => dayKey(ev.at)))].sort();
            const head = ['day', 'collections', 'waves', 'lithium_paid', 'lithium_back', 'metal', 'crystal', 'deuterium', 'rewards_msu', 'ships_reward', 'ships_reward_msu', 'fuel_deut', 'battles', 'ships_lost', 'ships_lost_msu', 'net_msu'];
            const lines = keys.map(k =>
            {
                const t = events.filter(ev => dayKey(ev.at) === k).reduce(add, blank());
                return [k, t.collections, t.waves, t.paid, t.back, t.metal, t.crystal, t.deuterium, t.gain, t.gotN, t.gotMsu, t.fuel, t.battles, t.lostN, t.lostMsu, net(t)].join(';');
            });
            download('orion-anomalies-per-day.csv', '﻿' + [head.join(';')].concat(lines).join('\n'), 'text/csv');
        };

        const showTip = (modal, g, event) =>
        {
            const tip = modal.querySelector('.oaTip');
            if(!tip) return;
            if(!g) { tip.style.display = 'none'; return; }
            const [title, ...lines] = g.getAttribute('data-tip').split('|');
            tip.innerHTML = `<b>${esc(title)}</b>` + lines.map(l => `<div>${esc(l)}</div>`).join('');
            const box = tip.parentElement.getBoundingClientRect();
            tip.style.display = 'block';
            tip.style.left = Math.min(box.width - 190, Math.max(0, event.clientX - box.left + 12)) + 'px';
            tip.style.top = Math.max(0, event.clientY - box.top - 10) + 'px';
        };

        const openModal = (event, opensToday = false) =>
        {
            if(document.querySelector('#orionArchiveModal')) return;
            if(opensToday) { view.day = view.chartEnd = dayKey(Date.now()); view.range = 'day'; }

            const modal = document.createElement('div');
            modal.id = 'orionArchiveModal';
            modal.innerHTML = `<div class="oaWindow">
                <div class="oaHead"><b>${T.title}</b>
                    <span class="oaNav">
                        <button data-a="prev" title="${T.prevDay}">◀</button><span class="oaPeriod"></span><button data-a="next" title="${T.nextDay}">▶</button>
                        <button data-a="today">${T.today}</button>
                        <span class="oaSeg"><button data-range="day">${T.day}</button><button data-range="7">7 ${T.daysShort}</button><button data-range="30">30 ${T.daysShort}</button><button data-range="all">${T.allTime}</button></span>
                    </span>
                    <span class="oaActions"><button data-a="csv">${T.csv}</button><button data-a="json">${T.json}</button>
                    <button data-a="clear">${T.clear}</button><button data-a="close">${T.close}</button></span></div>
                <div class="oaBody"></div>
                <div class="oaNote">${T.note}</div></div>`;
            document.body.appendChild(modal);

            modal.addEventListener('click', event =>
            {
                if(event.target === modal) return modal.remove();
                const action = event.target.closest('[data-a]')?.getAttribute('data-a');
                if(action === 'close') return modal.remove();
                if(action === 'csv') exportCsv();
                if(action === 'json') download('orion-anomalies.json', JSON.stringify(loadDb(), null, 1), 'application/json');
                if(action === 'clear' && confirm(T.confirmClear)) { save(DB_KEY, { entries:{}, fuel:[], battles:{} }); updateButtons(); }
                if(action === 'prev') { view.day = prevDay(view.day); if(view.range === 'all') view.range = 'day'; }
                if(action === 'next' && view.day < dayKey(Date.now())) { view.day = nextDay(view.day); if(view.range === 'all') view.range = 'day'; }
                if(action === 'today') { view.day = view.chartEnd = dayKey(Date.now()); view.range = 'day'; }
                // scroll the chart a week; the selected day and the table stay as they are
                if(action === 'chartPrev') view.chartEnd = addDays(view.chartEnd, -7);
                if(action === 'chartNext') { view.chartEnd = addDays(view.chartEnd, 7); if(view.chartEnd > dayKey(Date.now())) view.chartEnd = dayKey(Date.now()); }

                const range = event.target.closest('[data-range]')?.getAttribute('data-range');
                if(range) view.range = range;

                const bar = event.target.closest('.oaBar');
                if(bar) { view.day = bar.getAttribute('data-day'); view.range = 'day'; }

                const th = event.target.closest('th[data-k]');
                if(th) { const k = th.getAttribute('data-k'); view.desc = view.sort === k ? !view.desc : NUMERIC.has(k); view.sort = k; }

                const del = event.target.closest('.oaDel');
                if(del && confirm(T.confirmDel)) { const db = loadDb(); delete db.entries[del.getAttribute('data-id')]; save(DB_KEY, db); updateButtons(); }

                if(action || range || bar || th || del) renderModal();
            });

            modal.addEventListener('mousemove', event => showTip(modal, event.target.closest?.('.oaBar'), event));
            modal.addEventListener('mouseleave', () => showTip(modal, null));

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

        // ---------- ways in: the game's left menu (every page), the box under it, and a button above the
        // Orion missions overview (up to 1.3.5 one above every Orion tab, two on some) ----------
        const updateButtons = () =>
        {
            const n = Object.keys(loadDb().entries).length;
            document.querySelectorAll('.orionArchiveButton span').forEach(s => { s.textContent = `${T.button} (${n})`; });
        };

        const placeMenu = () =>
        {
            const menu = document.querySelector('#menuTable');
            if(!menu || menu.querySelector('.orionArchiveMenu')) return;
            const li = document.createElement('li');
            li.className = 'orionArchiveMenu';
            li.innerHTML = `<span class="menu_icon"><span class="orionArchiveMenuIcon">📜</span></span>` +
                           `<a class="menubutton" href="javascript:void(0);"><span class="textlabel">${T.menu}</span></a>`;
            li.querySelector('a').addEventListener('click', openModal);
            menu.appendChild(li);
        };

        const placeButtons = () =>
        {
            let added = false;
            document.querySelectorAll('.orionTabContentWrapper.anomalyMissions').forEach(wrapper =>
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

        // Today's box under the left menu, like OGLight's daily expeditions: rewards collected today per
        // resource and the day's balance in MSU (rewards + ships received − ships lost − fuel). Read from
        // the archive in this browser only; redrawn only when the archive or the day changed.
        let boxKey = '';
        const placeBox = () =>
        {
            const menu = document.querySelector('#menuTable');
            if(!menu) return;
            let box = document.querySelector('#orionTodayBox');
            const today = dayKey(Date.now());
            let raw = '';
            try { raw = localStorage.getItem(DB_KEY) || ''; } catch(e) { /* storage blocked */ }
            const key = today + '|' + raw;
            if(box && key === boxKey) return;
            boxKey = key;

            if(!box)
            {
                box = document.createElement('div');
                box.id = 'orionTodayBox';
                box.title = T.boxHint;
                box.addEventListener('click', event => openModal(event, true));
                menu.insertAdjacentElement('afterend', box);
            }
            const from = dayStart(today), to = dayStart(nextDay(today));
            const t = allEvents(loadDb()).filter(ev => ev.at >= from && ev.at < to).reduce(add, blank());
            const cell = (cls, label, value) => `<div class="otbCell"><span class="otbIcon ${cls}">${label}</span><b class="${value < 0 ? 'otbNeg' : value > 0 ? 'otbPos' : ''}">${compact(value)}</b></div>`;
            box.innerHTML = `<div class="otbHead">Orion · ${esc(new Date(from).toLocaleDateString(LANG === 'it' ? 'it-IT' : 'en-GB', { day:'numeric', month:'long', year:'numeric' }))}</div>
                <div class="otbGrid">${cell('otbM', 'M', t.metal)}${cell('otbC', 'C', t.crystal)}${cell('otbD', 'D', t.deuterium)}${cell('otbMsu', 'MSU', net(t))}</div>`;
        };

        const archiveStyle = document.createElement('style');
        archiveStyle.textContent = `
            .orionArchiveBar { margin:4px 0 6px; text-align:right; }
            .orionArchiveButton { display:inline-block; padding:3px 9px; font-size:11px; color:#d7e3ef !important; background:rgba(0,0,0,.4);
                border:1px solid rgba(143,209,158,.45); border-radius:3px; text-decoration:none !important; }
            .orionArchiveButton:hover { border-color:#8fd19e; color:#fff !important; }
            #orionTodayBox { margin:8px 4px 0; padding:6px 6px 8px; background:rgba(13,16,20,.85); border:1px solid #2c3a47; border-radius:4px;
                font:11px Verdana, Arial, sans-serif; color:#a9b7c6; cursor:pointer; }
            #orionTodayBox:hover { border-color:#3a5068; }
            #orionTodayBox .otbHead { color:#8fb3d9; font-weight:bold; text-align:center; margin-bottom:6px; }
            #orionTodayBox .otbGrid { display:grid; grid-template-columns:1fr 1fr; gap:6px 4px; }
            #orionTodayBox .otbCell { display:flex; flex-direction:column; align-items:center; gap:2px; }
            #orionTodayBox .otbIcon { min-width:22px; height:18px; padding:0 3px; line-height:18px; text-align:center; border-radius:3px; font-size:10px; font-weight:bold; color:#0d1014; }
            #orionTodayBox .otbM { background:#a7a9ad; } #orionTodayBox .otbC { background:#7fc4e8; }
            #orionTodayBox .otbD { background:#4fb3a9; } #orionTodayBox .otbMsu { background:none; color:#fff; }
            #orionTodayBox b { color:#d7e3ef; font-weight:normal; }
            #orionTodayBox .otbPos { color:#8fd19e; } #orionTodayBox .otbNeg { color:#e66767; }
            .orionArchiveMenuIcon { display:inline-block; width:27px; text-align:center; line-height:27px; font-size:14px; }
            #orionArchiveModal { position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; }
            #orionArchiveModal .oaWindow { width:min(1250px, 96vw); max-height:92vh; display:flex; flex-direction:column; background:#0d1014;
                border:1px solid #2c3a47; border-radius:4px; color:#a9b7c6; font:11px Verdana, Arial, sans-serif; box-shadow:0 8px 30px rgba(0,0,0,.7); }
            #orionArchiveModal .oaHead { display:flex; flex-wrap:wrap; gap:6px 12px; justify-content:space-between; align-items:center; padding:8px 10px;
                border-bottom:1px solid #2c3a47; color:#fff; font-size:13px; }
            #orionArchiveModal .oaNav { display:flex; align-items:center; gap:4px; font-size:11px; }
            #orionArchiveModal .oaPeriod { min-width:170px; text-align:center; color:#fff; font-weight:bold; }
            #orionArchiveModal .oaSeg { margin-left:8px; }
            #orionArchiveModal .oaSeg button { margin-left:0; border-radius:0; }
            #orionArchiveModal .oaSeg button:first-child { border-radius:3px 0 0 3px; }
            #orionArchiveModal .oaSeg button:last-child { border-radius:0 3px 3px 0; }
            #orionArchiveModal button.oaOn { background:#2a78d6; border-color:#3987e5; color:#fff; }
            #orionArchiveModal button { margin-left:5px; padding:3px 8px; font-size:11px; color:#d7e3ef; background:#1b2530; border:1px solid #3a4b5c; border-radius:3px; cursor:pointer; }
            #orionArchiveModal button:hover { background:#25384a; }
            #orionArchiveModal .oaBody { display:flex; flex-direction:column; min-height:0; overflow:auto; padding:8px 10px; }
            #orionArchiveModal .oaTiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:8px; margin-bottom:10px; }
            #orionArchiveModal .oaTile { display:flex; flex-direction:column; gap:2px; padding:7px 9px; background:#121a22; border:1px solid #1f2b37; border-radius:4px; }
            #orionArchiveModal .oaTile span { color:#8d9bab; }
            #orionArchiveModal .oaTile b { color:#fff; font-size:16px; }
            #orionArchiveModal .oaTile em { color:#7c8a99; font-style:normal; }
            #orionArchiveModal .oaPosTile { border-color:#2a4f7a; }
            #orionArchiveModal .oaNegTile { border-color:#7a3434; }
            #orionArchiveModal .oaChart { position:relative; margin-bottom:8px; padding:6px 8px; background:#10161d; border-radius:4px; }
            #orionArchiveModal .oaLegend { display:flex; flex-wrap:wrap; gap:14px; margin-bottom:4px; }
            #orionArchiveModal .oaLegend i { display:inline-block; width:10px; height:10px; margin-right:5px; border-radius:2px; vertical-align:-1px; }
            #orionArchiveModal .oaSwUp { background:#3987e5; }
            #orionArchiveModal .oaSwDown { background:#e66767; }
            #orionArchiveModal .oaPlot { display:flex; align-items:stretch; gap:4px; }
            #orionArchiveModal .oaPan { flex:none; width:22px; padding:0; background:#1b2530; border:1px solid #2c3a48; border-radius:3px; color:#d7e3ef; cursor:pointer; font-size:16px; }
            #orionArchiveModal .oaPan:hover:not([disabled]) { background:#24313f; }
            #orionArchiveModal .oaPan[disabled] { opacity:.3; cursor:default; }
            #orionArchiveModal .oaCols { position:relative; flex:1; display:flex; min-width:0; }
            #orionArchiveModal .oaCols::before { content:''; position:absolute; left:0; right:0; top:var(--oaZero); border-top:1px solid #3a4b5c; }
            #orionArchiveModal .oaBar { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; border-radius:3px; cursor:pointer; }
            #orionArchiveModal .oaBar:hover { background:rgba(255,255,255,.04); }
            #orionArchiveModal .oaSel, #orionArchiveModal .oaSel:hover { background:rgba(57,135,229,.14); box-shadow:inset 0 0 0 1px rgba(57,135,229,.45); }
            #orionArchiveModal .oaUpArea { width:100%; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; }
            #orionArchiveModal .oaDownArea { width:100%; display:flex; flex-direction:column; align-items:center; padding-top:1px; }
            #orionArchiveModal .oaUp, #orionArchiveModal .oaDown { display:block; width:70%; max-width:34px; }
            #orionArchiveModal .oaUp { background:#3987e5; border-radius:3px 3px 0 0; }
            #orionArchiveModal .oaDown { background:#e66767; border-radius:0 0 3px 3px; }
            #orionArchiveModal .oaVal { color:#9fb3c8; font-size:9px; line-height:12px; white-space:nowrap; }
            #orionArchiveModal .oaLbl { height:14px; margin-top:2px; color:#7c8a99; font-size:10px; white-space:nowrap; }
            #orionArchiveModal .oaToday .oaLbl { color:#d7e3ef; }
            #orionArchiveModal .oaSel .oaLbl { color:#fff; font-weight:bold; }
            #orionArchiveModal .oaTip { display:none; position:absolute; z-index:2; width:180px; padding:6px 8px; pointer-events:none;
                background:#1b2530; border:1px solid #3a4b5c; border-radius:3px; color:#d7e3ef; }
            #orionArchiveModal .oaTip b { color:#fff; }
            #orionArchiveModal .oaDetail { margin-bottom:8px; line-height:1.6; }
            #orionArchiveModal .oaDetail b { color:#d7e3ef; }
            #orionArchiveModal .oaFilters { display:flex; flex-wrap:wrap; gap:6px 12px; align-items:center; margin-bottom:8px; }
            #orionArchiveModal input, #orionArchiveModal select { font-size:11px; color:#d7e3ef; background:#151c24; border:1px solid #3a4b5c; border-radius:3px; padding:2px 4px; }
            #orionArchiveModal .oaQ { width:200px; }
            #orionArchiveModal .oaScroll { overflow:auto; max-height:40vh; }
            #orionArchiveModal table { width:100%; border-collapse:collapse; }
            #orionArchiveModal th { position:sticky; top:0; background:#16202a; color:#fff; padding:4px 5px; text-align:left; cursor:pointer; white-space:nowrap; }
            #orionArchiveModal td { padding:3px 5px; border-bottom:1px solid #1d2731; white-space:nowrap; }
            #orionArchiveModal tbody tr:hover { background:#141d26; }
            #orionArchiveModal .oaNum { text-align:right; }
            #orionArchiveModal .oaMuted { color:#7c8a99; }
            #orionArchiveModal .oaNeg { color:#e66767; }
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

        // called by the calculator's observer, with the observer disconnected. Every step returns at once
        // when it has nothing to do, so this is cheap on pages that are not Orion.
        const tick = () =>
        {
            if(dialogOpen()) dialogSeen = Date.now();
            placeMenu();
            readBattles();
            placeBox();
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
