# Contact Form Worker

Wiederverwendbarer Cloudflare Worker, der Kontaktformular-Submissions empfängt, validiert und per HTML-E-Mail über die [Resend API](https://resend.com) versendet.

## Features

- **Multi-Formular:** Ein Worker für mehrere Websites — Routing über `formId`
- **Turnstile:** Cloudflare Turnstile Bot-Schutz pro Formular aktivierbar/deaktivierbar
- **Honeypot:** Unsichtbares Feld zum Abfangen einfacher Bots
- **CORS:** Konfigurierbare Allowed Origins pro Formular
- **XSS-Schutz:** HTML-Escaping in der E-Mail-Template
- **DSGVO-konform:** Keine Datenspeicherung, kein Tracking

## Neues Formular hinzufügen

1. **Formular-Konfiguration** in `src/config.ts` ergänzen:

```ts
'meine-website': {
  recipients: ['info@meine-website.de'],
  fromAddress: 'kontakt@meine-website.de',
  fromName: 'Meine Website',
  allowedOrigins: ['https://meine-website.de'],
  turnstile: { secretEnvKey: 'TURNSTILE_SECRET_MEINE_WEBSITE' },
},
```

2. **Turnstile Secret anlegen** (falls Turnstile aktiviert):

```bash
npx wrangler secret put TURNSTILE_SECRET_MEINE_WEBSITE
```

3. **Deployen** — Push zu `main` triggert automatisches Deployment.

### Turnstile deaktivieren

Einfach das `turnstile`-Feld in der Config weglassen:

```ts
'internes-tool': {
  recipients: ['team@firma.de'],
  fromAddress: 'noreply@firma.de',
  fromName: 'Internes Tool',
  allowedOrigins: ['https://intern.firma.de'],
  // kein turnstile → Check wird übersprungen
},
```

## Setup

### Voraussetzungen

- Node.js (siehe `.nvmrc`)
- Cloudflare Account
- [Resend](https://resend.com) Account + API Key
- (Optional) Cloudflare Turnstile Widget pro Domain

### Secrets konfigurieren

```bash
# Resend API Key
npx wrangler secret put RESEND_API_KEY

# Turnstile Secrets (pro Formular)
npx wrangler secret put TURNSTILE_SECRET_BS_ITSERVICES
```

### GitHub Secrets für CI/CD

Im GitHub Repository unter Settings → Secrets → Actions:

- `CLOUDFLARE_API_TOKEN` — Cloudflare API Token mit Worker-Deploy-Berechtigung

## Lokale Entwicklung

```bash
npm install
npm run dev
```

Erstelle eine `.dev.vars`-Datei für lokale Secrets:

```
RESEND_API_KEY=re_xxx
TURNSTILE_SECRET_BS_ITSERVICES=0x4AAAAAAxxxxxxx
```

## Tests

```bash
npm test           # Einmalig ausführen
npm run test:watch # Watch-Modus
npm run typecheck  # TypeScript Type-Check
```

## Deployment

Automatisch via GitHub Actions bei Push auf `main`:

1. TypeScript Type-Check
2. Tests
3. `wrangler deploy` bei Erfolg

Manuell:

```bash
npm run deploy
```

## API

### POST /

```json
{
  "formId": "bs-itservices",
  "name": "Max Mustermann",
  "email": "max@example.com",
  "phone": "+49 123 456789",
  "message": "Hallo, ich habe eine Frage.",
  "turnstileToken": "xxx",
  "website": ""
}
```

| Feld | Pflicht | Beschreibung |
|------|---------|-------------|
| `formId` | Ja | ID aus `config.ts` |
| `name` | Ja | Name des Absenders |
| `email` | Ja | E-Mail des Absenders |
| `message` | Ja | Nachricht |
| `phone` | Nein | Telefonnummer |
| `turnstileToken` | Wenn Turnstile aktiv | Cloudflare Turnstile Token |
| `website` | Nein | Honeypot — muss leer bleiben |
