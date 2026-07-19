// Generates src/forms.generated.ts from the JSON files in forms/.
//
// Each forms/<formId>.json becomes one entry in the exported FORMS map, keyed
// by its filename (without .json). An optional forms/_defaults.json is merged
// underneath every form, so shared values (e.g. a default fromAddress) live in
// exactly one place.
//
// Validation lives in ./forms-lib.mjs (unit-tested). On any error this script
// prints all problems and exits non-zero — that is what makes a "just add a
// JSON file" pull request safe to merge: CI runs this and blocks broken config.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildForms } from './forms-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FORMS_DIR = join(ROOT, 'forms')
const OUT_FILE = join(ROOT, 'src', 'forms.generated.ts')

function readJson(file) {
  return JSON.parse(readFileSync(join(FORMS_DIR, file), 'utf8'))
}

// --- Load defaults (optional) ---
let defaults = {}
if (existsSync(join(FORMS_DIR, '_defaults.json'))) {
  try {
    defaults = readJson('_defaults.json')
  } catch (err) {
    console.error(`✖ forms/_defaults.json ist kein gültiges JSON: ${err.message}`)
    process.exit(1)
  }
}

// --- Read every form file ---
const files = existsSync(FORMS_DIR)
  ? readdirSync(FORMS_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort()
  : []

if (files.length === 0) {
  console.error('✖ Keine Formular-Dateien in forms/ gefunden. Lege mindestens eine forms/<id>.json an.')
  process.exit(1)
}

const rawById = {}
const readErrors = []
for (const file of files) {
  try {
    rawById[basename(file, '.json')] = readJson(file)
  } catch (err) {
    readErrors.push(`${file}: kein gültiges JSON (${err.message})`)
  }
}

// --- Validate + merge ---
const { forms, errors } = buildForms(rawById, defaults)
const allErrors = [...readErrors, ...errors]

if (allErrors.length > 0) {
  console.error(`✖ ${allErrors.length} Fehler in forms/:\n${allErrors.map(e => `  ${e}`).join('\n')}`)
  process.exit(1)
}

// --- Emit generated TypeScript ---
const banner = `// AUTO-GENERATED von scripts/generate-forms.mjs — NICHT bearbeiten.\n// Quelle: forms/*.json  ·  Regenerieren: npm run generate\n`
const body = `import type { FormConfig } from './types'\n\nexport const FORMS: Record<string, FormConfig> = ${JSON.stringify(forms, null, 2)}\n`
writeFileSync(OUT_FILE, banner + '\n' + body)

console.log(`✔ ${Object.keys(forms).length} Formular(e) generiert → src/forms.generated.ts: ${Object.keys(forms).join(', ')}`)
