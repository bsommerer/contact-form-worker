// Pure, side-effect-free validation + merge logic for form configs.
// Kept separate from generate-forms.mjs (which does file IO) so it can be unit-tested.

export const ALLOWED_KEYS = [
  'recipients',
  'fromName',
  'fromAddress',
  'allowedOrigins',
  'headerTitle',
  'defaultSubject',
  'turnstile',
]

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
export const FORM_ID_RE = /^[a-z0-9][a-z0-9-]*$/

const isNonEmptyString = v => typeof v === 'string' && v.trim().length > 0
const allowed = new Set(ALLOWED_KEYS)

/** Validates a single (already merged) form config. Returns an array of error strings. */
export function validateForm(formId, cfg) {
  const errors = []
  const fail = msg => errors.push(msg)

  if (!FORM_ID_RE.test(formId)) {
    fail(`ungültige formId "${formId}" (nur a-z, 0-9, Bindestrich; muss mit Buchstabe/Ziffer beginnen)`)
  }
  if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) {
    return [`Inhalt muss ein JSON-Objekt sein`]
  }

  for (const key of Object.keys(cfg)) {
    if (!allowed.has(key)) fail(`unbekanntes Feld "${key}" (Tippfehler? Erlaubt: ${ALLOWED_KEYS.join(', ')})`)
  }

  if (!Array.isArray(cfg.recipients) || cfg.recipients.length === 0) {
    fail('recipients muss ein nicht-leeres Array sein')
  } else {
    for (const r of cfg.recipients) {
      if (!isNonEmptyString(r) || !EMAIL_RE.test(r)) fail(`recipients enthält keine gültige E-Mail: ${JSON.stringify(r)}`)
    }
  }

  if (!isNonEmptyString(cfg.fromName)) fail('fromName fehlt oder ist leer')

  if (!isNonEmptyString(cfg.fromAddress)) {
    fail('fromAddress fehlt (in der Datei oder in forms/_defaults.json setzen)')
  } else if (!EMAIL_RE.test(cfg.fromAddress)) {
    fail(`fromAddress ist keine gültige E-Mail: ${JSON.stringify(cfg.fromAddress)}`)
  }

  if (!Array.isArray(cfg.allowedOrigins) || cfg.allowedOrigins.length === 0) {
    fail('allowedOrigins muss ein nicht-leeres Array sein')
  } else {
    for (const o of cfg.allowedOrigins) {
      if (!isNonEmptyString(o) || !/^https?:\/\//.test(o)) fail(`allowedOrigins enthält keinen gültigen Origin (http:// oder https://): ${JSON.stringify(o)}`)
    }
  }

  if (cfg.headerTitle !== undefined && !isNonEmptyString(cfg.headerTitle)) fail('headerTitle muss ein nicht-leerer String sein')
  if (cfg.defaultSubject !== undefined && !isNonEmptyString(cfg.defaultSubject)) fail('defaultSubject muss ein nicht-leerer String sein')
  if (cfg.turnstile !== undefined && typeof cfg.turnstile !== 'boolean') fail('turnstile muss true oder false sein')

  return errors
}

/**
 * Merges defaults into each raw form, validates all, and returns the compiled map.
 * @param {Record<string, object>} rawById  formId -> raw parsed JSON
 * @param {object} defaults                  values applied underneath every form
 * @returns {{ forms: Record<string, object>, errors: string[] }}
 */
export function buildForms(rawById, defaults = {}) {
  const forms = {}
  const errors = []
  for (const formId of Object.keys(rawById).sort()) {
    const raw = rawById[formId]
    const cfg = { turnstile: false, ...defaults, ...raw }
    // allowedOrigins from _defaults apply to EVERY form (e.g. a shared
    // *.workers.dev origin): union the default and per-form lists rather than
    // letting the per-form list replace the defaults.
    const defaultOrigins = Array.isArray(defaults.allowedOrigins) ? defaults.allowedOrigins : []
    const rawOrigins = Array.isArray(raw?.allowedOrigins) ? raw.allowedOrigins : []
    if (defaultOrigins.length || rawOrigins.length) {
      cfg.allowedOrigins = [...new Set([...rawOrigins, ...defaultOrigins])]
    }
    const formErrors = validateForm(formId, cfg)
    if (formErrors.length > 0) {
      for (const e of formErrors) errors.push(`${formId}.json: ${e}`)
    } else {
      forms[formId] = cfg
    }
  }
  return { forms, errors }
}
