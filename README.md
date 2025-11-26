# Longest Direct Regional Trains (DE)

FastAPI-Service, der für einen Startbahnhof die längsten durchgehenden Regionalzugverbindungen (RE/RB/S) ohne Umstieg findet. Datenquelle: https://v6.db.transport.rest
Zusätzlich gibt es eine statische GitHub-Pages-Demo (reiner Browser-Client),
die direkt die öffentliche API nutzt.

## Features
- Endpoint `GET /longest-direct`
- Parameter: `station` (Pflicht), `limit` (Standard 10), `duration` (Minutenfenster, Standard 240), `when` (ISO-Zeit, optional)
- Nutzt `/stations`, `/stops/{id}/departures` und `/trips/{tripId}` und fasst Verbindungen nach Linie/Richtung/Ziel zusammen
- Filtert auf Nahverkehr (RE/RB/S), sortiert nach Fahrzeit absteigend

## Projektstruktur
```
app/
  main.py
Dockerfile
requirements.txt
README.md
```

## Lokaler Start
```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Docker
```bash
docker build -t longest-direct-trains .
docker run --rm -p 8000:8000 longest-direct-trains
```

## Beispielaufruf
```bash
curl 'http://localhost:8000/longest-direct?station=Koblenz%20Hbf&limit=5&duration=360'
```
Optional: `when=2025-11-29T08:00:00+01:00`

## GitHub Pages Demo (statische Client-App)

Unter `docs/` liegt eine kleine HTML/JS-Oberfläche, die denselben Ablauf wie
der FastAPI-Endpunkt direkt im Browser ausführt (Stationsauflösung, gefilterte
Abfahrten, Trips laden, deduplizieren, nach Fahrzeit sortieren).

So aktivierst du GitHub Pages (Branch `work`, Ordner `docs`):

1. GitHub → Repository → Settings → Pages.
2. Source: „Deploy from a branch“ → Branch: `work` → Folder: `/docs` → Save.
3. Warten, bis Pages baut und veröffentlicht. Die Demo ist dann unter
   `https://<owner>.github.io/<repo>/` erreichbar.

Lokal testen ohne Pages:

```bash
cd docs
python -m http.server 8001
# Dann im Browser http://localhost:8001 öffnen
```

## Hinweise
- Das Zeitfenster ist begrenzt (Standard 4 h) und wird über `duration` gesteuert.
- Nur Nahverkehrsprodukte werden berücksichtigt.
- Die API ist öffentlich, benötigt keinen Schlüssel und kann Verfügbarkeitslimits haben.
