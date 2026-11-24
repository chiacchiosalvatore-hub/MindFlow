# Sicurezza — MindFlow Companion

## Versioni supportate

| Versione | Supporto |
| --- | --- |
| 1.2.x | sì (versione corrente di sviluppo) |
| < 1.2 | no |

## Segnalare una vulnerabilità

Non aprire **issue pubbliche** per problemi di sicurezza: potrebbero esporre
dettagli sfruttabili prima che sia disponibile una correzione.

Usa il canale privato di GitHub:

1. scheda **Security** del repository → **Report a vulnerability**;
2. in alternativa, una issue pubblica senza dettagli tecnici («contatto per
   segnalazione di sicurezza») e ci mettiamo d'accordo in privato.

Cosa è utile includere: versione, passi per riprodurre, impatto stimato,
eventuale PoC. Risposta mirata entro pochi giorni; non c'è un SLA garantito
(progetto open source a cura di DevourLabs).

## Perimetro di sicurezza del progetto

MindFlow è progettato per non avere backend e non esfiltrare dati:

- nessuna telemetria, nessun server dell'autore, nessun analytics;
- le chiavi API eventualmente configurate dall'utente vivono solo in
  `chrome.storage.local` (mai in `sync`, mai nel codice);
- le richieste di completamento partono solo verso l'endpoint configurato
  dall'utente (motori locali come Ollama/LM Studio, oppure le API cloud che
  l'utente sceglie con la propria chiave);
- la cattura di rete (`net-capture.js`) legge una **copia read-only** degli
  stream delle chat osservate e non modifica richieste né risposte.

L'audit statico completo è in [`docs/AUDIT-SICUREZZA.md`](docs/AUDIT-SICUREZZA.md).

## Ambiente di test responsabile

Sono benvenuti test su cloni locali dell'estensione. Non testare contro
account/chat di terzi senza autorizzazione: l'estensione opera sul contenuto
della pagina dell'utente che la installa, non va usata per profilare altri.
