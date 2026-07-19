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
})

describe('planReconcile', () => {
  const form = (formId, domains) => ({ formId, domains })
  const widget = (sitekey, name, domains) => ({ sitekey, name, domains })

  it('creates a widget for a new turnstile form', () => {
    const plan = planReconcile([form('neu', ['neu.de'])], [])
    expect(plan.create).toEqual([{ formId: 'neu', name: 'cfcf:neu', domains: ['neu.de'] }])
    expect(plan.adopt).toEqual([])
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

  it('adopts a single unmanaged widget that covers the form domains (safe migration)', () => {
    const plan = planReconcile(
      [form('bs-itservices', ['bs-itservices.de'])],
      [widget('0xOLD', 'BS IT Services', ['bs-itservices.de', 'localhost'])],
    )
    expect(plan.adopt).toEqual([
      {
        formId: 'bs-itservices',
        sitekey: '0xOLD',
        fromName: 'BS IT Services',
        name: 'cfcf:bs-itservices',
        domains: ['bs-itservices.de'],
        domainsChanged: true,
      },
    ])
    expect(plan.create).toEqual([])
  })

  it('does NOT adopt when multiple unmanaged widgets match (ambiguous → create)', () => {
    const plan = planReconcile(
      [form('a', ['a.de'])],
      [widget('0x1', 'w1', ['a.de']), widget('0x2', 'w2', ['a.de'])],
    )
    expect(plan.adopt).toEqual([])
    expect(plan.create).toEqual([{ formId: 'a', name: 'cfcf:a', domains: ['a.de'] }])
  })

  it('does NOT adopt an unmanaged widget that does not cover all form domains', () => {
    const plan = planReconcile([form('a', ['a.de', 'www.a.de'])], [widget('0x1', 'w1', ['a.de'])])
    expect(plan.adopt).toEqual([])
    expect(plan.create.length).toBe(1)
  })

  it('never touches unmanaged widgets for deletion', () => {
    const plan = planReconcile([], [widget('0x1', 'Some hand-made widget', ['x.de'])])
    expect(plan.delete).toEqual([])
  })

  it('marks a managed widget as orphaned when its form is gone', () => {
    const plan = planReconcile([], [widget('0xA', 'cfcf:removed', ['removed.de'])])
    expect(plan.delete).toEqual([{ formId: 'removed', sitekey: '0xA', name: 'cfcf:removed' }])
  })

  it('respects allowAdopt=false (always create)', () => {
    const plan = planReconcile([form('a', ['a.de'])], [widget('0x1', 'w1', ['a.de'])], { allowAdopt: false })
    expect(plan.adopt).toEqual([])
    expect(plan.create.length).toBe(1)
  })

  it('does not adopt the same widget for two forms', () => {
    // both forms could match the same widget by domain; only the first (sorted) adopts it
    const plan = planReconcile(
      [form('a', ['shared.de']), form('b', ['shared.de'])],
      [widget('0xS', 'shared widget', ['shared.de'])],
    )
    const adoptedSitekeys = plan.adopt.map(a => a.sitekey)
    expect(adoptedSitekeys).toEqual(['0xS'])
    // the other form must be created, not double-adopting the same sitekey
    expect(plan.create.length).toBe(1)
  })
})
