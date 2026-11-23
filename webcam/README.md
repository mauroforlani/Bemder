# Webcam

Elenco di webcam di montagna con filtri Stato › regione › provincia, ricerca, aggiornamento automatico delle immagini,
schermo intero e incorporamento di iframe.

- I dati sono in `webcams.json` (campi: `name`, `place`, `country`, `region`, `province`, `image`, `embed`, `page`, `source`).
- La pagina legge l'elenco da GitHub (ripiego: file del sito). Il repository e il file (`webcam/webcams.json`) sono quelli del sito.
- **Aggiungi / Modifica / Elimina** funzionano nel browser; con il token GitHub (lo stesso delle altre sezioni, oppure quello del pulsante *GitHub*)
  le modifiche si salvano da sole nel repository. Senza token la pagina avvisa che le modifiche sono solo su quel dispositivo.
- **Esporta JSON** scarica l'elenco completo.
