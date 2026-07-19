import { FORMS } from './config'
import { verifyTurnstile } from './turnstile'
import { buildEmailHtml } from './email-template'
import { buildSnippet } from './snippet'
import type { Env, FieldData, NormalizedSubmission } from './types'

/**
 * Payload-Limits: großzügig gewählt, damit legitime Formulare weit darunter
 * bleiben, aber E-Mail-Bombing / Amplification durch riesige Payloads verhindert
 * wird. Werte sind bewusst hoch — anpassbar bei Bedarf.
 */
const MAX_BODY_BYTES = 512 * 1024 // 512 KB roher Request-Body
const MAX_FIELDS = 50 // Felder pro Submission (Custom-Fields-Modus)
const MAX_LABEL_LEN = 200 // Zeichen pro Feld-Label
const MAX_VALUE_LEN = 50_000 // Zeichen pro Feldwert (Textarea großzügig)

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

/**
 * Matches an incoming Origin against a single allowedOrigins entry.
 * Supports an exact string match plus a subdomain wildcard of the form
 * "https://*.example.com", which matches the apex (example.com) and any
 * subdomain (foo.example.com, a.b.example.com) — mirroring how Cloudflare
 * Turnstile treats a configured hostname. The scheme must match exactly.
 */
function originMatchesPattern(origin: string, pattern: string): boolean {
  if (origin === pattern) return true
  const wildcard = pattern.match(/^(https?):\/\/\*\.(.+)$/i)
  if (!wildcard) return false
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== `${wildcard[1].toLowerCase()}:`) return false
  const suffix = wildcard[2].toLowerCase()
  const host = url.hostname.toLowerCase()
  return host === suffix || host.endsWith(`.${suffix}`)
}

/** True if the origin is a localhost origin OR matches any allowedOrigins entry (exact or wildcard). */
function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  return isLocalhostOrigin(origin) || allowedOrigins.some(pattern => originMatchesPattern(origin, pattern))
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

/** Reads the per-form Turnstile sitekey (public) from the TURNSTILE_SITEKEYS JSON map. */
function getTurnstileSitekey(env: Env, formId: string): string | null {
  if (!env.TURNSTILE_SITEKEYS) return null
  try {
    const map = JSON.parse(env.TURNSTILE_SITEKEYS) as Record<string, string>
    return map[formId] ?? null
  } catch {
    console.error('TURNSTILE_SITEKEYS is not valid JSON')
    return null
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
      // Robust gegen fremde Payloads: nur echte Objekte mit nicht-leerem
      // String-Label übernehmen (verhindert Crash bei null / falschem Shape).
      fields: fields.filter(f => f && typeof f.label === 'string' && f.label.trim() !== ''),
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

/**
 * Prüft die Payload-Limits nach der Normalisierung. Gibt eine Fehlermeldung
 * zurück, wenn ein Limit überschritten ist, sonst null.
 */
function checkPayloadLimits(fields: FieldData[]): string | null {
  if (fields.length > MAX_FIELDS) {
    return `Too many fields (max ${MAX_FIELDS})`
  }
  for (const f of fields) {
    if (typeof f.label === 'string' && f.label.length > MAX_LABEL_LEN) {
      return `Field label too long (max ${MAX_LABEL_LEN} characters)`
    }
    if (typeof f.value === 'string' && f.value.length > MAX_VALUE_LEN) {
      return `Field value too long (max ${MAX_VALUE_LEN} characters)`
    }
  }
  return null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin') ?? ''
      const allowed =
        isLocalhostOrigin(origin) ||
        Object.values(FORMS).some(f => f.allowedOrigins.some(pattern => originMatchesPattern(origin, pattern)))
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

    // Public GET endpoints (sitekey/snippet are public, so open to any origin):
    //   GET /config/<formId>   → { formId, turnstile, sitekey }
    //   GET /snippet/<formId>  → copy-paste HTML+JS snippet (text/plain)
    if (request.method === 'GET') {
      const url = new URL(request.url)

      const configMatch = url.pathname.match(/^\/config\/([a-z0-9][a-z0-9-]*)$/)
      if (configMatch) {
        const cfgFormId = configMatch[1]
        const cfg = FORMS[cfgFormId]
        if (!cfg) return jsonResponse({ error: 'Unknown form' }, 404, '*')
        return jsonResponse(
          { formId: cfgFormId, turnstile: !!cfg.turnstile, sitekey: getTurnstileSitekey(env, cfgFormId) },
          200,
          '*',
        )
      }

      const snippetMatch = url.pathname.match(/^\/snippet\/([a-z0-9][a-z0-9-]*)$/)
      if (snippetMatch) {
        const snFormId = snippetMatch[1]
        const cfg = FORMS[snFormId]
        if (!cfg) return jsonResponse({ error: 'Unknown form' }, 404, '*')
        const snippet = buildSnippet({
          formId: snFormId,
          workerUrl: url.origin,
          turnstile: !!cfg.turnstile,
          sitekey: getTurnstileSitekey(env, snFormId),
        })
        return new Response(snippet, {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
        })
      }

      return jsonResponse({ error: 'Not found' }, 404)
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405)
    }

    // Body als Text lesen, um die Größe zuverlässig zu begrenzen (unabhängig
    // vom Content-Length-Header), erst danach parsen.
    const bodyText = await request.text()
    if (bodyText.length > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'Payload too large' }, 413)
    }

    let rawData: Record<string, unknown>
    try {
      rawData = JSON.parse(bodyText)
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

    // 3. Rate limiting per IP + formId (bremst Floods / schützt Resend-Kontingent).
    //    Ohne RATE_LIMITER-Binding (z.B. in Tests) wird der Schritt übersprungen.
    if (env.RATE_LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
      const { success } = await env.RATE_LIMITER.limit({ key: `${formId}:${ip}` })
      if (!success) {
        return jsonResponse({ error: 'Rate limit exceeded' }, 429, origin)
      }
    }

    // 4. Honeypot check
    if (rawData.website) {
      return jsonResponse({ success: true }, 200, origin)
    }

    // 5. Normalize payload (validates per mode)
    const normalized = normalizePayload(rawData)
    if ('error' in normalized) {
      return jsonResponse({ error: normalized.error }, 400, origin)
    }

    // 6. Payload-Limits prüfen (Feldanzahl / Label- & Wertlängen)
    const limitError = checkPayloadLimits(normalized.fields)
    if (limitError) {
      return jsonResponse({ error: limitError }, 400, origin)
    }

    // 7. Verify Turnstile token (if enabled for this form)
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

    // 8. Send email via Resend
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
