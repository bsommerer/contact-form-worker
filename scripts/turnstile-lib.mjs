// Pure, side-effect-free logic for reconciling Cloudflare Turnstile widgets with
// the forms/*.json config. No network calls here — reconcile-turnstile.mjs wraps
// this with the actual Cloudflare API. Kept separate so the decision logic is
// fully unit-testable.

// Every widget we manage is named with this prefix. Only widgets carrying it are
// ever eligible for update/delete — hand-created widgets are never touched.
export const MANAGED_PREFIX = 'cfcf:'

export const widgetName = formId => `${MANAGED_PREFIX}${formId}`
export const formIdFromWidgetName = name =>
  typeof name === 'string' && name.startsWith(MANAGED_PREFIX) ? name.slice(MANAGED_PREFIX.length) : null

/** allowedOrigins -> deduped, sorted list of hostnames, excluding localhost/loopback. */
export function domainsFromAllowedOrigins(allowedOrigins = []) {
  const out = new Set()
  for (const origin of allowedOrigins) {
    // Subdomain wildcards ("https://*.example.com") register as the bare apex
    // hostname ("example.com"): Turnstile has no wildcard syntax but covers
    // every subdomain of a configured hostname automatically.
    const wildcard = String(origin).match(/^https?:\/\/\*\.(.+)$/i)
    let host
    if (wildcard) {
      host = wildcard[1].toLowerCase()
    } else {
      try {
        host = new URL(origin).hostname.toLowerCase()
      } catch {
        continue
      }
    }
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') continue
    if (host) out.add(host)
  }
  return [...out].sort()
}

const normDomains = d => [...new Set((d ?? []).map(x => String(x).toLowerCase()))].sort()
const sameDomains = (a, b) => {
  const na = normDomains(a)
  const nb = normDomains(b)
  return na.length === nb.length && na.every((v, i) => v === nb[i])
}

/**
 * Decide what to do with Turnstile widgets given the desired forms and the
 * widgets currently in the Cloudflare account. Pure function.
 *
 * Only widgets whose name carries the managed prefix (cfcf:) are ever considered
 * — unmanaged / hand-created widgets are IGNORED entirely (never read, updated
 * or deleted). A turnstile form without a managed widget always gets a fresh one.
 *
 * @param {{formId: string, domains: string[]}[]} desiredForms  forms with turnstile enabled
 * @param {{sitekey: string, name: string, domains: string[]}[]} existingWidgets
 * @returns {{create,update,keep,delete}} action lists
 */
export function planReconcile(desiredForms, existingWidgets) {
  // Consider only managed widgets; everything else is invisible to the planner.
  const managedWidgets = existingWidgets.filter(w => formIdFromWidgetName(w.name) !== null)
  const byName = new Map(managedWidgets.map(w => [w.name, w]))

  const create = []
  const update = []
  const keep = []

  // deterministic order
  const forms = [...desiredForms].sort((a, b) => a.formId.localeCompare(b.formId))

  for (const form of forms) {
    const name = widgetName(form.formId)
    const managed = byName.get(name)

    if (!managed) {
      create.push({ formId: form.formId, name, domains: normDomains(form.domains) })
    } else if (sameDomains(managed.domains, form.domains)) {
      keep.push({ formId: form.formId, sitekey: managed.sitekey })
    } else {
      update.push({ formId: form.formId, sitekey: managed.sitekey, name, domains: normDomains(form.domains) })
    }
  }

  // Orphans: managed widgets whose formId is no longer a desired form.
  const desiredIds = new Set(forms.map(f => f.formId))
  const del = managedWidgets
    .filter(w => !desiredIds.has(formIdFromWidgetName(w.name)))
    .map(w => ({ formId: formIdFromWidgetName(w.name), sitekey: w.sitekey, name: w.name }))

  return { create, update, keep, delete: del }
}
