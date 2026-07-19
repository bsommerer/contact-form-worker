// Reconciles Cloudflare Turnstile widgets with the forms/*.json config.
//
// For every form with "turnstile": true it ensures a managed widget (named
// "cfcf:<formId>") exists in the Cloudflare account, then builds the sitekey and
// secret maps for the worker. Secrets are read straight from Cloudflare — they
// are NEVER stored in git or GitHub, and are masked out of the logs.
//
//   node scripts/reconcile-turnstile.mjs            # dry-run: print the plan only
//   node scripts/reconcile-turnstile.mjs --apply    # create/adopt/update widgets
//   node scripts/reconcile-turnstile.mjs --apply --allow-delete   # also delete orphans
//
// Env:
//   CLOUDFLARE_API_TOKEN   (required)  token with Turnstile:Edit (+ Account:Read)
//   CLOUDFLARE_ACCOUNT_ID  (optional)  auto-detected if the token sees exactly one account
//   TURNSTILE_SECRETS_OUT  (optional)  path to write the secrets map JSON (default ./turnstile-secrets.json)
//   TURNSTILE_SITEKEYS_OUT (optional)  path to write the sitekeys map JSON (default ./turnstile-sitekeys.json)
//   RECONCILE_SUMMARY_OUT  (optional)  path to write a public summary JSON (created widgets + sitekeys)

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildForms } from './forms-lib.mjs'
import { domainsFromAllowedOrigins, planReconcile, widgetName } from './turnstile-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FORMS_DIR = join(ROOT, 'forms')
const API = 'https://api.cloudflare.com/client/v4'

const APPLY = process.argv.includes('--apply')
const ALLOW_DELETE = process.argv.includes('--allow-delete')
const TOKEN = process.env.CLOUDFLARE_API_TOKEN
const SECRETS_OUT = process.env.TURNSTILE_SECRETS_OUT || join(ROOT, 'turnstile-secrets.json')
const SITEKEYS_OUT = process.env.TURNSTILE_SITEKEYS_OUT || join(ROOT, 'turnstile-sitekeys.json')
const SUMMARY_OUT = process.env.RECONCILE_SUMMARY_OUT || ''

function die(msg) {
  console.error(`✖ ${msg}`)
  process.exit(1)
}
const mask = secret => console.log(`::add-mask::${secret}`)

async function cf(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.success === false) {
    const errs = (json.errors || []).map(e => e.message).join('; ')
    throw new Error(`CF ${method} ${path} → ${res.status} ${errs || ''}`.trim())
  }
  return json.result
}

async function resolveAccountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID
  const accounts = await cf('GET', '/accounts?per_page=50')
  if (!Array.isArray(accounts) || accounts.length === 0) die('Token sieht keine Accounts — CLOUDFLARE_ACCOUNT_ID setzen.')
  if (accounts.length > 1) die(`Token sieht mehrere Accounts — CLOUDFLARE_ACCOUNT_ID explizit setzen (${accounts.map(a => a.id).join(', ')}).`)
  return accounts[0].id
}

async function listWidgets(accountId) {
  const widgets = []
  let page = 1
  for (;;) {
    const res = await fetch(`${API}/accounts/${accountId}/challenges/widgets?per_page=50&page=${page}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.success === false) throw new Error(`CF list widgets → ${res.status}`)
    for (const w of json.result || []) widgets.push({ sitekey: w.sitekey, name: w.name, domains: w.domains || [] })
    const info = json.result_info || {}
    if (!info.total_count || page * (info.per_page || 50) >= info.total_count) break
    page++
  }
  return widgets
}

// --- Load desired forms (turnstile-enabled) ---
function readForms() {
  let defaults = {}
  if (existsSync(join(FORMS_DIR, '_defaults.json'))) defaults = JSON.parse(readFileSync(join(FORMS_DIR, '_defaults.json'), 'utf8'))
  const raw = {}
  for (const f of readdirSync(FORMS_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'))) {
    raw[basename(f, '.json')] = JSON.parse(readFileSync(join(FORMS_DIR, f), 'utf8'))
  }
  const { forms, errors } = buildForms(raw, defaults)
  if (errors.length) die(`Ungültige Formulare:\n${errors.join('\n')}`)
  return Object.entries(forms)
    .filter(([, c]) => c.turnstile === true)
    .map(([formId, c]) => ({ formId, domains: domainsFromAllowedOrigins(c.allowedOrigins) }))
}

async function main() {
  if (!TOKEN) die('CLOUDFLARE_API_TOKEN fehlt.')
  const desiredForms = readForms()
  const accountId = await resolveAccountId()
  const existing = await listWidgets(accountId)
  const plan = planReconcile(desiredForms, existing, { allowAdopt: true })

  // --- Print plan (no secrets) ---
  console.log(`Turnstile Reconcile (${APPLY ? 'APPLY' : 'DRY-RUN'})  account=${accountId}`)
  console.log(`  turnstile-Formulare: ${desiredForms.length}, Widgets im Account: ${existing.length}`)
  for (const c of plan.create) console.log(`  + CREATE ${c.name}  domains=[${c.domains.join(', ')}]`)
  for (const a of plan.adopt) console.log(`  ~ ADOPT  "${a.fromName}" → ${a.name}  domains=[${a.domains.join(', ')}]`)
  for (const u of plan.update) console.log(`  ± UPDATE ${u.name}  domains=[${u.domains.join(', ')}]`)
  for (const k of plan.keep) console.log(`  = KEEP   cfcf:${k.formId}`)
  for (const d of plan.delete) console.log(`  - ORPHAN ${d.name}${ALLOW_DELETE ? ' (wird gelöscht)' : ' (bleibt; --allow-delete zum Entfernen)'}`)

  if (!APPLY) {
    console.log('\nDry-run: keine Änderungen vorgenommen.')
    return
  }

  // --- Apply mutations, collecting sitekey+secret per formId ---
  const secrets = {} // formId -> secret
  const sitekeys = {} // formId -> sitekey
  const created = [] // {formId, sitekey} for the PR comment

  const capture = (formId, sitekey, secret) => {
    mask(secret)
    secrets[formId] = secret
    sitekeys[formId] = sitekey
  }

  for (const c of plan.create) {
    const w = await cf('POST', `/accounts/${accountId}/challenges/widgets`, { name: c.name, domains: c.domains, mode: 'managed' })
    capture(c.formId, w.sitekey, w.secret)
    created.push({ formId: c.formId, sitekey: w.sitekey })
    console.log(`  ✓ created ${c.name}  sitekey=${w.sitekey}`)
  }
  for (const a of plan.adopt) {
    await cf('PUT', `/accounts/${accountId}/challenges/widgets/${a.sitekey}`, { name: a.name, domains: a.domains, mode: 'managed' })
    const w = await cf('GET', `/accounts/${accountId}/challenges/widgets/${a.sitekey}`)
    capture(a.formId, w.sitekey, w.secret)
    console.log(`  ✓ adopted "${a.fromName}" → ${a.name}  sitekey=${w.sitekey}`)
  }
  for (const u of plan.update) {
    await cf('PUT', `/accounts/${accountId}/challenges/widgets/${u.sitekey}`, { name: u.name, domains: u.domains, mode: 'managed' })
    const w = await cf('GET', `/accounts/${accountId}/challenges/widgets/${u.sitekey}`)
    capture(u.formId, w.sitekey, w.secret)
    console.log(`  ✓ updated ${u.name}`)
  }
  for (const k of plan.keep) {
    const w = await cf('GET', `/accounts/${accountId}/challenges/widgets/${k.sitekey}`)
    capture(k.formId, w.sitekey, w.secret)
  }
  if (ALLOW_DELETE) {
    for (const d of plan.delete) {
      await cf('DELETE', `/accounts/${accountId}/challenges/widgets/${d.sitekey}`)
      console.log(`  ✓ deleted orphan ${d.name}`)
    }
  }

  // --- Write outputs ---
  writeFileSync(SECRETS_OUT, JSON.stringify(secrets))
  writeFileSync(SITEKEYS_OUT, JSON.stringify(sitekeys))
  if (SUMMARY_OUT) writeFileSync(SUMMARY_OUT, JSON.stringify({ created, sitekeys }, null, 2))

  console.log(`\n✔ ${Object.keys(secrets).length} Widget(s) synchronisiert.`)
  console.log('Sitekeys (öffentlich):')
  for (const [id, sk] of Object.entries(sitekeys)) console.log(`  ${id}: ${sk}`)
}

main().catch(err => die(err.message))
