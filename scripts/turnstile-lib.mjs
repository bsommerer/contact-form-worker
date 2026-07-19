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
    let host
    try {
      host = new URL(origin).hostname.toLowerCase()
    } catch {
      continue
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
// true if every domain the form needs is already covered by the widget
const covers = (widgetDomains, formDomains) => {
  const set = new Set(normDomains(widgetDomains))
  return normDomains(formDomains).every(d => set.has(d))
}

/**
 * Decide what to do with Turnstile widgets given the desired forms and the
 * widgets currently in the Cloudflare account. Pure function.
 *
 * @param {{formId: string, domains: string[]}[]} desiredForms  forms with turnstile enabled
 * @param {{sitekey: string, name: string, domains: string[]}[]} existingWidgets
 * @param {{allowAdopt?: boolean}} opts
 * @returns {{create,update,adopt,keep,delete}} action lists
 */
export function planReconcile(desiredForms, existingWidgets, opts = {}) {
  const allowAdopt = opts.allowAdopt !== false
  const byName = new Map(existingWidgets.map(w => [w.name, w]))
  const usedSitekeys = new Set()

  const create = []
  const update = []
  const adopt = []
  const keep = []

  // deterministic order
  const forms = [...desiredForms].sort((a, b) => a.formId.localeCompare(b.formId))

  for (const form of forms) {
    const name = widgetName(form.formId)
    const managed = byName.get(name)

    if (managed) {
      usedSitekeys.add(managed.sitekey)
      if (sameDomains(managed.domains, form.domains)) {
        keep.push({ formId: form.formId, sitekey: managed.sitekey })
      } else {
        update.push({ formId: form.formId, sitekey: managed.sitekey, name, domains: normDomains(form.domains) })
      }
      continue
    }

    // No managed widget yet. Try to adopt an unmanaged one that already covers
    // this form's domains (safe migration of hand-created widgets) — only if
    // exactly one unambiguous candidate exists.
    if (allowAdopt) {
      const candidates = existingWidgets.filter(
        w =>
          formIdFromWidgetName(w.name) === null &&
          !usedSitekeys.has(w.sitekey) &&
          form.domains.length > 0 &&
          covers(w.domains, form.domains),
      )
      if (candidates.length === 1) {
        const w = candidates[0]
        usedSitekeys.add(w.sitekey)
        adopt.push({
          formId: form.formId,
          sitekey: w.sitekey,
          fromName: w.name,
          name,
          domains: normDomains(form.domains),
          domainsChanged: !sameDomains(w.domains, form.domains),
        })
        continue
      }
    }

    create.push({ formId: form.formId, name, domains: normDomains(form.domains) })
  }

  // Orphans: managed widgets whose formId is no longer a desired form.
  const desiredIds = new Set(forms.map(f => f.formId))
  const del = existingWidgets
    .filter(w => {
      const id = formIdFromWidgetName(w.name)
      return id !== null && !desiredIds.has(id)
    })
    .map(w => ({ formId: formIdFromWidgetName(w.name), sitekey: w.sitekey, name: w.name }))

  return { create, update, adopt, keep, delete: del }
}
