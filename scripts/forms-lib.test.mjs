import { describe, it, expect } from 'vitest'
import { validateForm, buildForms } from './forms-lib.mjs'

const valid = {
  recipients: ['info@example.com'],
  fromName: 'Example',
  fromAddress: 'noreply@example.com',
  allowedOrigins: ['https://example.com'],
}

describe('validateForm', () => {
  it('accepts a minimal valid config', () => {
    expect(validateForm('example', valid)).toEqual([])
  })

  it('accepts all optional fields', () => {
    const errors = validateForm('example', {
      ...valid,
      headerTitle: 'Neue Anfrage',
      defaultSubject: 'Anfrage',
      turnstile: true,
    })
    expect(errors).toEqual([])
  })

  // --- formId ---
  it('rejects an invalid formId', () => {
    expect(validateForm('Bad_ID', valid).join()).toMatch(/ungültige formId/)
  })

  it('rejects a formId starting with a hyphen', () => {
    expect(validateForm('-x', valid).join()).toMatch(/ungültige formId/)
  })

  // --- recipients ---
  it('rejects missing recipients', () => {
    const { recipients, ...rest } = valid
    expect(validateForm('example', rest).join()).toMatch(/recipients/)
  })

  it('rejects an empty recipients array', () => {
    expect(validateForm('example', { ...valid, recipients: [] }).join()).toMatch(/recipients/)
  })

  it('rejects a non-email recipient', () => {
    expect(validateForm('example', { ...valid, recipients: ['not-an-email'] }).join()).toMatch(/gültige E-Mail/)
  })

  // --- fromAddress / fromName ---
  it('rejects a missing fromAddress', () => {
    const { fromAddress, ...rest } = valid
    expect(validateForm('example', rest).join()).toMatch(/fromAddress fehlt/)
  })

  it('rejects an invalid fromAddress', () => {
    expect(validateForm('example', { ...valid, fromAddress: 'nope' }).join()).toMatch(/fromAddress ist keine/)
  })

  it('rejects a missing fromName', () => {
    const { fromName, ...rest } = valid
    expect(validateForm('example', rest).join()).toMatch(/fromName/)
  })

  // --- allowedOrigins ---
  it('rejects an origin without scheme', () => {
    expect(validateForm('example', { ...valid, allowedOrigins: ['example.com'] }).join()).toMatch(/gültigen Origin/)
  })

  // --- unknown keys (typo protection) ---
  it('rejects unknown fields (catches typos)', () => {
    expect(validateForm('example', { ...valid, turnstil: true }).join()).toMatch(/unbekanntes Feld "turnstil"/)
  })

  // --- turnstile ---
  it('rejects a non-boolean turnstile', () => {
    expect(validateForm('example', { ...valid, turnstile: 'yes' }).join()).toMatch(/turnstile muss/)
  })
})

describe('buildForms', () => {
  it('merges _defaults underneath each form', () => {
    const { forms, errors } = buildForms(
      { a: { recipients: ['a@x.de'], fromName: 'A', allowedOrigins: ['https://a.de'] } },
      { fromAddress: 'noreply@bsitservices.de' },
    )
    expect(errors).toEqual([])
    expect(forms.a.fromAddress).toBe('noreply@bsitservices.de')
  })

  it('lets a form override a default', () => {
    const { forms } = buildForms(
      { a: { ...valid, fromAddress: 'custom@x.de' } },
      { fromAddress: 'noreply@bsitservices.de' },
    )
    expect(forms.a.fromAddress).toBe('custom@x.de')
  })

  it('defaults turnstile to false when unset', () => {
    const { forms } = buildForms({ a: valid })
    expect(forms.a.turnstile).toBe(false)
  })

  it('collects errors per file and omits invalid forms', () => {
    const { forms, errors } = buildForms({
      good: valid,
      bad: { recipients: [], fromName: 'B', fromAddress: 'noreply@x.de', allowedOrigins: ['https://b.de'] },
    })
    expect(forms.good).toBeDefined()
    expect(forms.bad).toBeUndefined()
    expect(errors.join()).toMatch(/^bad\.json:/)
  })
})
