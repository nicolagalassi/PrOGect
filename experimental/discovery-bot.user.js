// ==UserScript==
// @name         OGame Discovery Bot V16 (v13-compat)
// @namespace    http://tampermonkey.net/
// @version      16.0
// @description  Bot di prova per lo studio delle dinamiche Discovery su OGame v13. Ricarica correttamente la pagina alla scadenza del timer e legge gli slot dalla risposta AJAX reale (sendSystemDiscoveryFleet). NON e' parte di PrOGect: automatizza il gameplay, uso a scopo di ricerca/test.
// @author       nicolagalassi
// @match        https://*.ogame.gameforge.com/game/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // =========================================================================
    // NOTE V13 (differenze rispetto alla V15 che girava su v12):
    //  - La galassia su v13 e' una SPA: il cambio sistema passa da
    //    action=fetchSolarSystemData (asJson=1). Il ricambio pieno di pagina
    //    (window.location) resta valido perche' il server renderizza comunque
    //    #galaxycomponent server-side, quindi il modello "1 reload = 1 sistema"
    //    e' mantenuto (lo stato vive in GM_setValue e sopravvive al reload).
    //  - L'invio discovery e' AJAX: action=sendSystemDiscoveryFleet /
    //    sendDiscoveryFleet. La risposta JSON contiene response.success e
    //    response.slots (slot USATI, valore autorevole). Leggere #slotUsed dal
    //    DOM subito dopo il click e' inaffidabile -> lo intercettiamo via XHR.
    //  - Vari id/classi possono essere rinominati: usiamo selettori con
    //    fallback (vedi funzione q()).
    // =========================================================================

    // --- CONFIG SELETTORI (modifica qui se il tuo universo usa id diversi) ---
    const SEL = {
        systemInput:  ['#system_input', 'input[name="system"]', '#system'],
        galaxyInput:  ['#galaxy_input', 'input[name="galaxy"]', '#galaxy'],
        slotUsed:     ['#slotUsed', '#galaxycomponent #slotUsed'],
        slotTotal:    ['#slotValue', '#galaxycomponent #slotValue'],
        discoverBtn:  ['#discoverySystemBtn', '#discoverSystemBtn', '.discoveryButton',
                       'button[data-discovery]', 'a.discovery', '[id*="iscover"]'],
        eventBox:     ['#eventContent', '#eventboxContent table', '.eventFleet'],
        eventToggle:  ['#js_eventDetailsClosed', '#js_eventDetailsOpen'],
    };

    // helper: primo selettore che matcha
    function q(list) { for (const s of list) { const e = document.querySelector(s); if (e) return e; } return null; }
    function qAll(list) { for (const s of list) { const e = document.querySelectorAll(s); if (e.length) return Array.from(e); } return []; }
    function toInt(el, def = 0) { if (!el) return def; const n = parseInt((el.innerText || el.textContent || el.value || '').replace(/[^\d-]/g, ''), 10); return isNaN(n) ? def : n; }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function getUrlParam(url, param) { try { return new URL(url, window.location.origin).searchParams.get(param); } catch(e) { return null; } }

    // =========================================================================
    // 0. INTERCETTORE AJAX  (fix "slot check non corretto")
    //    Cattura la risposta reale della discovery: success + slot usati.
    // =========================================================================
    const DISCOVERY_URL_RE = /sendSystemDiscoveryFleet|sendDiscoveryFleet/i;
    // Ultimo esito discovery: { ts, success, slots, message }  (slots = usati, autorevole)
    window.__ogdb_lastDiscovery = null;

    function ingestDiscovery(rawText) {
        try {
            const json = typeof rawText === 'string' ? JSON.parse(rawText) : rawText;
            const resp = json?.response ?? json;
            if (resp && (resp.success !== undefined || resp.slots !== undefined)) {
                window.__ogdb_lastDiscovery = {
                    ts: Date.now(),
                    success: !!resp.success,
                    slots: (resp.slots !== undefined && resp.slots !== null) ? parseInt(String(resp.slots).replace(/[^\d]/g, ''), 10) : null,
                    message: resp.message || ''
                };
            }
        } catch (e) { /* risposta non JSON: ignora */ }
    }

    // Wrap XMLHttpRequest (OGame usa jQuery.ajax -> XHR)
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) { this.__ogdb_url = url; return _open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            if (this.__ogdb_url && DISCOVERY_URL_RE.test(this.__ogdb_url)) ingestDiscovery(this.responseText);
        });
        return _send.apply(this, arguments);
    };
    // Wrap fetch (nel caso v13 usi fetch per la discovery)
    if (window.fetch) {
        const _fetch = window.fetch;
        window.fetch = function(input, init) {
            const url = (typeof input === 'string') ? input : (input && input.url) || '';
            return _fetch.apply(this, arguments).then(res => {
                if (DISCOVERY_URL_RE.test(url)) { res.clone().text().then(ingestDiscovery).catch(() => {}); }
                return res;
            });
        };
    }

    // =========================================================================
    // 1. STILI HUD
    // =========================================================================
    GM_addStyle(`
        #ogdb-hud { position: fixed; top: 120px; right: 15px; width: 250px;
            background: linear-gradient(180deg,#1e232e 0%,#11141a 100%); border: 1px solid #334252;
            box-shadow: 0 0 10px rgba(0,0,0,.7); color: #8897a6; z-index: 100000;
            font-family: Verdana,Arial,Helvetica,sans-serif; font-size: 11px; border-radius: 5px;
            overflow: hidden; transition: height .3s ease; }
        #ogdb-header { background: linear-gradient(180deg,#2b3442 0%,#1e232e 100%); border-bottom: 1px solid #334252;
            padding: 6px 10px; display: flex; justify-content: space-between; align-items: center; font-weight: bold; color: #c3d2e3; }
        #ogdb-toggle-btn { cursor: pointer; padding: 2px 6px; color: #c3d2e3; font-size: 14px; }
        #ogdb-toggle-btn:hover { color: #fff; }
        #ogdb-body { padding: 10px; }
        #ogdb-hud.minimized #ogdb-body { display: none; }
        .ogdb-select { width: 100%; background: #161a23; color: #c3d2e3; border: 1px solid #334252; padding: 4px; margin-bottom: 8px; border-radius: 3px; }
        .ogdb-btn { cursor: pointer; border-radius: 3px; font-weight: bold; padding: 6px; text-align: center; transition: background .2s; border: 1px solid transparent; }
        .ogdb-btn.main { background: #4CAF50; color: #fff; border-color: #3e8e41; width: 100%; margin-bottom: 8px; }
        .ogdb-btn.main:hover { background: #5cb85c; }
        .ogdb-btn.main.paused { background: #FF9800; border-color: #e68a00; }
        .ogdb-btn.reset { background: linear-gradient(180deg,#7c1a1a 0%,#5a1313 100%); color: #ffcccc; border: 1px solid #9e2222; font-size: 10px; padding: 4px; }
        .ogdb-btn.reset:hover { background: linear-gradient(180deg,#9e2222 0%,#7c1a1a 100%); color: #fff; }
        #bot-info-panel { background: #0d1014; padding: 8px; border-radius: 4px; border: 1px solid #1f2733; }
        .info-row { display: flex; justify-content: space-between; margin-bottom: 3px; }
        .info-label { color: #546275; }
        .info-val { color: #c3d2e3; font-weight: bold; }
        .hl-cyan { color: #00d0ff; } .hl-magenta { color: #ff55ff; } .hl-yellow { color: #ff0; }
        .hl-green { color: #0f0; } .hl-red { color: #ff3333; }
    `);

    // =========================================================================
    // 2. MULTIVERSE STORAGE
    // =========================================================================
    const UNI_ID = window.location.host.split('.')[0];
    const getUniValue = (k, d) => GM_getValue(`${UNI_ID}_${k}`, d);
    const setUniValue = (k, v) => GM_setValue(`${UNI_ID}_${k}`, v);

    let config = {
        paused:     getUniValue('paused', true),
        targetCp:   getUniValue('targetCp', null),
        history:    getUniValue('history', {}),
        resumeTime: getUniValue('resumeTime', 0),
        isMinimized:getUniValue('isMinimized', false)
    };

    let isNavigating = false;   // true = stiamo per cambiare pagina, non fare altro
    let isSending    = false;   // true = discovery in corso, in attesa risposta AJAX

    // =========================================================================
    // 3. PARSING PIANETI (con fallback v13)
    // =========================================================================
    function getPlanets() {
        const planets = [];
        document.querySelectorAll('#planetList .smallplanet, [id*="planetList"] .smallplanet').forEach(div => {
            const nameEl   = div.querySelector('.planet-name') || div.querySelector('[class*="name"]');
            const coordsEl = div.querySelector('.planet-koords') || div.querySelector('[class*="koords"]') || div.querySelector('[class*="coords"]');
            const planetLink = div.querySelector('.planetlink') || div.querySelector('a[href*="cp="]:not([class*="moon"])');
            const moonLink   = div.querySelector('.moonlink')   || div.querySelector('a[href*="cp="][class*="moon"]');
            if (nameEl && coordsEl && planetLink) {
                const name = nameEl.innerText.trim();
                const coords = coordsEl.innerText.replace(/[\[\]]/g, '').trim();
                const cpPlanet = getUrlParam(planetLink.href, 'cp');
                if (cpPlanet) planets.push({ name, coords, cp: cpPlanet, text: `🪐 ${name} [${coords}]` });
                if (moonLink) {
                    const cpMoon = getUrlParam(moonLink.href, 'cp');
                    if (cpMoon) planets.push({ name, coords, cp: cpMoon, text: `🌑 ${name} [${coords}] (L)` });
                }
            }
        });
        return planets;
    }

    // =========================================================================
    // 4. SPIRALE
    // =========================================================================
    function calculateSpiralSystem(startSys, step) {
        if (step === 0) return startSys;
        const offset = (step % 2 !== 0) ? Math.ceil(step / 2) : -(step / 2);
        const target = startSys + offset;
        if (target > 499) return -1;
        if (target < 1) return -2;
        return target;
    }
    // Trova il prossimo step valido (salta i sistemi fuori range 1..499)
    function nextValidStep(startSys, fromStep) {
        let step = fromStep;
        let sys = calculateSpiralSystem(startSys, step);
        let guard = 0;
        while ((sys < 1 || sys > 499) && guard < 2000) { step++; sys = calculateSpiralSystem(startSys, step); guard++; }
        return { step, sys };
    }

    // =========================================================================
    // 5. HUD
    // =========================================================================
    const hud = document.createElement('div');
    hud.id = 'ogdb-hud';
    if (config.isMinimized) hud.classList.add('minimized');

    const planetsList = getPlanets();
    let optionsHtml = `<option value="">-- Partenza --</option>`;
    planetsList.forEach(p => {
        const selected = (p.cp == config.targetCp) ? 'selected' : '';
        optionsHtml += `<option value="${p.cp}" ${selected}>${p.text}</option>`;
    });

    hud.innerHTML = `
        <div id="ogdb-header">
            <div style="display:flex;align-items:center;">
                <span id="bot-indicator" style="width:8px;height:8px;border-radius:50%;background:red;margin-right:8px;box-shadow:0 0 4px red;"></span>
                <span>DiscoBot V16 <span style="font-size:9px;opacity:.7;">(${UNI_ID})</span></span>
            </div>
            <div id="ogdb-toggle-btn">${config.isMinimized ? '▢' : '_'}</div>
        </div>
        <div id="ogdb-body">
            <select id="bot-planet-select" class="ogdb-select">${optionsHtml}</select>
            <div style="display:flex;gap:5px;margin-bottom:8px;align-items:center;">
                <div style="flex-grow:1;font-size:10px;color:#546275;">Sistema attuale come Centro -></div>
                <button id="bot-reset-btn" class="ogdb-btn reset">Reset ↻</button>
            </div>
            <button id="bot-pause-btn" class="ogdb-btn main">Caricamento...</button>
            <div id="bot-info-panel">
                <div class="info-row"><span class="info-label">🎯 Target</span><span id="hud-target-name" class="info-val">-</span></div>
                <div class="info-row"><span class="info-label">🌀 Centro</span><span id="hud-start-sys" class="info-val hl-magenta">-</span></div>
                <div class="info-row"><span class="info-label">🔢 Step</span><span id="hud-step" class="info-val hl-cyan">-</span></div>
                <div class="info-row"><span class="info-label">⏭️ Next</span><span id="hud-next-sys" class="info-val hl-yellow">-</span></div>
                <div style="border-top:1px solid #1f2733;margin:4px 0;"></div>
                <div class="info-row"><span class="info-label">🚀 Slot</span><span id="hud-slots" class="info-val">-/-</span></div>
                <div class="info-row"><span class="info-label">ℹ️ Stato</span><span id="hud-status" class="info-val">In attesa</span></div>
            </div>
        </div>`;
    document.body.appendChild(hud);

    const toggleBtn   = document.getElementById('ogdb-toggle-btn');
    const pauseBtn    = document.getElementById('bot-pause-btn');
    const resetBtn    = document.getElementById('bot-reset-btn');
    const planetSelect= document.getElementById('bot-planet-select');
    const statusEl    = document.getElementById('hud-status');
    const indicator   = document.getElementById('bot-indicator');

    toggleBtn.onclick = () => {
        config.isMinimized = !config.isMinimized;
        setUniValue('isMinimized', config.isMinimized);
        hud.classList.toggle('minimized', config.isMinimized);
        toggleBtn.innerText = config.isMinimized ? '▢' : '_';
    };

    function getHistoryForCp(cp) { return (cp && config.history[cp]) ? config.history[cp] : { startSys: 0, step: 0 }; }
    function saveHistoryForCp(cp, startSys, step) {
        if (!cp) return;
        config.history[cp] = { startSys, step };
        setUniValue('history', config.history);
        updateHudInfo();
    }

    function updateHudInfo() {
        const cp = config.targetCp;
        const pData = planetsList.find(x => x.cp == cp);
        if (!pData) return;
        document.getElementById('hud-target-name').innerText = pData.name;
        const h = getHistoryForCp(cp);
        if (h.startSys > 0) {
            document.getElementById('hud-start-sys').innerText = h.startSys;
            document.getElementById('hud-step').innerText = `${h.step} (${(h.step % 2 !== 0) ? '+' : '-'}${Math.ceil(h.step / 2)})`;
            const nextSys = calculateSpiralSystem(h.startSys, h.step);
            document.getElementById('hud-next-sys').innerText = nextSys > 0 ? nextSys : 'Limit';
        } else {
            document.getElementById('hud-start-sys').innerText = '-';
            document.getElementById('hud-step').innerText = '-';
            document.getElementById('hud-next-sys').innerText = '-';
        }
    }

    function updatePauseBtnUI() {
        if (config.paused) {
            pauseBtn.innerText = '▶️ AVVIA'; pauseBtn.classList.remove('paused');
            indicator.style.background = 'red'; indicator.style.boxShadow = '0 0 4px red';
            updateStatus('In Pausa.');
        } else {
            pauseBtn.innerText = '⏸ PAUSA'; pauseBtn.classList.add('paused');
            indicator.style.background = '#00ff00'; indicator.style.boxShadow = '0 0 6px #00ff00';
        }
    }
    function updateStatus(msg, colorClass = '') { statusEl.innerText = msg; statusEl.className = 'info-val ' + colorClass; }

    pauseBtn.onclick = () => {
        config.paused = !config.paused;
        setUniValue('paused', config.paused);
        if (!config.paused) { config.resumeTime = 0; setUniValue('resumeTime', 0); }
        updatePauseBtnUI();
    };
    resetBtn.onclick = () => {
        if (!config.targetCp) { alert('Seleziona target.'); return; }
        const sysInput = q(SEL.systemInput);
        if (sysInput) {
            const cur = parseInt(sysInput.value);
            saveHistoryForCp(config.targetCp, cur, 0);
            updateStatus(`Centro Reset: ${cur}`, 'hl-cyan');
            isNavigating = false;
        } else {
            saveHistoryForCp(config.targetCp, 0, 0);
            updateStatus('Memoria Resettata.', 'hl-red');
        }
    };
    planetSelect.onchange = (e) => {
        config.targetCp = e.target.value;
        setUniValue('targetCp', config.targetCp);
        updateHudInfo();
        updateStatus('Target cambiato.');
    };

    updatePauseBtnUI();
    updateHudInfo();

    // =========================================================================
    // 6. NAVIGAZIONE
    // =========================================================================
    function getCurrentCp() { return getUrlParam(window.location.href, 'cp'); }

    function navigateToSystem(targetSystem) {
        targetSystem = Math.max(1, Math.min(499, targetSystem));
        let url = window.location.href;
        if (/&system=\d+/.test(url)) url = url.replace(/&system=\d+/, `&system=${targetSystem}`);
        else url += `&system=${targetSystem}`;
        isNavigating = true;
        window.location.href = url;
    }

    function readSlots() {
        const used = toInt(q(SEL.slotUsed), -1);
        const total = toInt(q(SEL.slotTotal), -1);
        return { used, total, valid: used >= 0 && total >= 0 };
    }

    // =========================================================================
    // 7. CALCOLO ATTESA  (flotte discovery/LF in rientro -> mission-type 18)
    //    Best-effort: se non troviamo eventi, fallback fisso. In ogni caso alla
    //    scadenza RICARICHIAMO la pagina (vedi mainLoop) quindi si auto-corregge.
    // =========================================================================
    async function calculateWaitTime() {
        updateStatus('Slot pieni. Analisi rientri...', 'hl-yellow');
        const toggle = q(SEL.eventToggle);
        if (toggle && toggle.offsetParent !== null) { try { toggle.click(); } catch (e) {} }
        await sleep(1500);

        const rows = qAll(['#eventContent tr.eventFleet', 'tr.eventFleet', '#eventboxContent tr.eventFleet']);
        let minWait = null;
        rows.forEach(row => {
            const isReturn = row.getAttribute('data-return-flight') === 'true';
            const missionType = row.getAttribute('data-mission-type');
            if (isReturn && missionType === '18') {
                const arrival = parseInt(row.getAttribute('data-arrival-time')) * 1000;
                const diff = arrival - Date.now();
                if (diff > 0 && (minWait === null || diff < minWait)) minWait = diff;
            }
        });

        // margine di sicurezza dopo l'atterraggio, cosi' lo slot e' realmente libero
        const wakeUp = (minWait !== null)
            ? Date.now() + minWait + 5000
            : Date.now() + 60000; // nessun rientro LF trovato: ricontrolla tra 60s
        config.resumeTime = wakeUp;
        setUniValue('resumeTime', wakeUp);
        updateStatus(minWait !== null ? 'Timer rientro impostato.' : 'Nessun rientro. Check 60s.', minWait !== null ? 'hl-cyan' : 'hl-red');
    }

    // =========================================================================
    // 8. LOOP PRINCIPALE
    // =========================================================================
    async function mainLoop() {
        if (config.paused) return;

        // --- Gestione timer (FIX: alla scadenza si RICARICA la pagina) ---
        const now = Date.now();
        if (config.resumeTime > 0) {
            if (now < config.resumeTime) {
                const s = Math.ceil((config.resumeTime - now) / 1000);
                updateStatus(`💤 Standby: ${s}s`, 'hl-yellow');
                return;
            }
            // Timer scaduto: azzera lo stato e forza un reload REALE della pagina
            // cosi' #slotUsed e la eventlist tornano freschi. Senza questo reload
            // il bot rileggeva un DOM stale (slot ancora "pieni") e non ripartiva.
            config.resumeTime = 0;
            setUniValue('resumeTime', 0);
            updateStatus('⏰ Ripresa: ricarico...', 'hl-green');
            isNavigating = true;
            window.location.reload();
            return;
        }

        if (isNavigating || isSending) return;
        if (!config.targetCp) { updateStatus('Seleziona partenza!', 'hl-red'); return; }

        // 1) Assicurati di essere sul pianeta target
        if (getCurrentCp() != config.targetCp) {
            updateStatus('Vado al target...', 'hl-cyan');
            const baseUrl = window.location.href.split('?')[0];
            isNavigating = true;
            window.location.href = `${baseUrl}?page=ingame&component=galaxy&cp=${config.targetCp}`;
            return;
        }

        // 2) Assicurati di essere nella galassia
        if (getUrlParam(window.location.href, 'component') !== 'galaxy') {
            updateStatus('Apro Galassia...', 'hl-cyan');
            isNavigating = true;
            window.location.href = window.location.href + '&component=galaxy';
            return;
        }

        // 3) Trova l'input sistema (attende che la SPA v13 abbia renderizzato)
        const sysInput = q(SEL.systemInput);
        if (!sysInput || !sysInput.value) return;
        const currentSystem = parseInt(sysInput.value);

        // 4) Auto-set del centro spirale al primo giro
        let mem = getHistoryForCp(config.targetCp);
        if (mem.startSys === 0) {
            saveHistoryForCp(config.targetCp, currentSystem, 0);
            mem = getHistoryForCp(config.targetCp);
            updateStatus('Centro spirale auto-settato.', 'hl-cyan');
        }

        // 5) Calcola il sistema target dello step corrente (saltando i fuori-range)
        const nv = nextValidStep(mem.startSys, mem.step);
        if (nv.step !== mem.step) { saveHistoryForCp(config.targetCp, mem.startSys, nv.step); mem.step = nv.step; }
        const targetSystem = nv.sys;

        // 6) Se non siamo nel sistema giusto, spostati (reload)
        if (currentSystem !== targetSystem) {
            updateStatus(`Spirale: vado a ${targetSystem}...`, 'hl-yellow');
            await sleep(600);
            navigateToSystem(targetSystem);
            return;
        }

        // 7) Leggi gli slot (FIX: check preventivo con valori dal DOM freschi del reload)
        const slots = readSlots();
        if (slots.valid) {
            const slotsEl = document.getElementById('hud-slots');
            slotsEl.innerText = `${slots.used}/${slots.total}`;
            slotsEl.classList.toggle('hl-red', slots.used >= slots.total);
            if (slots.used >= slots.total) { await calculateWaitTime(); return; }
        }

        // 8) Invia discovery e aspetta la RISPOSTA AJAX reale (fix slot check)
        const discoverBtn = q(SEL.discoverBtn);
        if (!discoverBtn) {
            // Nessun pulsante discovery in questo sistema: consideralo "fatto", avanza.
            updateStatus('No discovery qui. Next...', 'hl-yellow');
            const step = mem.step + 1;
            const next = nextValidStep(mem.startSys, step);
            saveHistoryForCp(config.targetCp, mem.startSys, next.step);
            await sleep(500);
            navigateToSystem(next.sys);
            return;
        }

        // Click + attesa esito autorevole dall'intercettore
        isSending = true;
        window.__ogdb_lastDiscovery = null;
        const clickTs = Date.now();
        updateStatus(`Invio (Step ${mem.step})...`, 'hl-green');
        try { discoverBtn.click(); } catch (e) { isSending = false; updateStatus('Errore click.', 'hl-red'); return; }

        // Attendi fino a 8s la risposta di sendSystemDiscoveryFleet
        let result = null;
        for (let i = 0; i < 40; i++) {
            await sleep(200);
            if (window.__ogdb_lastDiscovery && window.__ogdb_lastDiscovery.ts >= clickTs) {
                result = window.__ogdb_lastDiscovery;
                break;
            }
        }

        if (!result) {
            // Nessuna risposta: forse il bottone non ha inviato (gia' esplorato / cooldown).
            // Rileggi gli slot dal DOM come fallback prima di decidere.
            isSending = false;
            const s2 = readSlots();
            if (s2.valid && s2.used >= s2.total) { updateStatus('Timeout, slot pieni.', 'hl-red'); await calculateWaitTime(); return; }
            updateStatus('Timeout invio. Next...', 'hl-red');
            const step = mem.step + 1;
            const next = nextValidStep(mem.startSys, step);
            saveHistoryForCp(config.targetCp, mem.startSys, next.step);
            await sleep(800);
            navigateToSystem(next.sys);
            return;
        }

        // Abbiamo l'esito reale. result.slots = slot USATI autorevoli.
        const total = toInt(q(SEL.slotTotal), -1);
        const usedNow = (result.slots !== null) ? result.slots : readSlots().used;
        if (total >= 0 && usedNow >= 0) {
            const slotsEl = document.getElementById('hud-slots');
            slotsEl.innerText = `${usedNow}/${total}`;
            slotsEl.classList.toggle('hl-red', usedNow >= total);
        }

        isSending = false;

        // LOGICA COMPLETIONIST (ora basata sui dati veri):
        // - se dopo l'invio gli slot sono pieni -> RESTA qui, imposta timer, non avanzare.
        // - altrimenti (successo con spazio, oppure nessun invio) -> avanza nella spirale.
        if (total >= 0 && usedNow >= total) {
            updateStatus(result.success ? `Inviata ma FULL. Resto.` : `Slot pieni. Resto.`, 'hl-red');
            await calculateWaitTime();
            return;
        }

        updateStatus(result.success ? 'OK & spazio. Next...' : 'Vuoto/skip. Next...', 'hl-green');
        const step = mem.step + 1;
        const next = nextValidStep(mem.startSys, step);
        saveHistoryForCp(config.targetCp, mem.startSys, next.step);
        await sleep(1200);
        navigateToSystem(next.sys);
    }

    // Loop cadenzato. mainLoop e' async ma i branch che navigano settano
    // isNavigating/isSending per evitare rientri concorrenti.
    setInterval(() => { mainLoop().catch(e => console.error('[DiscoBot]', e)); }, 1000);

})();
