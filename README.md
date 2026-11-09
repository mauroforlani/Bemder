# Hub

Quattro strumenti in un unico sito, con una home da cui scegliere:

| Sezione | Cartella | Contenuto |
|---|---|---|
| Astrofotografia | `astrofoto/` | catalogo oggetti, planetario, meteo |
| Attività | `attivita/` | escursioni, motogiri, punti di interesse, gare, registro |
| Budget | `budget/` | finanze personali e portafoglio titoli |
| Running | `running/` | allenamenti e analisi dello stato di forma |

`assets/` contiene la barra di navigazione comune (`hub.js`), gli stili condivisi (`hub.css`) e la configurazione (`config.js`).

## Pubblicazione
Attiva GitHub Pages sul branch `main` (cartella radice). Il repository viene rilevato dall'indirizzo del sito;
se usi un dominio personalizzato modifica il ripiego in `assets/config.js`.

## Salvataggio su GitHub
Ogni sezione continua a salvare i propri dati nel repository, ora nelle rispettive cartelle:
`astrofoto/data.json` e `astrofoto/img/`, `attivita/data/luoghi.json` e `attivita/images/`,
`budget/data.json`, `running/data/runai-state.json`.
Le impostazioni GitHub già salvate nel browser con i vecchi repository vengono adattate automaticamente
(i token restano quelli che avevi inserito).

## Immagini Astrofoto
Azione manuale *Download Astro Images* (scheda Actions).
