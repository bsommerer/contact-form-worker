export interface Env {
  RESEND_API_KEY: string
  // JSON-Map formId -> Turnstile-Secret, z.B. {"my-site":"0x…"}.
  // Wird als EIN Cloudflare-Secret gepflegt (siehe README / Deploy-Workflow).
  TURNSTILE_SECRETS?: string
}

export interface FormConfig {
  recipients: string[]
  fromAddress: string
  fromName: string
  allowedOrigins: string[]
  headerTitle?: string       // Email-Überschrift, Default: "Neue Nachricht"
  defaultSubject?: string    // Fallback wenn Client keinen Subject schickt
  turnstile?: boolean        // true → Turnstile-Token wird geprüft (Secret via TURNSTILE_SECRETS[formId])
}

// --- Modus 1: Einfaches Kontaktformular (flat payload) ---

export interface ContactFormPayload {
  formId: string
  turnstileToken?: string
  website?: string // honeypot
  name: string
  email: string
  phone?: string
  message: string
}

// --- Modus 2: Custom Fields (fields array) ---

export type FieldType = 'text' | 'email' | 'phone' | 'url' | 'textarea' | 'boolean'

export interface FieldData {
  label: string
  value: string | boolean
  type?: FieldType // Default: 'text', boolean-Werte werden automatisch erkannt
}

export interface CustomFieldsPayload {
  formId: string
  turnstileToken?: string
  website?: string  // honeypot
  subject?: string
  replyTo?: string
  fields: FieldData[]
}

// --- Normalisierte Struktur (intern, nach Modus-Erkennung) ---

export interface NormalizedSubmission {
  formId: string
  turnstileToken?: string
  website?: string
  subject?: string
  replyTo?: string
  fields: FieldData[]
}
