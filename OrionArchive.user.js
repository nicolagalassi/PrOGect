// ==UserScript==
// @name         OGame Orion Archive
// @namespace    https://github.com/nicolagalassi
// @version      1.0.0
// @description  Project Orion test server: a local, searchable archive of every anomaly you took on - level, stars, PvP/PvE, type, lithium paid and given back, and the rewards you collected. Display only.
// @author       nicolagalassi
// @match        https://s808-en.ogame.gameforge.com/game/*
// @icon         https://gf1.geo.gfsrv.net/cdn3d/favicon.ico
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

/*
  OGame Orion Archive - the history of your Project Orion anomalies.

  WHERE IT RUNS
  Only on the Project Orion test server (s808-en, @match above): Orion does not exist anywhere else yet.
  It needs nothing else: no OGLight, no Orion Calculator. When OGLight runs, its MSU ratio is used.

  WHAT IT RECORDS
  Every time you open the Orion missions tab, each anomaly listed there is written down (or updated),
  keyed by the game's own id for it (data-space-object-id):
    name, coordinates, level, difficulty stars, PvP/PvE, type (e.g. "Battle"), when it appeared,
    waves reached.
  When you press the game's collect-rewards button, the rewards on screen and the lithium the button
  says it costs are noted, and saved as a collection once the game has really paid them out (the
  rewards on the card changed or the card is gone). A click the game refuses is forgotten after 20 s.
  When an anomaly is no longer listed it is closed: "collected" if at least one collection was saved,
  "expired" otherwise.

  WHERE TO SEE IT
  An "Anomaly archive" button above the Orion tab content opens a table: search, filters (PvP/PvE,
  type, stars, status), sorting by any column, totals of what is shown, CSV/JSON export, delete a row.

  WHAT IT CANNOT KNOW
  - Rewards collected while this script was not installed, or on another browser.
  - Rewards that are not resources (ships and the like) are kept as the text the game shows; they are
    not turned into MSU.

  COMPLIANCE (OGame Origin tool rules - see AGENTS.md):
  - §1.1/§1.2  Display only. The collect click is only READ by a capture listener; it is never
               stopped, delayed, changed or repeated. Nothing is clicked for you.
  - §1.3/§4    NO request to the game server. It reads the Orion tab you opened; a DOM-only observer
               follows the game redrawing it.
  - §4.2       No cp=, no planet switching.
  - §1.4       No alarm or notification of any kind.
  - §1.9       Nothing leaves the machine: the archive lives in this browser's localStorage. The
               export buttons only save a file on your own computer, when you click them.
  - §5         Runs inside the OGame page -> needs toleration before public distribution.
*/

const onDomReady = fn => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn, { once:true }) : fn();

onDomReady(function()
{
    'use strict';

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
    const parseNumber = text => parseInt(String(text || '').replace(/[^\d]/g, ''), 10) || 0;
    const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
    const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);

    // OGLight's Util.getMSU, so the figure matches every MSU OGLight shows; 3:2:1 without OGLight
    const toMSU = (metal, crystal, deut) =>
    {
        let ratio = '3:2:1';
        try { ratio = window.ogl?.db?.options?.msu || ratio; } catch(e) { /* OGLight not running */ }
        const r = String(ratio).split(':').map(Number);
        if(!(r[0] > 0 && r[1] > 0)) return Math.ceil(metal + crystal * 1.5 + deut * 3);
        return Math.ceil(metal + crystal * r[0] / r[1] + deut * r[0]);
    };

    const compact = value =>
    {
        const abs = Math.abs(value);
        if(abs >= 1e9) return (value / 1e9).toFixed(2) + 'B';
        if(abs >= 1e6) return (value / 1e6).toFixed(1) + 'M';
        if(abs >= 1e3) return (value / 1e3).toFixed(1) + 'k';
        return String(Math.round(value));
    };

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
        document.querySelectorAll('.orionTabContentWrapper').forEach(wrapper =>
        {
            if(wrapper.previousElementSibling?.classList.contains('orionArchiveBar')) return;
            const bar = document.createElement('div');
            bar.className = 'orionArchiveBar';
            bar.innerHTML = `<a href="javascript:void(0);" class="orionArchiveButton">📜 <span></span></a>`;
            bar.querySelector('a').addEventListener('click', openModal);
            wrapper.insertAdjacentElement('beforebegin', bar);
        });
        updateButtons();
    };

    const style = document.createElement('style');
    style.textContent = `
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
    document.head.appendChild(style);

    // DOM-only observer (no network): the game fetches and redraws the Orion tabs and every wave changes
    // a mission's rewards. Our own changes happen with the observer disconnected.
    let scheduled = false;
    const watch = () => observer.observe(document.body, { childList:true, subtree:true });
    const observer = new MutationObserver(() =>
    {
        if(scheduled) return;
        scheduled = true;
        requestAnimationFrame(() =>
        {
            scheduled = false;
            if(!document.querySelector('.orionTabContentWrapper')) return;
            observer.disconnect();
            try { placeButtons(); sync(); }
            finally { watch(); }
        });
    });

    if(document.querySelector('.orionTabContentWrapper')) { placeButtons(); sync(); }
    watch();
});
