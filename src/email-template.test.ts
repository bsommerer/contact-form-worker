import { describe, it, expect } from 'vitest'
import { buildEmailHtml } from './email-template'

describe('buildEmailHtml', () => {
  it('generates HTML with name, email, and message', () => {
    const html = buildEmailHtml({
      name: 'Max Mustermann',
      email: 'max@example.com',
      message: 'Hallo, ich habe eine Frage.',
    })

    expect(html).toContain('Max Mustermann')
    expect(html).toContain('max@example.com')
    expect(html).toContain('Hallo, ich habe eine Frage.')
    expect(html).toContain('mailto:max@example.com')
    expect(html).toContain('Neue Kontaktanfrage')
  })

  it('includes phone field when provided', () => {
    const html = buildEmailHtml({
      name: 'Max',
      email: 'max@example.com',
      phone: '+49 123 456789',
      message: 'Test',
    })

    expect(html).toContain('+49 123 456789')
    expect(html).toContain('tel:+49 123 456789')
    expect(html).toContain('Telefon')
  })

  it('omits phone field when not provided', () => {
    const html = buildEmailHtml({
      name: 'Max',
      email: 'max@example.com',
      message: 'Test',
    })

    expect(html).not.toContain('Telefon')
    expect(html).not.toContain('tel:')
  })

  it('escapes HTML special characters to prevent XSS', () => {
    const html = buildEmailHtml({
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
      name: 'Tom & Jerry "quotes"',
      email: 'test@example.com',
      message: "It's a test & <bold>",
    })

    expect(html).toContain('Tom &amp; Jerry &quot;quotes&quot;')
    expect(html).toContain('It&#039;s a test &amp; &lt;bold&gt;')
  })
})
