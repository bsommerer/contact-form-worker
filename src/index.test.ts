import { describe, it, expect, vi, beforeEach } from 'vitest'
import worker from './index'
import type { Env } from './types'

// Mock config with two forms: one with turnstile, one without
vi.mock('./config', () => ({
  FORMS: {
    'test-form': {
      recipients: ['admin@example.com'],
      fromAddress: 'noreply@example.com',
      fromName: 'Test Form',
      allowedOrigins: ['https://example.com'],
      turnstile: { secretEnvKey: 'TURNSTILE_SECRET_TEST' },
    },
    'no-turnstile': {
      recipients: ['team@example.com'],
      fromAddress: 'noreply@example.com',
      fromName: 'Internal Tool',
      allowedOrigins: ['https://internal.example.com'],
      // no turnstile → check skipped
    },
  },
}))

const env: Env = {
  RESEND_API_KEY: 'test-resend-key',
  TURNSTILE_SECRET_TEST: 'test-turnstile-secret',
}

function makeRequest(method: string, body?: object, headers: Record<string, string> = {}): Request {
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  }
  if (body) {
    init.body = JSON.stringify(body)
  }
  return new Request('https://worker.example.com/submit', init)
}

function postRequest(body: object, origin = 'https://example.com'): Request {
  return makeRequest('POST', body, { Origin: origin })
}

// Helper to mock global fetch for Turnstile + Resend
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

  // --- CORS ---
  describe('CORS preflight', () => {
    it('returns 204 with CORS headers for allowed origin', async () => {
      const req = makeRequest('OPTIONS', undefined, { Origin: 'https://example.com' })
      const res = await worker.fetch(req, env)
      expect(res.status).toBe(204)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com')
      expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
      expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type')
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
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://internal.example.com')
    })
  })

  // --- Method check ---
  describe('HTTP method validation', () => {
    it('returns 405 for GET', async () => {
      const req = makeRequest('GET')
      const res = await worker.fetch(req, env)
      expect(res.status).toBe(405)
      expect(await res.json()).toEqual({ error: 'Method not allowed' })
    })

    it('returns 405 for PUT', async () => {
      const req = makeRequest('PUT', { formId: 'test' })
      const res = await worker.fetch(req, env)
      expect(res.status).toBe(405)
    })

    it('returns 405 for DELETE', async () => {
      const req = makeRequest('DELETE')
      const res = await worker.fetch(req, env)
      expect(res.status).toBe(405)
    })
  })

  // --- Invalid JSON ---
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

  // --- Unknown formId ---
  describe('Form ID validation', () => {
    it('returns 404 for unknown formId', async () => {
      const res = await worker.fetch(
        postRequest({ formId: 'nonexistent', name: 'A', email: 'a@b.c', message: 'Hi' }),
        env,
      )
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Unknown form' })
    })
  })

  // --- Origin check ---
  describe('Origin validation', () => {
    it('returns 403 when origin is not allowed', async () => {
      const res = await worker.fetch(
        postRequest({ formId: 'test-form', name: 'A', email: 'a@b.c', message: 'Hi' }, 'https://evil.com'),
        env,
      )
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'Origin not allowed' })
    })
  })

  // --- Honeypot ---
  describe('Honeypot', () => {
    it('returns 200 success when honeypot field is filled (fakes success for bot)', async () => {
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
  })

  // --- Required fields ---
  describe('Required field validation', () => {
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
  })

  // --- Turnstile enabled ---
  describe('Turnstile verification (enabled)', () => {
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

    it('returns 200 on success (turnstile valid + resend ok)', async () => {
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

    it('passes correct secret from env to turnstile', async () => {
      const fetchSpy = mockFetch(true, true)
      globalThis.fetch = fetchSpy
      await worker.fetch(
        postRequest({
          formId: 'test-form',
          name: 'Max',
          email: 'max@example.com',
          message: 'Hello',
          turnstileToken: 'my-token',
        }),
        env,
      )

      // First call is Turnstile verification
      const turnstileCall = fetchSpy.mock.calls[0]
      const body = turnstileCall[1]?.body as URLSearchParams
      expect(body.get('secret')).toBe('test-turnstile-secret')
      expect(body.get('response')).toBe('my-token')
    })
  })

  // --- Turnstile disabled ---
  describe('Turnstile disabled (no turnstile config)', () => {
    it('skips turnstile check and sends email directly', async () => {
      const fetchSpy = mockFetch(true, true)
      globalThis.fetch = fetchSpy
      const res = await worker.fetch(
        postRequest(
          {
            formId: 'no-turnstile',
            name: 'Max',
            email: 'max@example.com',
            message: 'Hello from internal tool',
          },
          'https://internal.example.com',
        ),
        env,
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })

      // Only one fetch call (Resend), no Turnstile call
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const url = typeof fetchSpy.mock.calls[0][0] === 'string'
        ? fetchSpy.mock.calls[0][0]
        : ''
      expect(url).toContain('api.resend.com')
    })
  })

  // --- Resend API error ---
  describe('Resend API error handling', () => {
    it('returns 500 when Resend API returns error', async () => {
      globalThis.fetch = mockFetch(true, false)
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
          turnstileToken: 'valid-token',
        }),
        env,
      )
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'Internal server error' })
    })
  })

  // --- CORS headers on responses ---
  describe('CORS headers on POST responses', () => {
    it('includes CORS headers on success response', async () => {
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
