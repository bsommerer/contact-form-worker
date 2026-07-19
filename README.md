# Contact Form Worker

Ein wiederverwendbarer Cloudflare Worker, der Kontaktformular-Submissions empfängt, validiert und per HTML-E-Mail über die [Resend API](https://resend.com) versendet. **GitOps-first**: Eine Website hinzufügen heißt _eine JSON-Datei committen_ — kein Code-Anfassen, kein manuelles Deployment.

Ein Worker bedient beliebig viele Websites (Routing über `formId`). Dieses Repo ist die **Engine** (Open Source). Die eigentliche Konfiguration (welche Formulare, welche Empfänger) lebt in einem separaten **Config-Repo**, das diese Engine versioniert konsumiert.

## Zwei Wege, das zu nutzen

| Weg | Für wen | Wie |
|-----|---------|-----|
| **Self-Serve** | Du willst es selbst auf deinem eigenen Cloudflare-Konto betreiben | „Use this template" → eigenes Repo, eigene `forms/`, eigene Secrets, `wrangler deploy` |
| **Managed / GitOps** | Ein Betreiber stellt es als Service bereit | Separates (privates) Config-Repo hält nur `forms/*.json` und ruft die reusable Deploy-Workflow dieser Engine auf |

> Der Managed-Aufbau ist unten unter [Als Service betreiben](#als-service-betreiben-gitops) beschrieben.

## Architektur

```
forms/<id>.json  ──►  npm run generate  ──►  src/forms.generated.ts  ──►  Worker
   (Daten)              (Validierung)          (Build-Artefakt)
```

Formular-Konfiguration ist **Daten, kein Code**. `npm run generate` liest alle `forms/*.json`, validiert sie und erzeugt `src/forms.generated.ts`. Der Schritt läuft automatisch vor `dev`, `test`, `typecheck` und `deploy`. Eine ungültige Datei bricht den Build (und damit jeden PR) ab.

## Neues Formular hinzufügen

1. Eine Datei `forms/<formId>.json` anlegen. Der Dateiname _ist_ die `formId` (nur `a-z`, `0-9`, Bindestrich):

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

2. Committen & pushen (bzw. PR). Fertig — kein Code-Change nötig.

### Felder

| Feld | Pflicht | Beschreibung |
|------|---------|-------------|
| `recipients` | Ja | Empfänger-Adressen (Array, ≥ 1, gültige E-Mails) |
| `fromName` | Ja | Anzeigename des Absenders |
| `fromAddress` | Ja¹ | Absende-Adresse (muss bei Resend verifiziert sein) |
| `allowedOrigins` | Ja | Erlaubte CORS-Origins (Array, `http(s)://…`) — nur Produktions-/Staging-Domains; **localhost muss nicht eingetragen werden** (siehe unten) |
| `headerTitle` | Nein | Überschrift in der E-Mail (Default: „Neue Nachricht") |
| `defaultSubject` | Nein | Betreff-Fallback, wenn der Client keinen schickt |
| `turnstile` | Nein | `true` → Cloudflare-Turnstile-Token wird geprüft (Default `false`) |

¹ `fromAddress` kann auch zentral in `forms/_defaults.json` gesetzt werden — siehe unten.

### Gemeinsame Defaults

Eine optionale `forms/_defaults.json` wird _unter_ jedes Formular gemischt. Ideal, um z.B. eine einheitliche Absende-Domain an einer Stelle zu pflegen:

```json
{ "fromAddress": "noreply@meine-domain.de" }
```

Jedes einzelne Formular kann einen Default überschreiben, indem es das Feld selbst setzt.

### Localhost / lokale Entwicklung

Jeder **localhost**-Origin (`localhost`, `127.0.0.1`, `[::1]` — beliebiger Port, http/https) ist **immer** erlaubt, unabhängig von `allowedOrigins`. So funktioniert lokale Entwicklung out-of-the-box, ohne Dev-Ports pro Formular pflegen zu müssen. In `allowedOrigins` gehören nur echte Produktions-/Staging-Domains.

### Turnstile

Ist `turnstile: true`, prüft der Worker den Token gegen das Secret aus der Map `TURNSTILE_SECRETS` (JSON, key = `formId`). So braucht der Worker **genau ein** Turnstile-Secret, egal wie viele Formulare. Siehe [Secrets](#secrets).

## API

### `POST /`

**Modus 1 – Kontaktformular (flach):**

```json
{
  "formId": "meine-website",
  "name": "Max Mustermann",
  "email": "max@example.com",
  "phone": "+49 123 456789",
  "message": "Hallo, ich habe eine Frage.",
  "turnstileToken": "…",
  "website": ""
}
```

`reply_to` der E-Mail wird automatisch auf die `email` des Absenders gesetzt; `website` ist ein Honeypot und muss leer bleiben.

**Modus 2 – Custom Fields:**

```json
{
  "formId": "meine-website",
  "subject": "Neue Bestellung #4711",
  "replyTo": "kunde@example.com",
  "turnstileToken": "…",
  "fields": [
    { "label": "Bestellnummer", "value": "#4711", "type": "text" },
    { "label": "Newsletter", "value": true, "type": "boolean" }
  ]
}
```

Feld-Typen: `text`, `email`, `phone`, `url`, `textarea`, `boolean`.

## Secrets

Der Worker braucht zur Laufzeit zwei Secrets:

| Secret | Inhalt |
|--------|--------|
| `RESEND_API_KEY` | Resend API-Key |
| `TURNSTILE_SECRETS` | JSON-Map `formId → Turnstile-Secret`, z.B. `{"meine-website":"0x…"}` |

Lokal via `.dev.vars`:

```
RESEND_API_KEY=re_xxx
TURNSTILE_SECRETS={"meine-website":"0x4AAAAAAxxxxxxx"}
```

Für Deployment via Cloudflare:

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TURNSTILE_SECRETS
```

## Self-Serve Setup

```bash
# 1. Repo aus Template erzeugen ("Use this template" auf GitHub)
# 2. Abhängigkeiten
npm install
# 3. Eigene Formulare in forms/ anlegen (example.json ersetzen)
# 4. Lokal testen
npm run dev
# 5. Secrets setzen (siehe oben) und deployen
npm run deploy
```

GitHub Secret `CLOUDFLARE_API_TOKEN` (Worker-Deploy-Rechte) setzen, wenn du über GitHub Actions deployen willst.

## Als Service betreiben (GitOps)

Die Engine stellt zwei **reusable Workflows** bereit, die ein separates Config-Repo aufruft:

- `.github/workflows/validate.yml` — kompiliert & testet die Formulare des Config-Repos bei jedem PR (deployt nicht).
- `.github/workflows/deploy.yml` — injiziert die `forms/` des Config-Repos in die Engine, testet und deployt auf Cloudflare, synchronisiert die Secrets.

Das Config-Repo enthält **keinen Code** — nur `forms/*.json`, `forms/_defaults.json` und zwei dünne Workflow-Dateien, die per `uses:` auf diese Engine zeigen. Engine-Update = Ref/Tag im Config-Repo hochziehen (kein Fork, kein Merge).

Der komplette Onboarding-Prozess für neue Websites ist im Config-Repo dokumentiert.

## Entwicklung

```bash
npm run generate    # forms/*.json → src/forms.generated.ts
npm run dev         # lokaler Worker (generiert vorher)
npm test            # Vitest (Worker + Validierungs-Logik)
npm run typecheck   # tsc --noEmit
```

## Warum GitOps?

- **Neue Website = ein PR mit einer Datei.** Reviewbar, auditierbar, per Git-History nachvollziehbar.
- **Validierung im CI** verhindert kaputte Config, bevor sie live geht.
- **Secrets nie im Repo** — sie liegen als GitHub Actions Secrets bzw. Cloudflare Secrets.
- **Engine und Config sauber getrennt** — die Engine bleibt generisch und open source, die Kundendaten liegen isoliert im (privaten) Config-Repo.
