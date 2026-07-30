# API OGame usabili dal tool — riferimento PrOGect

Mappa delle API OGame sfruttabili da PrOGect e di come usarle **in modo leggero e conforme**.
Ogni endpoint riporta il suo vincolo di conformità **al punto d'uso** (riferimenti a `AGENTS.md`).

**Fonti:** `AGENTS.md` §1.3/§1.5.1/§4/§6 (autorevoli) · doc `ogame-one/docs/EXTERNALDATAEXPORT.md`
(verificata live su Singularity `s808-en`, 13.0.0-beta) · endpoint realmente usati in `PrOGect.user.js`.

> Regola d'oro: **una feature nuova ≈ funzione pura sui dati GIÀ idratati + un po' di UI**, non un
> nuovo sistema di fetch/sync. Vedi "Inventario data-layer" e "Regola operativa" in fondo.

---

## Livello 1 — API pubblica ufficiale (nessuna sessione, nessuna toleration)

File statici per-universo con dato aperto (giocatori, classifiche, universo, server).

```
https://<sX-XX>.ogame.gameforge.com/api/<file>?toJson=1      # oppure .xml
```

| File | Contiene | Cadenza |
|---|---|---|
| `players.xml` | id↔nome, stato (inactive / vacation / banned) | ~oraria |
| `universe.xml` | tutti i pianeti: id, nome, coord, playerId, luna | ~oraria |
| `highscore.xml` | classifica per tipo (generale / eco / ricerca / flotta / difesa) | ~oraria |
| `alliances.xml` | alleanze e membri | ~giornaliera |
| `playerData.xml` | dettaglio di un giocatore (pianeti + lune + punteggi) | on-demand |
| `serverData.xml` | costanti universo (velocità, campo detriti, ...) | ~settimanale |
| `localization.xml` | nomi tech/missioni localizzati | ~settimanale |
| `universes.xml` | mappatura universi | rara |
| `https://lobby.ogame.gameforge.com/api/servers` | lista server lobby | rara |

**Conformità:**
- **§6 — instradare via proxy comunità** `https://ogapi.faw-kes.de/` (nessuna chiave privata richiesta).
- **§6 — cache OBBLIGATORIA, niente polling:** aggiornano a intervalli fissi (ora → settimana), rispettali.
- **§5 — toleration:** una feature che usa **solo** questi dati (o dati incollati a mano) NON richiede
  toleration. Appena si aggiunge scraping dal gioco, serve.

---

## Livello 2 — Endpoint report / statistiche (proxy + stringa API del report)

Rapporti spionaggio / battaglia / espedizione: si aprono con la **stringa API** del report (pulsante
"API" in gioco) passata al proxy o al simulatore. PrOGect lo fa già (es. `genTrashsimLink`).

**Conformità §6:** via proxy (o, per eccezione, chiave privata riservata a pochi tool); non inventare
endpoint o credenziali.

---

## Livello 3 — Endpoint in-game AJAX (sessione autenticata, same-origin)

I dati ricchi/live. Chiamate `fetch` con `credentials:'include'` e header
`X-Requested-With: XMLHttpRequest`. Sono quelli che PrOGect **già usa** su v13.

| Endpoint (`index.php?...`) | Dà | Vincolo al punto d'uso |
|---|---|---|
| `page=componentOnly&component=externaldataexport&action=accountInfo` | **la fonte più ricca**: pianeti/lune, produzione oraria reale, edifici/navi/difese, ufficiali, ricerche, buff item, species | **§4.1: leggere UNA volta, MAI in polling** (rinfresca l'highscore di tutto = segnala che sei online). Filtrare client-side. Propagare `newAjaxToken`. |
| `...externaldataexport&action=speciesBonuses` | bonus Forme di Vita (frazioni; ×100 per %) | come sopra; capability-probe 1×/sessione |
| `...externaldataexport&action=technologyQuantities` | quantità tech del **pianeta attivo** | come sopra |
| `...externaldataexport&action=importExportInfo` | offerta del giorno | come sopra |
| `page=componentOnly&component=eventList&action=fetchEventBox` | movimenti flotta in arrivo/uscita | **§1.3/§4: solo su apertura popup / page-load, mai a timer** |
| `page=ingame&component=movement` | pagina movimenti flotta | idem |
| `component=galaxy&action=fetchSolarSystemData` (ex `fetchGalaxyContent`) | contenuto sistema (galassia) | on page-load / interazione utente; **mai loop** |
| `page=standalone&component=empire` | vista impero (campi/temperature che l'API non espone) | on-demand |
| `page=ajax&component=lfbonuses` (fallback `standalone`) | bonus LF (pagina) | on page-load / azione utente |
| `page=ajax&component=productionqueue` | coda di produzione | on page-load / azione utente |
| `component=facilities` / `messages` / `messagedetails` / `repairlayer` / `jumpgate` / `traderOverview` | strutture / messaggi / dettaglio / riparazioni / salto / mercante | on page-load / azione utente |

**Vincoli trasversali (validi per TUTTO il Livello 3):**
- **§4.2 — MAI `cp=<planetId>` in una chiamata di background.** Cambia il pianeta attivo della
  sessione (mutazione di stato). Per dati cross-pianeta usare `accountInfo` (li contiene tutti) e filtrare.
- **§1.3 / §4 — le chiamate di background partono SOLO al page-load,** mai su timer/loop/auto-refresh,
  mai in continuo. Ogni chiamata genera **attività** visibile in galassia.
- **§1.1 — 1 click = 1 azione** per tutto ciò che *agisce* (invii, ordini).
- **§1.5.1 — niente probe diretto** attaccato a coordinate/liste custom: i nuovi bersagli passano dal
  flusso galassia nativo (probe diretto OK solo da report inbox / galassia).
- **§5 — toleration richiesta:** leggere dati live dal gioco è il caso del tool → va sottoposto a review.

---

## Inventario data-layer (dati GIÀ idratati — la chiave del "senza appesantire")

Prima di fetchare, controlla qui: nel ~90% dei casi il dato c'è già.

### `ogl.db.*` — stato persistito (GM storage)

| Chiave | Contiene | Abilita (a costo zero) |
|---|---|---|
| **`myPlanets`** | per pianeta/luna: coord, nome, livelli edifici/navi/difese/ricerche per ID, risorse live, produzione oraria, storage, temperatura, campo | overview impero, calcoli produzione/valore flotta, planner build |
| `serverData` | costanti universo (velocità, campo detriti, ...) | qualsiasi calcolo legato alle regole server |
| `lfBonuses` | bonus Forme di Vita già parsati (frazioni) | calcoli LF-aware |
| `udb` / `pdb` / `tdb` | DB universo / giocatori / target taggati | liste bersagli, ranking, attività (view-only) |
| `stats` | statistiche spedizioni/raid | recap, grafici, medie |
| `fleetLimiter`, `previousFleet`, `shipsCapacity`, `keepEnoughCapacityShip` | helper flotta | preset invii, limiti, "tieni cargo" |
| `browserNotificationList` | notifiche per-evento scelte dal player | promemoria conformi (§1.4) |
| `activeItems`, `nextImportExport` | item attivi, offerta del giorno | timer buff, avvisi offerta |
| `tags`, `quickRaidList`, `spytableFilters` | organizzazione target/report | liste e filtri custom (view-only) |
| `options`, `configState`, `dataFormat`, `userLang` | preferenze | UI / impostazioni |

### `ogl.cache.*` — dati vivi in memoria (sessione corrente)

| Chiave | Contiene | Nota |
|---|---|---|
| **`movements`** | flotte in volo (da eventList/DOM), per coord | base per ogni feature sui movimenti; già usato per indicatori attacco/detriti |
| `reports`, `raids`, `counterSpies` | working set spionaggio/raid | tabella spionaggio, auto-clean |
| `toSend` | selezione invii correnti | flusso invio flotta |
| `ptreLogs` | dati PTRE | integrazione PTRE |

---

## Regola operativa (come aggiungere una feature "leggera")

Nell'ordine:

1. **Il dato è già in `ogl.db` / `ogl.cache` o nel DOM della pagina aperta?**
   Leggere il DOM aperto NON è una chiamata di background e NON aggiunge attività. → calcola e mostra, fine.
2. **Idrata una volta al login,** poi tieni lo stato aggiornato leggendo il DOM mentre il player naviga.
3. **Dati esterni / altri giocatori → API pubblica (Livello 1)** via proxy, con cache che rispetta la cadenza.
4. **Riusa l'infra esistente** (`ogl._fetch`, `ogl.cache`, `ogl.db.myPlanets`, capability-probe di
   `externaldataexport`) invece di introdurre nuovi fetch/timer.
5. **Deve agire sul gioco?** 1 click = 1 azione, flusso UI nativo.

## Checklist prima di aggiungere una feature che tocca dati

- [ ] Il dato è già idratato (`db`/`cache`/DOM)? Se sì, nessun fetch.
- [ ] Se serve un fetch: parte solo al **page-load/login**? Nessun timer/loop/auto-refresh (§1.3/§4).
- [ ] Nessun `cp=` in chiamate di background (§4.2). Nessun polling di `accountInfo` (§4.1).
- [ ] Nessun probe diretto su liste/coordinate custom (§1.5.1).
- [ ] Nessuna azione multipla da 1 click (§1.1); nessuna azione schedulata (§1.2).
- [ ] Se esce dato dalla macchina o si scrapa il gioco: toleration da sottoporre (§5).
- [ ] Chiamate API pubbliche via proxy e **in cache** (§6).
