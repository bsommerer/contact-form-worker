import { FORMS } from './config'
import { verifyTurnstile } from './turnstile'
import { buildEmailHtml } from './email-template'
import type { Env, ContactFormData } from './types'

function jsonResponse(data: object, status = 200, corsOrigin?: string): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Content-Type'
  }
  return new Response(JSON.stringify(data), { status, headers })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin') ?? ''
      // Check if origin is allowed by any form
      const allowed = Object.values(FORMS).some(f => f.allowedOrigins.includes(origin))
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

    let data: ContactFormData
    try {
      data = await request.json()
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400)
    }

    // 1. Load form config
    const config = FORMS[data.formId]
    if (!config) {
      return jsonResponse({ error: 'Unknown form' }, 404)
    }

    // 2. CORS check
    const origin = request.headers.get('Origin') ?? ''
    if (!config.allowedOrigins.includes(origin)) {
      return jsonResponse({ error: 'Origin not allowed' }, 403)
    }

    // 3. Honeypot check — bots fill hidden fields
    if (data.website) {
      // Return success to not alert the bot
      return jsonResponse({ success: true }, 200, origin)
    }

    // 4. Validate required fields
    if (!data.name?.trim() || !data.email?.trim() || !data.message?.trim()) {
      return jsonResponse({ error: 'Missing required fields' }, 400, origin)
    }

    // 5. Verify Turnstile token (if enabled for this form)
    if (config.turnstile) {
      const secret = env[config.turnstile.secretEnvKey]
      if (!secret) {
        console.error(`Turnstile secret not found for env key: ${config.turnstile.secretEnvKey}`)
        return jsonResponse({ error: 'Internal server error' }, 500, origin)
      }
      const ip = request.headers.get('CF-Connecting-IP')
      const turnstileValid = await verifyTurnstile(secret, data.turnstileToken ?? '', ip)
      if (!turnstileValid) {
        return jsonResponse({ error: 'Turnstile verification failed' }, 403, origin)
      }
    }

    // 6. Send email via Resend
    try {
      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${config.fromName} <${config.fromAddress}>`,
          to: config.recipients,
          subject: `Neue Kontaktanfrage von ${data.name}`,
          html: buildEmailHtml({
            name: data.name,
            email: data.email,
            phone: data.phone,
            message: data.message,
          }),
        }),
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
