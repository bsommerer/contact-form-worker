# Contact Form Worker

Ein wiederverwendbarer Cloudflare Worker, der Kontaktformular-Submissions empfängt, validiert und per HTML-E-Mail über die [Resend API](https://resend.com) versendet. **GitOps-first**: Eine Website hinzufügen heißt _eine JSON-Datei committen_ — kein Code-Anfassen, kein manuelles Deployment, und Cloudflare-Turnstile-Widgets werden automatisch angelegt.

Ein Worker bedient beliebig viele Websites (Routing über `formId`). Dieses Repo ist die **Engine** (Open Source). Die eigentliche Konfiguration (welche Formulare, welche Empfänger) lebt in einem separaten **Config-Repo**, das diese Engine versioniert konsumiert.

## Zwei Wege, das zu nutzen

| Weg | Für wen | Wie |
|-----|---------|-----|
| **Self-Serve** | Du willst es selbst auf deinem eigenen Cloudflare-Konto betreiben | „Use this template" → eigenes Repo, eigene `forms/`, eigene Secrets, `wrangler deploy` |
| **Managed / GitOps** | Ein Betreiber stellt es als Service bereit | Separates (privates) Config-Repo hält nur `forms/*.json` und ruft die reusable Workflows dieser Engine auf |

## Architektur

```
forms/<id>.json  ──►  npm run generate  ──►  src/forms.generated.ts  ──►  Worker
   (Daten)              (Validierung)          (Build-Artefakt)
```

Formular-Konfiguration ist **Daten, kein Code**. `npm run generate` liest alle `forms/*.json`, validiert sie und erzeugt `src/forms.generated.ts`. Der Schritt läuft automatisch vor `dev`, `test`, `typecheck` und `deploy`. Eine ungültige Datei bricht den Build (und damit jeden PR) ab.

## Endpoints

| Methode & Pfad | Zweck | Öffentlich |
|----------------|-------|-----------|
| `POST /` | Formular-Submission entgegennehmen & Mail versenden | CORS: nur `allowedOrigins` + localhost |
| `GET /config/<formId>` | `{ formId, turnstile, sitekey }` — Turnstile-Sitekey fürs Frontend | ja (`*`) |
| `GET /snippet/<formId>` | Fertiges HTML+JS-Snippet zum Einbinden (Standard-Kontaktformular) | ja (`*`) |

`GET /config` und `GET /snippet` geben nur den **öffentlichen** Sitekey aus (der ohnehin im Frontend steht) — nie das Secret.

### `GET /config/<formId>`

```bash
curl https://<worker>/config/meine-website
# { "formId": "meine-website", "turnstile": true, "sitekey": "0x4AAA…" }
```

Ideal, um im **Frontend-Build/CI** den aktuellen Sitekey zu ziehen, statt ihn zu hardcoden.

### `GET /snippet/<formId>`

Liefert ein copy-paste-fertiges Snippet (inkl. Turnstile-Widget + Token-Handling, falls aktiv):

```bash
curl https://<worker>/snippet/meine-website
```

## Neues Formular hinzufügen

Eine Datei `forms/<formId>.json` anlegen. Der Dateiname _ist_ die `formId` (nur `a-z`, `0-9`, Bindestrich):

```json
{
  "recipients": ["info@meine-website.de"],
  "fromName": "Meine Website",
  "fromAddress": "noreply@meine-domain.de",
  "allowedOrigins": ["https://meine-website.de"],
  "headerTitle": "Neue Kontaktanfrage",
  "defaultSubject": "Neue Kontaktanfrage",
  "turnstile": true
}
```

Committen & pushen (bzw. PR). Fertig — kein Code-Change, und bei `turnstile: true` wird das Widget automatisch angelegt (siehe [Turnstile](#turnstile-automatisiert)).

### Felder

| Feld | Pflicht | Beschreibung |
|------|---------|-------------|
| `recipients` | Ja | Empfänger-Adressen (Array, ≥ 1, gültige E-Mails) |
| `fromName` | Ja | Anzeigename des Absenders |
| `fromAddress` | Ja¹ | Absende-Adresse (muss bei Resend verifiziert sein) |
| `allowedOrigins` | Ja | Erlaubte CORS-Origins (Array, `http(s)://…`) — nur Produktions-/Staging-Domains; **localhost muss nicht eingetragen werden** |
| `headerTitle` | Nein | Überschrift in der E-Mail (Default: „Neue Nachricht") |
| `defaultSubject` | Nein | Betreff-Fallback, wenn der Client keinen schickt |
| `turnstile` | Nein | `true` → Cloudflare-Turnstile-Token wird geprüft (Default `false`) |

¹ `fromAddress` kann auch zentral in `forms/_defaults.json` gesetzt werden.

### Gemeinsame Defaults

Eine optionale `forms/_defaults.json` wird _unter_ jedes Formular gemischt:

```json
{ "fromAddress": "noreply@meine-domain.de" }
```

### Localhost / lokale Entwicklung

Jeder **localhost**-Origin (`localhost`, `127.0.0.1`, `[::1]` — beliebiger Port, http/https) ist **immer** erlaubt, unabhängig von `allowedOrigins`. In `allowedOrigins` gehören nur echte Produktions-/Staging-Domains.

## Turnstile (automatisiert)

Bei `turnstile: true` legt der Deploy-Workflow automatisch ein **managed Widget** (`cfcf:<formId>`) in Cloudflare an, dessen **Domains aus `allowedOrigins`** abgeleitet werden. Sitekey und Secret kommen dabei direkt aus Cloudflare:

- **Secret** → wird als `TURNSTILE_SECRETS`-Map (JSON `formId → secret`) an den Worker gepusht. Es liegt **nie** in Git oder GitHub und wird in den Logs maskiert.
- **Sitekey** (öffentlich) → wird als `TURNSTILE_SITEKEYS`-Map an den Worker gepusht und über `GET /config/<formId>` ausgeliefert.

Du pflegst also **keine Turnstile-Secrets mehr manuell**. Ein bestehendes, händisch angelegtes Widget wird — wenn seine Domains zum Formular passen — automatisch _übernommen_ (umbenannt auf `cfcf:<formId>`), ohne Keys zu ändern. Details im Config-Repo.

## Die API richtig nutzen (Frontend)

Am einfachsten: `GET /snippet/<formId>` abrufen und einbinden. Wer selbst baut:

### Modus 1 — Standard-Kontaktformular

`POST /` mit flachem JSON:

```js
await fetch('https://<worker>/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    formId: 'meine-website',
    name: 'Max Mustermann',
    email: 'max@example.com',
    phone: '+49 123 456789',   // optional
    message: 'Hallo!',
    turnstileToken: '<cf-turnstile-response>', // wenn turnstile:true
    website: '',               // Honeypot: muss leer bleiben
  }),
})
```

`reply_to` der Mail wird automatisch auf `email` gesetzt.

| Feld | Pflicht | Hinweis |
|------|---------|---------|
| `formId` | Ja | ID = Dateiname aus `forms/` |
| `name`, `email`, `message` | Ja | |
| `phone` | Nein | |
| `turnstileToken` | wenn `turnstile:true` | Wert des Turnstile-Widgets |
| `website` | — | Honeypot, leer lassen |

### Modus 2 — Custom Fields

Für beliebige Felder statt des Standardformulars:

```js
body: JSON.stringify({
  formId: 'meine-website',
  subject: 'Neue Bestellung #4711',
  replyTo: 'kunde@example.com',
  turnstileToken: '…',
  fields: [
    { label: 'Bestellnummer', value: '#4711', type: 'text' },
    { label: 'Newsletter', value: true, type: 'boolean' },
  ],
})
```

Feld-Typen: `text`, `email`, `phone`, `url`, `textarea`, `boolean`.

### Turnstile im Frontend

1. Widget-Script laden: `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
2. Widget platzieren: `<div class="cf-turnstile" data-sitekey="<sitekey>"></div>` — den Sitekey per `GET /config/<formId>` holen.
3. Beim Submit den von Turnstile erzeugten Wert (`cf-turnstile-response`) als `turnstileToken` mitschicken.

### Antworten

| Status | Bedeutung |
|--------|-----------|
| `200 {success:true}` | versendet (bzw. Honeypot ausgelöst) |
| `400` | Pflichtfelder fehlen / ungültiges JSON |
| `403` | Origin nicht erlaubt **oder** Turnstile fehlgeschlagen |
| `404` | unbekannte `formId` |
| `500` | Konfig-/Serverfehler |

## Setup

### Resend

1. Account bei [resend.com](https://resend.com) anlegen.
2. **Domain verifizieren** (Domains → Add Domain, DNS-Records setzen). Nur von einer verifizierten Domain darf gesendet werden — die `fromAddress` muss dazu passen (z.B. `noreply@meine-domain.de`).
3. **API-Key** erstellen (API Keys → Create). Berechtigung **Sending access** genügt. Das ist der `RESEND_API_KEY`.

### Cloudflare

- **Worker:** ein Cloudflare-Account genügt; der Worker läuft auf `*.workers.dev` (oder eigene Route).
- **API-Token** (My Profile → API Tokens → Create Token, „Custom Token") mit diesen Berechtigungen:
  - `Account › Workers Scripts › Edit` (Deploy + Secrets)
  - `Account › Turnstile › Edit` (Widgets automatisch anlegen/verwalten)
  - `Account › Account Settings › Read` (Account-ID auto-erkennen)

  Das ist der `CLOUDFLARE_API_TOKEN`. Optional die **Account-ID** als `CLOUDFLARE_ACCOUNT_ID` hinterlegen (nötig, wenn der Token mehrere Accounts sieht).
- **Turnstile:** Widgets werden automatisch erzeugt — du musst im Dashboard nichts vorbereiten.

## Worker-Secrets (Runtime)

| Secret | Inhalt | Quelle |
|--------|--------|--------|
| `RESEND_API_KEY` | Resend API-Key | GitHub Actions Secret |
| `TURNSTILE_SECRETS` | JSON-Map `formId → secret` | **automatisch** aus Cloudflare (Reconcile) |
| `TURNSTILE_SITEKEYS` | JSON-Map `formId → sitekey` (öffentlich) | **automatisch** aus Cloudflare (Reconcile) |

Lokal via `.dev.vars` (siehe `.dev.vars.example`).

## Self-Serve Setup

```bash
# 1. Repo aus Template erzeugen ("Use this template")
npm install
# 2. Eigene Formulare in forms/ anlegen (example.json ersetzen)
npm run dev                 # lokal testen
# 3. Secrets setzen und deployen
npm run deploy
```

## Als Service betreiben (GitOps)

Reusable Workflows, die ein separates Config-Repo aufruft:

- `deploy.yml` — reconciled Turnstile-Widgets, testet, deployt, synchronisiert Secrets & Sitekeys.
- `validate.yml` — kompiliert & testet die Formulare bei jedem PR (deployt nicht).
- `reconcile-dryrun.yml` — zeigt den Turnstile-Reconcile-Plan, ohne etwas zu verändern.

Das Config-Repo enthält **keinen Code** — nur `forms/*.json` und dünne Workflow-Dateien, die per `uses:` auf diese Engine zeigen.

## Entwicklung

```bash
npm run generate    # forms/*.json → src/forms.generated.ts
npm run dev         # lokaler Worker
npm test            # Vitest (Worker + Snippet + Reconcile-/Validierungs-Logik)
npm run typecheck   # tsc --noEmit
```

## Warum GitOps?

- **Neue Website = ein PR mit einer Datei.** Reviewbar, auditierbar, per Git-History nachvollziehbar.
- **Validierung im CI** verhindert kaputte Config, bevor sie live geht.
- **Secrets nie im Repo** — Turnstile-Secrets kommen automatisch aus Cloudflare, `RESEND_API_KEY` aus GitHub Actions Secrets.
- **Engine und Config sauber getrennt** — die Engine bleibt generisch und open source, Kundendaten liegen isoliert im (privaten) Config-Repo.
