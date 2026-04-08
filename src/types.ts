export interface Env {
  RESEND_API_KEY: string
  [key: string]: string // Dynamische Turnstile Secrets pro Form
}

export interface FormConfig {
  recipients: string[]
  fromAddress: string
  fromName: string
  allowedOrigins: string[]
  turnstile?: {
    secretEnvKey: string // Name der Env-Variable, z.B. "TURNSTILE_SECRET_BS_ITSERVICES"
  }
  // Wenn turnstile undefined/nicht gesetzt → Turnstile-Prüfung wird übersprungen
}

export interface ContactFormData {
  formId: string
  turnstileToken?: string
  name: string
  email: string
  phone?: string
  message: string
  website?: string // honeypot
}
