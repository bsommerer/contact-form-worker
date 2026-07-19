import { describe, it, expect } from 'vitest'
import {
  MANAGED_PREFIX,
  widgetName,
  formIdFromWidgetName,
  domainsFromAllowedOrigins,
  planReconcile,
} from './turnstile-lib.mjs'

describe('widgetName / formIdFromWidgetName', () => {
  it('round-trips a formId through the managed name', () => {
    expect(widgetName('kunde-xy')).toBe('cfcf:kunde-xy')
    expect(formIdFromWidgetName('cfcf:kunde-xy')).toBe('kunde-xy')
  })
  it('returns null for unmanaged names', () => {
    expect(formIdFromWidgetName('My hand-made widget')).toBeNull()
    expect(formIdFromWidgetName(undefined)).toBeNull()
  })
  it('exposes the prefix', () => {
    expect(MANAGED_PREFIX).toBe('cfcf:')
  })
})

describe('domainsFromAllowedOrigins', () => {
  it('extracts hostnames, drops localhost/loopback, dedupes and sorts', () => {
    expect(
      domainsFromAllowedOrigins([
        'https://b.de',
        'https://a.de',
        'https://a.de',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
        'http://[::1]:8080',
      ]),
    ).toEqual(['a.de', 'b.de'])
  })
  it('handles www and subdomains as distinct hosts', () => {
    expect(domainsFromAllowedOrigins(['https://x.de', 'https://www.x.de'])).toEqual(['www.x.de', 'x.de'])
  })
  it('ignores malformed origins', () => {
    expect(domainsFromAllowedOrigins(['not a url', 'https://ok.de'])).toEqual(['ok.de'])
  })
  it('returns [] for only-localhost origins', () => {
    expect(domainsFromAllowedOrigins(['http://localhost:1234'])).toEqual([])
  })
  it('registers a subdomain wildcard as its bare apex hostname', () => {
    // Turnstile covers subdomains of a configured hostname automatically, so the
    // "*." wildcard maps to the plain apex domain.
    expect(domainsFromAllowedOrigins(['https://*.bs-it-services.workers.dev'])).toEqual([
      'bs-it-services.workers.dev',
    ])
  })
  it('dedupes a wildcard apex against an explicit origin on the same host', () => {
    expect(
      domainsFromAllowedOrigins(['https://*.example.com', 'https://example.com', 'https://www.example.com']),
    ).toEqual(['example.com', 'www.example.com'])
  })
})

describe('planReconcile', () => {
  const form = (formId, domains) => ({ formId, domains })
  const widget = (sitekey, name, domains) => ({ sitekey, name, domains })

  it('creates a widget for a new turnstile form', () => {
    const plan = planReconcile([form('neu', ['neu.de'])], [])
    expect(plan.create).toEqual([{ formId: 'neu', name: 'cfcf:neu', domains: ['neu.de'] }])
    expect(plan.delete).toEqual([])
  })

  it('keeps an already-managed widget with matching domains', () => {
    const plan = planReconcile([form('a', ['a.de'])], [widget('0xAAA', 'cfcf:a', ['a.de'])])
    expect(plan.keep).toEqual([{ formId: 'a', sitekey: '0xAAA' }])
    expect(plan.create).toEqual([])
    expect(plan.update).toEqual([])
  })

  it('updates domains on a managed widget when allowedOrigins changed', () => {
    const plan = planReconcile([form('a', ['a.de', 'www.a.de'])], [widget('0xAAA', 'cfcf:a', ['a.de'])])
    expect(plan.update).toEqual([
      { formId: 'a', sitekey: '0xAAA', name: 'cfcf:a', domains: ['a.de', 'www.a.de'] },
    ])
    expect(plan.keep).toEqual([])
  })

  it('IGNORES unmanaged widgets and creates a fresh managed one (no adoption)', () => {
    // An existing hand-made widget on the same domain must NOT be touched;
    // a new cfcf: widget is created instead.
    const plan = planReconcile(
      [form('bs-itservices', ['bs-itservices.de'])],
      [widget('0xOLD', 'BS IT Services', ['bs-itservices.de'])],
    )
    expect(plan.create).toEqual([{ formId: 'bs-itservices', name: 'cfcf:bs-itservices', domains: ['bs-itservices.de'] }])
    expect(plan.update).toEqual([])
    expect(plan.keep).toEqual([])
    // the unmanaged widget is neither adopted nor deleted
    expect(plan.delete).toEqual([])
  })

  it('never touches unmanaged widgets for deletion', () => {
    const plan = planReconcile([], [widget('0x1', 'Some hand-made widget', ['x.de'])])
    expect(plan.delete).toEqual([])
  })

  it('marks a managed widget as orphaned when its form is gone', () => {
    const plan = planReconcile([], [widget('0xA', 'cfcf:removed', ['removed.de'])])
    expect(plan.delete).toEqual([{ formId: 'removed', sitekey: '0xA', name: 'cfcf:removed' }])
  })

  it('keeps a managed widget even if an unmanaged widget shares its domains', () => {
    const plan = planReconcile(
      [form('a', ['a.de'])],
      [widget('0xMAN', 'cfcf:a', ['a.de']), widget('0xUN', 'hand-made', ['a.de'])],
    )
    expect(plan.keep).toEqual([{ formId: 'a', sitekey: '0xMAN' }])
    expect(plan.create).toEqual([])
  })
})
