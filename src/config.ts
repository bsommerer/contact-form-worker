import type { FormConfig } from './types'

export const FORMS: Record<string, FormConfig> = {
  'bs-itservices': {
    recipients: ['bastian@bs-itservices.de'],
    fromAddress: 'website@reservetable.bs-itservices.de',
    fromName: 'BS IT Services Website',
    allowedOrigins: ['https://bs-itservices.de', 'http://localhost:5173', 'http://localhost:4173'],
    headerTitle: 'Neue Kontaktanfrage',
    defaultSubject: 'Neue Kontaktanfrage',
    turnstile: { secretEnvKey: 'TURNSTILE_SECRET_BS_ITSERVICES' },
  },
}
