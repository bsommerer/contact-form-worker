import { describe, it, expect } from 'vitest'
import { buildEmailHtml, escapeHtml } from './email-template'
import type { FieldData } from './types'

const baseData = {
  fields: [
    { label: 'Name', value: 'Max Mustermann', type: 'text' as const },
    { label: 'E-Mail', value: 'max@example.com', type: 'email' as const },
    { label: 'Nachricht', value: 'Hallo, ich habe eine Frage.', type: 'textarea' as const },
  ],
  formName: 'Test Website',
  headerTitle: 'Neue Kontaktanfrage',
  turnstileVerified: true,
  timestamp: new Date('2026-04-08T14:32:00+02:00'),
}

function buildWith(fields: FieldData[], overrides: Partial<typeof baseData> = {}) {
  return buildEmailHtml({ ...baseData, fields, ...overrides })
}

describe('buildEmailHtml', () => {
  // --- Basic rendering ---

  it('renders text field with value in .value div', () => {
    const html = buildWith([{ label: 'Name', value: 'Max', type: 'text' }])
    expect(html).toContain('Max')
    expect(html).toContain('Name')
  })

  it('renders email field with mailto: link', () => {
    const html = buildWith([{ label: 'E-Mail', value: 'max@example.com', type: 'email' }])
    expect(html).toContain('mailto:max@example.com')
    expect(html).toContain('max@example.com')
  })

  it('renders phone field with tel: link', () => {
    const html = buildWith([{ label: 'Telefon', value: '+49 123 456789', type: 'phone' }])
    expect(html).toContain('tel:+49 123 456789')
    expect(html).toContain('+49 123 456789')
    expect(html).toContain('Telefon')
  })

  it('renders url field with clickable link', () => {
    const html = buildWith([{ label: 'Website', value: 'https://example.com', type: 'url' }])
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('renders textarea field in message-box with pre-line', () => {
    const html = buildWith([{ label: 'Nachricht', value: 'Zeile 1\nZeile 2', type: 'textarea' }])
    expect(html).toContain('message-box')
    expect(html).toContain('Zeile 1\nZeile 2')
    expect(html).toContain('pre-line')
  })

  it('renders boolean true as "Ja" badge', () => {
    const html = buildWith([{ label: 'Newsletter', value: true, type: 'boolean' }])
    expect(html).toContain('badge-yes')
    expect(html).toContain('Ja')
  })

  it('renders boolean false as "Nein" badge', () => {
    const html = buildWith([{ label: 'Newsletter', value: false, type: 'boolean' }])
    expect(html).toContain('badge-no')
    expect(html).toContain('Nein')
  })

  it('renders string "true" as "Ja" for boolean type', () => {
    const html = buildWith([{ label: 'Akzeptiert', value: 'true', type: 'boolean' }])
    expect(html).toContain('badge-yes')
    expect(html).toContain('Ja')
  })

  // --- Auto-detection ---

  it('auto-detects boolean type when value is boolean and no type specified', () => {
    const html = buildWith([{ label: 'Opt-in', value: true }])
    expect(html).toContain('badge-yes')
    expect(html).toContain('Ja')
  })

  it('defaults to text type when no type specified and value is string', () => {
    const html = buildWith([{ label: 'Firma', value: 'ACME Corp' }])
    expect(html).toContain('ACME Corp')
    expect(html).not.toContain('mailto:')
    expect(html).not.toContain('tel:')
    // Value should be in .value div, not in .message-box div
    expect(html).toContain('<div class="value">ACME Corp</div>')
  })

  // --- Empty values ---

  it('skips fields with empty string value', () => {
    const html = buildWith([
      { label: 'Name', value: 'Max', type: 'text' },
      { label: 'Telefon', value: '', type: 'phone' },
    ])
    expect(html).toContain('Max')
    expect(html).not.toContain('Telefon')
  })

  it('does NOT skip boolean false (renders "Nein")', () => {
    const html = buildWith([{ label: 'Newsletter', value: false, type: 'boolean' }])
    expect(html).toContain('Newsletter')
    expect(html).toContain('Nein')
  })

  // --- Field order ---

  it('renders fields in the given order', () => {
    const html = buildWith([
      { label: 'Drittens', value: '3', type: 'text' },
      { label: 'Erstens', value: '1', type: 'text' },
      { label: 'Zweitens', value: '2', type: 'text' },
    ])
    const drittens = html.indexOf('Drittens')
    const erstens = html.indexOf('Erstens')
    const zweitens = html.indexOf('Zweitens')
    expect(drittens).toBeLessThan(erstens)
    expect(erstens).toBeLessThan(zweitens)
  })

  // --- Header, footer, meta ---

  it('shows headerTitle in h1', () => {
    const html = buildWith([], { headerTitle: 'Neue Bestellung' })
    expect(html).toContain('Neue Bestellung')
  })

  it('shows formName in header', () => {
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

  // --- XSS / Escaping ---

  it('escapes HTML in text fields to prevent XSS', () => {
    const html = buildWith([{ label: 'Name', value: '<script>alert("xss")</script>', type: 'text' }])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes HTML in email field href', () => {
    const html = buildWith([{ label: 'Email', value: '"><script>alert(1)</script>', type: 'email' }])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
  })

  it('escapes HTML in url field href', () => {
    const html = buildWith([{ label: 'Link', value: '"><img src=x onerror=alert(1)>', type: 'url' }])
    expect(html).not.toContain('<img')
    expect(html).toContain('&quot;&gt;&lt;img')
  })

  it('escapes HTML in textarea fields', () => {
    const html = buildWith([{ label: 'Msg', value: '<img onerror="alert(1)" src=x>', type: 'textarea' }])
    expect(html).not.toContain('<img onerror')
    expect(html).toContain('&lt;img onerror=&quot;alert(1)&quot; src=x&gt;')
  })

  it('escapes ampersands and quotes', () => {
    const html = buildWith([{ label: 'Info', value: 'Tom & Jerry "test"', type: 'text' }])
    expect(html).toContain('Tom &amp; Jerry &quot;test&quot;')
  })

  it('escapes HTML in labels', () => {
    const html = buildWith([{ label: '<b>Bold</b>', value: 'test', type: 'text' }])
    expect(html).not.toContain('<b>Bold</b>')
    expect(html).toContain('&lt;b&gt;Bold&lt;/b&gt;')
  })

  // --- Dark mode ---

  it('includes dark mode styles', () => {
    const html = buildEmailHtml(baseData)
    expect(html).toContain('prefers-color-scheme: dark')
    expect(html).toContain('color-scheme')
  })

  // --- Overflow handling ---

  it('includes overflow-wrap for long content', () => {
    const html = buildEmailHtml(baseData)
    expect(html).toContain('overflow-wrap: break-word')
  })

  // --- All field types together ---

  it('renders a mix of all field types correctly', () => {
    const html = buildWith([
      { label: 'Name', value: 'Max', type: 'text' },
      { label: 'E-Mail', value: 'max@test.de', type: 'email' },
      { label: 'Telefon', value: '+49 123', type: 'phone' },
      { label: 'Website', value: 'https://test.de', type: 'url' },
      { label: 'Nachricht', value: 'Hallo\nWelt', type: 'textarea' },
      { label: 'Newsletter', value: true, type: 'boolean' },
      { label: 'AGB', value: false, type: 'boolean' },
    ])
    expect(html).toContain('Max')
    expect(html).toContain('mailto:max@test.de')
    expect(html).toContain('tel:+49 123')
    expect(html).toContain('href="https://test.de"')
    expect(html).toContain('message-box')
    expect(html).toContain('badge-yes')
    expect(html).toContain('badge-no')
  })
})

describe('escapeHtml', () => {
  it('escapes all special characters', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#039;')
  })

  it('does not double-escape', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;')
  })
})
