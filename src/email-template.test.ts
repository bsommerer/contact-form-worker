import { describe, it, expect } from 'vitest'
import { buildEmailHtml } from './email-template'

const baseData = {
  name: 'Max Mustermann',
  email: 'max@example.com',
  message: 'Hallo, ich habe eine Frage.',
  formName: 'Test Website',
  turnstileVerified: true,
  timestamp: new Date('2026-04-08T14:32:00+02:00'),
}

describe('buildEmailHtml', () => {
  it('generates HTML with name, email, and message', () => {
    const html = buildEmailHtml(baseData)

    expect(html).toContain('Max Mustermann')
    expect(html).toContain('max@example.com')
    expect(html).toContain('Hallo, ich habe eine Frage.')
    expect(html).toContain('mailto:max@example.com')
    expect(html).toContain('Neue Kontaktanfrage')
  })

  it('shows form name in header', () => {
    const html = buildEmailHtml(baseData)
    expect(html).toContain('Test Website')
  })

  it('shows timestamp in footer', () => {
    const html = buildEmailHtml(baseData)
    expect(html).toContain('08.04.2026')
    expect(html).toContain('14:32')
  })

  it('shows verified badge when turnstile is enabled', () => {
    const html = buildEmailHtml({ ...baseData, turnstileVerified: true })
    expect(html).toContain('Verifiziert durch Cloudflare Turnstile')
    expect(html).not.toContain('Ohne Turnstile-Verifizierung')
  })

  it('shows unverified badge when turnstile is disabled', () => {
    const html = buildEmailHtml({ ...baseData, turnstileVerified: false })
    expect(html).toContain('Ohne Turnstile-Verifizierung')
    expect(html).not.toContain('Verifiziert durch Cloudflare Turnstile')
  })

  it('includes phone field when provided', () => {
    const html = buildEmailHtml({ ...baseData, phone: '+49 123 456789' })

    expect(html).toContain('+49 123 456789')
    expect(html).toContain('tel:+49 123 456789')
    expect(html).toContain('Telefon')
  })

  it('omits phone field when not provided', () => {
    const html = buildEmailHtml(baseData)

    expect(html).not.toContain('Telefon')
    expect(html).not.toContain('tel:')
  })

  it('preserves newlines in message via white-space: pre-line', () => {
    const html = buildEmailHtml({ ...baseData, message: 'Zeile 1\nZeile 2\nZeile 3' })
    // Newlines are preserved as-is (rendered via CSS white-space: pre-line)
    expect(html).toContain('Zeile 1\nZeile 2\nZeile 3')
    expect(html).toContain('pre-line')
  })

  it('escapes HTML special characters to prevent XSS', () => {
    const html = buildEmailHtml({
      ...baseData,
      name: '<script>alert("xss")</script>',
      email: 'attacker@evil.com',
      message: '<img onerror="alert(1)" src=x>',
    })

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('</script>')
    expect(html).not.toContain('<img onerror')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img onerror=&quot;alert(1)&quot; src=x&gt;')
  })

  it('escapes ampersands and quotes', () => {
    const html = buildEmailHtml({
      ...baseData,
      name: 'Tom & Jerry "quotes"',
      message: "It's a test & <bold>",
    })

    expect(html).toContain('Tom &amp; Jerry &quot;quotes&quot;')
    expect(html).toContain('It&#039;s a test &amp; &lt;bold&gt;')
  })

  it('includes dark mode styles', () => {
    const html = buildEmailHtml(baseData)
    expect(html).toContain('prefers-color-scheme: dark')
    expect(html).toContain('color-scheme')
  })
})
