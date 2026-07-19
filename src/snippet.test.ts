import { describe, it, expect } from 'vitest'
import { buildSnippet } from './snippet'

describe('buildSnippet', () => {
  const base = { formId: 'my-site', workerUrl: 'https://cf.example.workers.dev', turnstile: false, sitekey: null }

  it('includes the standard contact fields and honeypot', () => {
    const s = buildSnippet(base)
    expect(s).toContain('name="name"')
    expect(s).toContain('name="email"')
    expect(s).toContain('name="phone"')
    expect(s).toContain('name="message"')
    expect(s).toContain('name="website"') // honeypot
  })

  it('embeds the worker URL and formId in the fetch call', () => {
    const s = buildSnippet(base)
    expect(s).toContain("fetch('https://cf.example.workers.dev'")
    expect(s).toContain("formId: 'my-site'")
  })

  it('omits Turnstile when disabled', () => {
    const s = buildSnippet(base)
    expect(s).not.toContain('cf-turnstile')
    expect(s).not.toContain('challenges.cloudflare.com')
    expect(s).not.toContain('turnstileToken')
  })

  it('includes the Turnstile widget, script and token mapping when enabled', () => {
    const s = buildSnippet({ ...base, turnstile: true, sitekey: '0xSITEKEY' })
    expect(s).toContain('class="cf-turnstile"')
    expect(s).toContain('data-sitekey="0xSITEKEY"')
    expect(s).toContain('challenges.cloudflare.com/turnstile/v0/api.js')
    expect(s).toContain('turnstileToken')
    expect(s).toContain("data['cf-turnstile-response']")
  })

  it('falls back to a placeholder sitekey when turnstile is on but no sitekey yet', () => {
    const s = buildSnippet({ ...base, turnstile: true, sitekey: null })
    expect(s).toContain('YOUR_SITEKEY')
  })
})
