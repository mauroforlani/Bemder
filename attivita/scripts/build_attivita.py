#!/usr/bin/env python3
"""Converte Attivita_unificate.xlsx in data/attivita.js e data/attivita.json (usati da registro.html).

Uso:  python3 scripts/build_attivita.py [percorso/Attivita_unificate.xlsx]
Per aggiornare il registro: aggiungi righe all'Excel, rilancia lo script, fai commit di data/attivita.json.
"""
import json, sys, math
from pathlib import Path
import pandas as pd

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("Attivita_unificate.xlsx")
OUT = Path(__file__).resolve().parent.parent / "data" / "attivita.json"

REGIONE = {
    "BG": "Lombardia", "LC": "Lombardia", "CO": "Lombardia", "SO": "Lombardia", "BS": "Lombardia",
    "MI": "Lombardia", "VA": "Lombardia", "AO": "Valle d'Aosta",
    "VB": "Piemonte", "TO": "Piemonte", "CN": "Piemonte", "VC": "Piemonte",
    "TN": "Trentino-Alto Adige", "BZ": "Trentino-Alto Adige", "BL": "Veneto",
    "LU": "Toscana", "PN": "Friuli-Venezia Giulia", "UD": "Friuli-Venezia Giulia",
}

def secs(v):
    if v is None or (isinstance(v, float) and math.isnan(v)): return None
    h, m, s = (int(x) for x in str(v).split(":"))
    return h * 3600 + m * 60 + s

def num(v, nd=None):
    if v is None or (isinstance(v, float) and math.isnan(v)): return None
    return round(float(v), nd) if nd is not None else int(round(float(v)))

def sigla(area):
    if "(" in area and area.endswith(")"):
        return area[area.rfind("(") + 1:-1]
    return None

df = pd.read_excel(SRC)
rows = []
for i, r in df.iterrows():
    area = str(r["Provincia / Regione"]).strip()
    stato = str(r["Stato"]).strip()
    sg = sigla(area) if stato == "Italia" else None
    if stato == "Italia":
        regione = REGIONE.get(sg, "Altro")
    elif area == "SO / Grigioni":
        regione = "Lombardia / Grigioni"
    else:
        regione = area
    nome_area = area.rsplit(" (", 1)[0] if sg else area
    km = num(r["Distanza (km)"], 2)
    mov = secs(r["Moving Time"])
    tot = secs(r["Tempo"])
    rows.append({
        "id": i + 1,
        "d": r["Data"].strftime("%Y-%m-%d"),
        "h": str(r["Ora"])[:5],
        "tipo": "Trail Running" if r["Tipo attività"] == "Trail Running" else "Escursione",
        "t": str(r["Titolo"]).strip(),
        "stato": stato,
        "reg": regione,
        "prov": nome_area,
        "sg": sg,
        "km": km,
        "dp": num(r["Dislivello positivo (m)"]),
        "dn": num(r["Dislivello negativo (m)"]),
        "tot": tot,
        "mov": mov,
        "qmin": num(r["Min Elevation"]),
        "qmax": num(r["Max Elevation"]),
        "hr": num(r["Avg HR"]),
        "hrmax": num(r["Max HR"]),
        "cal": num(r["Calories"]),
        "tmin": num(r["Min Temp"]),
        "tmax": num(r["Max Temp"]),
        "passi": num(r["Steps"]),
        "te": num(r["Aerobic TE"], 1),
        "multi": bool(tot and mov and tot > 12 * 3600 and tot > 2 * mov),
        "verif": bool(pd.notna(r["Da verificare"]) and str(r["Da verificare"]).strip()),
    })

rows.sort(key=lambda x: (x["d"], x["h"]))
for n, x in enumerate(rows, 1): x["id"] = n
OUT.parent.mkdir(exist_ok=True)
OUT.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
OUT.with_suffix(".js").write_text("window.ATTIVITA="+json.dumps(rows, ensure_ascii=False, separators=(",", ":"))+";", encoding="utf-8")
print(f"{len(rows)} attività -> {OUT} ({OUT.stat().st_size/1024:.0f} KB)")
