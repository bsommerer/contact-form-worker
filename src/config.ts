import type { FormConfig } from './types'

export const FORMS: Record<string, FormConfig> = {
  'bs-itservices': {
    recipients: ['bastian@bs-itservices.de'],
    fromAddress: 'website@bsitservices.de',
    fromName: 'BS IT Services Website',
    allowedOrigins: ['https://bs-itservices.de', 'http://localhost:5173', 'http://localhost:4173'],
    headerTitle: 'Neue Kontaktanfrage',
    defaultSubject: 'Neue Kontaktanfrage',
    turnstile: { secretEnvKey: 'TURNSTILE_SECRET_BS_ITSERVICES' },
  },
  'florian-albrecht': {
    recipients: ['info@florian-albrecht.net'],
    fromAddress: 'florian-albrecht@bsitservices.de',
    fromName: 'Florian Albrecht Website',
    allowedOrigins: [
      'https://florian-albrecht.net',
      'https://www.florian-albrecht.net',
      'http://localhost:4321', // Astro dev/preview
    ],
    headerTitle: 'Neue Kontaktanfrage über florian-albrecht.net',
    defaultSubject: 'Neue Kontaktanfrage (florian-albrecht.net)',
    // Secret setzen mit: npx wrangler secret put TURNSTILE_SECRET_FLORIAN_ALBRECHT
    turnstile: { secretEnvKey: 'TURNSTILE_SECRET_FLORIAN_ALBRECHT' },
  },
}
