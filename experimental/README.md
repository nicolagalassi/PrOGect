# experimental/

Script **standalone di prova**, esterni a PrOGect. Non fanno parte del companion tool
e **non seguono le linee guida di OGame**: automatizzano il gameplay e servono solo a
studiare/capire alcune dinamiche del gioco in autonomia.

## discovery-bot.user.js — DiscoBot V16 (v13-compat)

Bot che percorre i sistemi a spirale attorno a un centro e invia missioni Discovery,
gestendo gli slot flotta. Evoluzione della V15 (che girava su OGame v12), adattata a **v13**.

### Cosa è stato sistemato rispetto alla V15

1. **Refresh dopo la scadenza del timer.**
   Prima, quando gli slot erano pieni, il bot impostava un timer e restava sulla stessa
   pagina; alla scadenza azzerava il timer e **rileggeva un DOM stale** (slot ancora
   "pieni"), quindi non ripartiva. Ora alla scadenza **ricarica davvero la pagina**
   (`location.reload()`), così `#slotUsed` e la lista eventi tornano freschi.

2. **Controllo slot corretto.**
   Su v13 la Discovery è una chiamata **AJAX** (`sendSystemDiscoveryFleet` /
   `sendDiscoveryFleet`) e il contatore slot nel DOM si aggiorna in modo asincrono:
   leggerlo subito dopo il click era inaffidabile, così come il parsing di
   `#fleetstatusrow`. Ora il bot **intercetta la risposta AJAX** (XHR + fetch) e usa
   `response.success` e `response.slots` (slot usati, valore autorevole) per decidere se
   restare (completionist) o avanzare nella spirale.

3. **Selettori con fallback v13** per parsing pianeti, input sistema, pulsante discovery,
   slot ed eventi (id/classi possono essere rinominati tra le versioni del gioco).

### Uso

Installa il file in Tampermonkey. Nell'HUD in alto a destra:
- scegli il pianeta/luna di **partenza** (centro spirale),
- eventualmente premi **Reset ↻** per fissare il sistema corrente come centro,
- premi **AVVIA**.

I selettori sono configurabili in cima al file (oggetto `SEL`) se il tuo universo usa id diversi.
