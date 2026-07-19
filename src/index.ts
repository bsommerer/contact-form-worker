import { FORMS } from './config'
import { verifyTurnstile } from './turnstile'
import { buildEmailHtml } from './email-template'
import type { Env, FieldData, NormalizedSubmission } from './types'

/**
 * Localhost origins (any port, http/https) are ALWAYS allowed, so local development
 * works out of the box without listing every dev-server port in each form's
 * allowedOrigins. Covers localhost, 127.0.0.1 and IPv6 loopback [::1].
 */
function isLocalhostOrigin(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin)
    if (protocol !== 'http:' && protocol !== 'https:') return false
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}

/** True if the origin is explicitly configured for the form OR a localhost origin. */
function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  return isLocalhostOrigin(origin) || allowedOrigins.includes(origin)
}

/** Reads the per-form Turnstile secret from the consolidated TURNSTILE_SECRETS JSON map. */
function getTurnstileSecret(env: Env, formId: string | undefined): string | undefined {
  if (!formId || !env.TURNSTILE_SECRETS) return undefined
  try {
    const map = JSON.parse(env.TURNSTILE_SECRETS) as Record<string, string>
    return map[formId]
  } catch {
    console.error('TURNSTILE_SECRETS is not valid JSON')
    return undefined
  }
}

function jsonResponse(data: object, status = 200, corsOrigin?: string): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Content-Type'
  }
  return new Response(JSON.stringify(data), { status, headers })
}

/**
 * Normalizes incoming payload into a unified structure.
 * Modus 1 (Kontaktformular): flat name/email/phone/message → fields array
 * Modus 2 (Custom Fields): fields array passed through directly
 */
function normalizePayload(data: Record<string, unknown>): NormalizedSubmission | { error: string } {
  // Modus 2: Custom Fields
  if (Array.isArray(data.fields)) {
    const fields = data.fields as FieldData[]
    if (fields.length === 0) {
      return { error: 'Fields array must not be empty' }
    }
    return {
      formId: data.formId as string,
      turnstileToken: data.turnstileToken as string | undefined,
      website: data.website as string | undefined,
      subject: data.subject as string | undefined,
      replyTo: data.replyTo as string | undefined,
      fields: fields.filter(f => f.label),
    }
  }

  // Modus 1: Kontaktformular
  const name = data.name as string | undefined
  const email = data.email as string | undefined
  const message = data.message as string | undefined
  const phone = data.phone as string | undefined

  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return { error: 'Missing required fields' }
  }

  const fields: FieldData[] = [
    { label: 'Name', value: name, type: 'text' },
    { label: 'E-Mail', value: email, type: 'email' },
  ]
  if (phone?.trim()) {
    fields.push({ label: 'Telefon', value: phone, type: 'phone' })
  }
  fields.push({ label: 'Nachricht', value: message, type: 'textarea' })

  return {
    formId: data.formId as string,
    turnstileToken: data.turnstileToken as string | undefined,
    website: data.website as string | undefined,
    subject: `Neue Kontaktanfrage von ${name}`,
    replyTo: email,
    fields,
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin') ?? ''
      const allowed = isLocalhostOrigin(origin) || Object.values(FORMS).some(f => f.allowedOrigins.includes(origin))
      if (!allowed) return new Response(null, { status: 403 })
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    let rawData: Record<string, unknown>
    try {
      rawData = await request.json()
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400)
    }

    // 1. Load form config
    const formId = rawData.formId as string | undefined
    const config = formId ? FORMS[formId] : undefined
    if (!config) {
      return jsonResponse({ error: 'Unknown form' }, 404)
    }

    // 2. CORS check (localhost is always allowed for local development)
    const origin = request.headers.get('Origin') ?? ''
    if (!isOriginAllowed(origin, config.allowedOrigins)) {
      return jsonResponse({ error: 'Origin not allowed' }, 403)
    }

    // 3. Honeypot check
    if (rawData.website) {
      return jsonResponse({ success: true }, 200, origin)
    }

    // 4. Normalize payload (validates per mode)
    const normalized = normalizePayload(rawData)
    if ('error' in normalized) {
      return jsonResponse({ error: normalized.error }, 400, origin)
    }

    // 5. Verify Turnstile token (if enabled for this form)
    if (config.turnstile) {
      const secret = getTurnstileSecret(env, formId)
      if (!secret) {
        console.error(`Turnstile secret not found for formId "${formId}" in TURNSTILE_SECRETS`)
        return jsonResponse({ error: 'Internal server error' }, 500, origin)
      }
      const ip = request.headers.get('CF-Connecting-IP')
      const turnstileValid = await verifyTurnstile(secret, normalized.turnstileToken ?? '', ip)
      if (!turnstileValid) {
        return jsonResponse({ error: 'Turnstile verification failed' }, 403, origin)
      }
    }

    // 6. Send email via Resend
    const subject = normalized.subject ?? config.defaultSubject ?? 'Neue Nachricht'

    try {
      const emailPayload: Record<string, unknown> = {
        from: `${config.fromName} <${config.fromAddress}>`,
        to: config.recipients,
        subject,
        html: buildEmailHtml({
          fields: normalized.fields,
          formName: config.fromName,
          headerTitle: config.headerTitle ?? 'Neue Nachricht',
          turnstileVerified: !!config.turnstile,
          timestamp: new Date(),
        }),
      }

      if (normalized.replyTo) {
        emailPayload.reply_to = normalized.replyTo
      }

      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailPayload),
      })

      if (!emailResponse.ok) {
        const errorBody = await emailResponse.text()
        console.error('Resend API error:', errorBody)
        return jsonResponse({ error: 'Failed to send email' }, 500, origin)
      }

      return jsonResponse({ success: true }, 200, origin)
    } catch (err) {
      console.error('Email sending error:', err)
      return jsonResponse({ error: 'Internal server error' }, 500, origin)
    }
  },
}
