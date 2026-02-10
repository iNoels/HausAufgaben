# HausAufgaben

WebApp zur Anzeige und Pflege von Aufgaben rund ums Grundstück.

Die Anwendung basiert auf Next.js (App Router), liest Aufgaben aus `data/tasks/*.ics` und ergänzt diese mit Stammdaten aus `data/config/StammDaten.json`.

## Features

- Aufgabenliste mit fixer Sortierung nach Fälligkeit (aufsteigend)
- Filterung nach Verantwortlich
- Bearbeiten von Unteraufgaben (Status + Hinweis)
- API-Endpunkte für Aufgaben und Unteraufgaben
- Healthcheck-Endpunkt für Containerbetrieb (`/health`)

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- ESLint

## Projektstruktur

```text
app/
  api/tasks/...              # Task-API
  health/route.ts            # Healthcheck: "I am healthy"
  page.tsx                   # Haupt-UI
data/
  config/StammDaten.json     # Stammdaten
  tasks/*.ics                # Aufgabenquellen
lib/
  Tasks.ts                   # ICS Parsing/Update
  StammDaten.ts              # Stammdaten-Zugriff
Dockerfile
docker-entrypoint.sh
```

## Lokale Entwicklung

Voraussetzungen:

- Node.js 22+
- npm

Start:

```bash
npm ci
npm run dev
```

Dann im Browser öffnen:

`http://localhost:3000`

Nützliche Scripts:

```bash
npm run lint
npm run build
npm run start
```

## API

- `GET /api/tasks`
  - liefert alle Aufgaben inkl. Stammdatenbezug
- `PATCH /api/tasks/:uid/subtasks/:index`
  - aktualisiert Unteraufgabenstatus oder Hinweis
- `GET /health`
  - Antwort: `I am healthy`

## Docker

Die App wird vollständig im Container gebaut (`npm ci`, `npm run build`) und als Multi-Stage-Image ausgeliefert.

Build:

```bash
docker build -t hausaufgaben:local .
```

Run:

```bash
docker run --rm -p 3000:3000 \
  -e UID=1000 \
  -e GID=1000 \
  -e TZ=Europe/Berlin \
  hausaufgaben:local
```

Konfigurierbare Umgebungsvariablen im Container:

- `UID` (Default: `1000`)
- `GID` (Default: `1000`)
- `TZ` (Default: `Europe/Berlin`)

Der Container enthält einen nativen Healthcheck gegen `http://127.0.0.1:3000/health`.

## GitHub Actions: Docker Build & Publish

Workflow-Datei:

- `.github/workflows/docker-build-publish.yml`

Verhalten:

- Pull Requests auf `main`: Docker-Build (ohne Push)
- Push auf `main` und `v*`-Tags: Build + Push auf Docker Hub

Benötigte GitHub Secrets:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

Optionale GitHub Variable:

- `IMAGE_NAME`  
  Wenn nicht gesetzt, wird automatisch `${{ github.repository }}` verwendet.

## Hinweise zum Betrieb

- Aufgaben werden aus den `.ics`-Dateien im Verzeichnis `data/tasks/` gelesen.
- Änderungen an Unteraufgaben werden in den jeweiligen `.ics`-Dateien gespeichert.
- Für reproduzierbare Container-Builds sind Alpine-Pakete im `Dockerfile` auf feste Versionen gepinnt.
