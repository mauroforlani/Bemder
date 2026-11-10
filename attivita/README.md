# Registro attività

Sezione separata del sito, indipendente da `data/luoghi.json` e dall'app principale.

- `registro/index.html` – pagina (filtri, statistiche, vista per provincia, elenco, record)
- `attivita/data/attivita.json` – dati generati dall'Excel
- `attivita/scripts/build_attivita.py` – converte `Attivita_unificate.xlsx` in `attivita/data/attivita.json`

## Aggiornare i dati
1. Aggiungi le nuove righe a `Attivita_unificate.xlsx` (stesse colonne).
2. `pip install pandas openpyxl` (una sola volta)
3. `python3 attivita/scripts/build_attivita.py percorso/Attivita_unificate.xlsx`
4. Commit di `attivita/data/attivita.json`.

Note: "Tempo" nel foglio è il tempo totale (include le soste); le statistiche usano il
"Moving Time". Le regioni italiane sono ricavate dalla sigla della provincia.
