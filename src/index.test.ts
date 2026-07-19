import { describe, it, expect, vi, beforeEach } from 'vitest'
import worker from './index'
import type { Env } from './types'

vi.mock('./config', () => ({
  FORMS: {
    'test-form': {
      recipients: ['admin@example.com'],
      fromAddress: 'noreply@example.com',
      fromName: 'Test Form',
      allowedOrigins: ['https://example.com'],
      headerTitle: 'Neue Kontaktanfrage',
      defaultSubject: 'Kontaktanfrage',
      turnstile: true,
    },
    'no-turnstile': {
      recipients: ['team@example.com'],
      fromAddress: 'noreply@example.com',
      fromName: 'Internal Tool',
      allowedOrigins: ['https://internal.example.com'],
      turnstile: false,
    },
  },
}))

const env: Env = {
  RESEND_API_KEY: 'test-resend-key',
  TURNSTILE_SECRETS: JSON.stringify({ 'test-form': 'test-turnstile-secret' }),
}

function makeRequest(method: string, body?: object, headers: Record<string, string> = {}): Request {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  }
  if (body) init.body = JSON.stringify(body)
  return new Request('https://worker.example.com/submit', init)
}

function postRequest(body: object, origin = 'https://example.com'): Request {
  return makeRequest('POST', body, { Origin: origin })
}

function mockFetch(turnstileSuccess: boolean, resendOk: boolean) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('challenges.cloudflare.com')) {
      return new Response(JSON.stringify({ success: turnstileSuccess }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('api.resend.com')) {
      return new Response(
        resendOk ? JSON.stringify({ id: 'email-123' }) : 'Internal Server Error',
        { status: resendOk ? 200 : 500 },
      )
    }
    return new Response('Not found', { status: 404 })
  })
}

describe('Contact Form Worker', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // ==================== CORS ====================

  describe('CORS preflight', () => {
    it('returns 204 with CORS headers for allowed origin', async () => {
      const req = makeRequest('OPTIONS', undefined, { Origin: 'https://example.com' })
      const res = await worker.fetch(req, env)
      expect(res.status).toBe(204)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com')
    })

    it('returns 403 for disallowed origin', async () => {
      const req = makeRequest('OPTIONS', undefined, { Origin: 'https://evil.com' })
      const res = await worker.fetch(req, env)
      expect(res.status).toBe(403)
    })

    it('returns 204 for origin allowed by second form config', async () => {
      const req = makeRequest('OPTIONS', undefined, { Origin: 'https://internal.example.com' })
      const res = await worker.fetch(req, env)
      expect(res.status).toBe(204)
    })

    it('returns 204 for any localhost origin (any port), even if not listed', async () => {
      for (const origin of ['http://localhost:5173', 'http://localhost:9999', 'http://127.0.0.1:3000', 'http://[::1]:8080']) {
        const res = await worker.fetch(makeRequest('OPTIONS', undefined, { Origin: origin }), env)
        expect(res.status, origin).toBe(204)
        expect(res.headers.get('Access-Control-Allow-Origin'), origin).toBe(origin)
      }
    })
  })

  // ==================== Method check ====================

  describe('HTTP method validation', () => {
    it('returns 405 for GET', async () => {
      const res = await worker.fetch(makeRequest('GET'), env)
      expect(res.status).toBe(405)
    })

    it('returns 405 for PUT', async () => {
      const res = await worker.fetch(makeRequest('PUT', { formId: 'test' }), env)
      expect(res.status).toBe(405)
    })

    it('returns 405 for DELETE', async () => {
      const res = await worker.fetch(makeRequest('DELETE'), env)
      expect(res.status).toBe(405)
    })
  })

  // ==================== JSON parsing ====================

  describe('JSON parsing', () => {
    it('returns 400 for invalid JSON', async () => {
      const req = new Request('https://worker.example.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
        body: 'not-json{{{',
      })
      const res = await worker.fetch(req, env)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid JSON' })
    })
  })

  // ==================== Form ID / Origin ====================

  describe('Form ID and origin validation', () => {
    it('returns 404 for unknown formId', async () => {
      const res = await worker.fetch(postRequest({ formId: 'nonexistent' }), env)
      expect(res.status).toBe(404)
    })

    it('returns 403 when origin is not allowed', async () => {
      const res = await worker.fetch(
        postRequest({ formId: 'test-form', name: 'A', email: 'a@b.c', message: 'Hi' }, 'https://evil.com'),
        env,
      )
      expect(res.status).toBe(403)
    })

    it('accepts POST from a localhost origin not listed in the form config', async () => {
      globalThis.fetch = mockFetch(true, true)
      // no-turnstile form only lists https://internal.example.com — localhost must still pass
      const res = await worker.fetch(
        postRequest(
          { formId: 'no-turnstile', name: 'Dev', email: 'dev@localhost', message: 'local test' },
          'http://localhost:5173',
        ),
        env,
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
    })
  })

  // ==================== Honeypot ====================

  describe('Honeypot', () => {
    it('returns 200 success when honeypot field is filled (contact form mode)', async () => {
      const res = await worker.fetch(
        postRequest({
          formId: 'test-form',
          name: 'Bot',
          email: 'bot@spam.com',
          message: 'Buy now',
          website: 'http://spam.com',
        }),
        env,
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
    })

    it('returns 200 success when honeypot field is filled (custom fields mode)', async () => {
      const res = await worker.fetch(
        postRequest({
          formId: 'test-form',
          website: 'http://spam.com',
          fields: [{ label: 'Name', value: 'Bot' }],
        }),
        env,
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
    })
  })

  // ==================== Modus 1: Kontaktformular ====================

  describe('Contact form mode (flat payload)', () => {
    it('returns 400 when name is missing', async () => {
      const res = await worker.fetch(
        postRequest({ formId: 'test-form', name: '', email: 'a@b.c', message: 'Hi' }),
        env,
      )
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Missing required fields' })
    })

    it('returns 400 when email is missing', async () => {
      const res = await worker.fetch(
        postRequest({ formId: 'test-form', name: 'A', email: '', message: 'Hi' }),
        env,
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 when message is missing', async () => {
      const res = await worker.fetch(
        postRequest({ formId: 'test-form', name: 'A', email: 'a@b.c', message: '' }),
        env,
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 when fields are only whitespace', async () => {
      const res = await worker.fetch(
        postRequest({ formId: 'test-form', name: '   ', email: 'a@b.c', message: 'Hi' }),
        env,
      )
      expect(res.status).toBe(400)
    })

    it('returns 200 on success with turnstile', async () => {
      globalThis.fetch = mockFetch(true, true)
      const res = await worker.fetch(
        postRequest({
          formId: 'test-form',
          name: 'Max',
          email: 'max@example.com',
          message: 'Hello',
          turnstileToken: 'valid-token',
        }),
        env,
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
    })

    it('sets subject to "Neue Kontaktanfrage von {name}"', async () => {
      const fetchSpy = mockFetch(true, true)
      globalThis.fetch = fetchSpy
      await worker.fetch(
        postRequest({
          formId: 'test-form',
          name: 'Max Mustermann',
          email: 'max@example.com',
          message: 'Hello',
          turnstileToken: 'valid',
        }),
        env,
      )

      // Second call is Resend
      const resendCall = fetchSpy.mock.calls[1]
      const body = JSON.parse(resendCall[1]?.body as string)
      expect(body.subject).toBe('Neue Kontaktanfrage von Max Mustermann')
    })

    it('sets reply-to to email field', async () => {
      const fetchSpy = mockFetch(true, true)
      globalThis.fetch = fetchSpy
      await worker.fetch(
        postRequest({
          formId: 'test-form',
          name: 'Max',
          email: 'max@example.com',
          message: 'Hello',
          turnstileToken: 'valid',
        }),
        env,
      )

      const resendCall = fetchSpy.mock.calls[1]
      const body = JSON.parse(resendCall[1]?.body as string)
      expect(body.reply_to).toBe('max@example.com')
    })

    it('includes optional phone field', async () => {
      const fetchSpy = mockFetch(true, true)
      globalThis.fetch = fetchSpy
      await worker.fetch(
        postRequest({
          formId: 'test-form',
          name: 'Max',
          email: 'max@example.com',
          phone: '+49 123',
          message: 'Hello',
          turnstileToken: 'valid',
        }),
        env,
      )

      const resendCall = fetchSpy.mock.calls[1]
      const body = JSON.parse(resendCall[1]?.body as string)
      expect(body.html).toContain('+49 123')
      expect(body.html).toContain('Telefon')
    })

    it('omits phone field when not provided', async () => {
      const fetchSpy = mockFetch(true, true)
      globalThis.fetch = fetchSpy
      await worker.fetch(
        postRequest({
          formId: 'test-form',
          name: 'Max',
          email: 'max@example.com',
          message: 'Hello',
          turnstileToken: 'valid',
        }),
        env,
      )

      const resendCall = fetchSpy.mock.calls[1]
      const body = JSON.parse(resendCall[1]?.body as string)
      expect(body.html).not.toContain('Telefon')
    })
  })

  // ==================== Modus 2: Custom Fields ====================

  describe('Custom fields mode (fields array)', () => {
    it('returns 400 when fields array is empty', async () => {
      const res = await worker.fetch(
        postRequest({ formId: 'test-form', fields: [] }),
        env,
      )
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Fields array must not be empty' })
    })

    it('returns 200 with custom fields and turnstile', async () => {
      globalThis.fetch = mockFetch(true, true)
      const res = await worker.fetch(
        postRequest({
          formId: 'test-form',
          turnstileToken: 'valid',
          fields: [
            { label: 'Bestellnummer', value: '#4711' },
            { label: 'Kunde', value: 'Max' },
          ],
        }),
        env,
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
    })

    it('uses subject from payload', async () => {
      const fetchSpy = mockFetch(true, true)
      globalThis.fetch = fetchSpy
      await worker.fetch(
        postRequest({
          formId: 'test-form',
          turnstileToken: 'valid',
          subject: 'Neue Bestellung #4711',
          fields: [{ label: 'Info', value: 'Test' }],
        }),
        env,
      )

      const resendCall = fetchSpy.mock.calls[1]
      const body = JSON.parse(resendCall[1]?.body as string)
      expect(body.subject).toBe('Neue Bestellung #4711')
    })

    it('falls back to config defaultSubject when no subject in payload', async () => {
      const fetchSpy = mockFetch(true, true)
      globalThis.fetch = fetchSpy
      await worker.fetch(
        postRequest({
          formId: 'test-form',
          turnstileToken: 'valid',
          fields: [{ label: 'Info', value: 'Test' }],
        }),
        env,
      )

      const resendCall = fetchSpy.mock.calls[1]
      const body = JSON.parse(resendCall[1]?.body as string)
      expect(body.subject).toBe('Kontaktanfrage')
    })

    it('falls back to "Neue Nachricht" when no subject anywhere', async () => {
      globalThis.fetch = mockFetch(true, true)
      // no-turnstile form has no defaultSubject
      const fetchSpy = globalThis.fetch
      await worker.fetch(
        postRequest(
          {
            formId: 'no-turnstile',
            fields: [{ label: 'Info', value: 'Test' }],
          },
          'https://internal.example.com',
        ),
        env,
      )

      const resendCall = fetchSpy.mock.calls[0]
      const body = JSON.parse(resendCall[1]?.body as string)
      expect(body.subject).toBe('Neue Nachricht')
    })

    it('uses replyTo from payload', async () => {
      const fetchSpy = mockFetch(true, true)
      globalThis.fetch = fetchSpy
      await worker.fetch(
        postRequest({
          formId: 'test-form',
          turnstileToken: 'valid',
          replyTo: 'customer@example.com',
          fields: [{ label: 'Info', value: 'Test' }],
        }),
        env,
      )

      const resendCall = fetchSpy.mock.calls[1]
      const body = JSON.parse(resendCall[1]?.body as string)
      expect(body.reply_to).toBe('customer@example.com')
    })

    it('omits reply-to when not in payload', async () => {
      const fetchSpy = mockFetch(true, true)
      globalThis.fetch = fetchSpy
      await worker.fetch(
        postRequest({
          formId: 'test-form',
          turnstileToken: 'valid',
          fields: [{ label: 'Info', value: 'Test' }],
        }),
        env,
      )

      const resendCall = fetchSpy.mock.calls[1]
      const body = JSON.parse(resendCall[1]?.body as string)
      expect(body.reply_to).toBeUndefined()
    })

    it('renders various field types in email', async () => {
      const fetchSpy = mockFetch(true, true)
      globalThis.fetch = fetchSpy
      await worker.fetch(
        postRequest({
          formId: 'test-form',
          turnstileToken: 'valid',
          fields: [
            { label: 'Name', value: 'Max', type: 'text' },
            { label: 'E-Mail', value: 'max@test.de', type: 'email' },
            { label: 'Newsletter', value: true, type: 'boolean' },
            { label: 'Nachricht', value: 'Hallo Welt', type: 'textarea' },
          ],
        }),
        env,
      )

      const resendCall = fetchSpy.mock.calls[1]
      const body = JSON.parse(resendCall[1]?.body as string)
      expect(body.html).toContain('Max')
      expect(body.html).toContain('mailto:max@test.de')
      expect(body.html).toContain('Ja')
      expect(body.html).toContain('message-box')
    })

    it('filters out fields without label', async () => {
      const fetchSpy = mockFetch(true, true)
      globalThis.fetch = fetchSpy
      await worker.fetch(
        postRequest({
          formId: 'test-form',
          turnstileToken: 'valid',
          fields: [
            { label: 'Name', value: 'Max' },
            { label: '', value: 'should-be-filtered' },
          ],
        }),
        env,
      )

      const resendCall = fetchSpy.mock.calls[1]
      const body = JSON.parse(resendCall[1]?.body as string)
      expect(body.html).toContain('Max')
      expect(body.html).not.toContain('should-be-filtered')
    })
  })

  // ==================== Turnstile ====================

  describe('Turnstile verification', () => {
    it('returns 403 when turnstile verification fails', async () => {
      globalThis.fetch = mockFetch(false, true)
      const res = await worker.fetch(
        postRequest({
          formId: 'test-form',
          name: 'Max',
          email: 'max@example.com',
          message: 'Hello',
          turnstileToken: 'invalid-token',
        }),
        env,
      )
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'Turnstile verification failed' })
    })

    it('returns 500 when turnstile is enabled but no secret exists for the formId', async () => {
      globalThis.fetch = mockFetch(true, true)
      const envWithoutSecret: Env = { RESEND_API_KEY: 'test-resend-key', TURNSTILE_SECRETS: JSON.stringify({}) }
      const res = await worker.fetch(
        postRequest({
          formId: 'test-form',
          name: 'Max',
          email: 'max@example.com',
          message: 'Hello',
          turnstileToken: 'valid',
        }),
        envWithoutSecret,
      )
      expect(res.status).toBe(500)
    })

    it('returns 500 when TURNSTILE_SECRETS is malformed JSON', async () => {
      globalThis.fetch = mockFetch(true, true)
      const badEnv: Env = { RESEND_API_KEY: 'test-resend-key', TURNSTILE_SECRETS: '{not-json' }
      const res = await worker.fetch(
        postRequest({
          formId: 'test-form',
          name: 'Max',
          email: 'max@example.com',
          message: 'Hello',
          turnstileToken: 'valid',
        }),
        badEnv,
      )
      expect(res.status).toBe(500)
    })

    it('looks up the secret by formId (only the matching form verifies)', async () => {
      const fetchSpy = mockFetch(true, true)
      globalThis.fetch = fetchSpy
      const scopedEnv: Env = {
        RESEND_API_KEY: 'test-resend-key',
        TURNSTILE_SECRETS: JSON.stringify({ 'test-form': 'secret-a', 'other-form': 'secret-b' }),
      }
      await worker.fetch(
        postRequest({
          formId: 'test-form',
          name: 'Max',
          email: 'max@example.com',
          message: 'Hello',
          turnstileToken: 'valid',
        }),
        scopedEnv,
      )
      // First call is Turnstile verify — assert it used this form's secret
      const verifyCall = fetchSpy.mock.calls[0]
      const sentBody = verifyCall[1]?.body as URLSearchParams
      expect(sentBody.get('secret')).toBe('secret-a')
    })

    it('skips turnstile when not configured', async () => {
      const fetchSpy = mockFetch(true, true)
      globalThis.fetch = fetchSpy
      const res = await worker.fetch(
        postRequest(
          {
            formId: 'no-turnstile',
            name: 'Max',
            email: 'max@example.com',
            message: 'Hello',
          },
          'https://internal.example.com',
        ),
        env,
      )
      expect(res.status).toBe(200)
      // Only Resend call, no Turnstile call
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
  })

  // ==================== Resend errors ====================

  describe('Resend API error handling', () => {
    it('returns 500 when Resend API returns error', async () => {
      globalThis.fetch = mockFetch(true, false)
      const res = await worker.fetch(
        postRequest({
          formId: 'test-form',
          name: 'Max',
          email: 'max@example.com',
          message: 'Hello',
          turnstileToken: 'valid',
        }),
        env,
      )
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'Failed to send email' })
    })

    it('returns 500 when Resend API throws', async () => {
      globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes('challenges.cloudflare.com')) {
          return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
        throw new Error('Network error')
      })
      const res = await worker.fetch(
        postRequest({
          formId: 'test-form',
          name: 'Max',
          email: 'max@example.com',
          message: 'Hello',
          turnstileToken: 'valid',
        }),
        env,
      )
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'Internal server error' })
    })
  })

  // ==================== CORS on responses ====================

  describe('CORS headers on POST responses', () => {
    it('includes CORS headers on success response', async () => {
      globalThis.fetch = mockFetch(true, true)
      const res = await worker.fetch(
        postRequest({
          formId: 'test-form',
          name: 'Max',
          email: 'max@example.com',
          message: 'Hello',
          turnstileToken: 'valid',
        }),
        env,
      )
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com')
    })

    it('includes CORS headers on validation error response', async () => {
      const res = await worker.fetch(
        postRequest({ formId: 'test-form', name: '', email: 'a@b.c', message: 'Hi' }),
        env,
      )
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com')
    })
  })
})
