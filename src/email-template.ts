import type { FieldData, FieldType } from './types'

interface EmailData {
  fields: FieldData[]
  formName: string
  headerTitle: string
  turnstileVerified: boolean
  timestamp: Date
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function resolveFieldType(field: FieldData): FieldType {
  if (field.type) return field.type
  if (typeof field.value === 'boolean') return 'boolean'
  return 'text'
}

function renderField(field: FieldData): string {
  const type = resolveFieldType(field)

  // Skip empty fields (but not boolean false)
  if (type !== 'boolean' && (field.value === undefined || field.value === null || field.value === '')) {
    return ''
  }

  const label = `<div class="label">${escapeHtml(field.label)}</div>`

  switch (type) {
    case 'email': {
      const val = escapeHtml(String(field.value))
      return `<div class="field">${label}<div class="value"><a href="mailto:${val}" style="color: #06b6d4; text-decoration: none;">${val}</a></div></div>`
    }
    case 'phone': {
      const val = escapeHtml(String(field.value))
      return `<div class="field">${label}<div class="value"><a href="tel:${val}" style="color: #06b6d4; text-decoration: none;">${val}</a></div></div>`
    }
    case 'url': {
      const val = escapeHtml(String(field.value))
      return `<div class="field">${label}<div class="value"><a href="${val}" target="_blank" rel="noopener noreferrer" style="color: #06b6d4; text-decoration: none;">${val}</a></div></div>`
    }
    case 'textarea': {
      const val = escapeHtml(String(field.value))
      return `<div class="field">${label}<div class="message-box">${val}</div></div>`
    }
    case 'boolean': {
      const isTrue = field.value === true || field.value === 'true'
      const badgeClass = isTrue ? 'badge-yes' : 'badge-no'
      const text = isTrue ? 'Ja' : 'Nein'
      return `<div class="field">${label}<div class="value"><span class="${badgeClass}">${text}</span></div></div>`
    }
    case 'text':
    default: {
      const val = escapeHtml(String(field.value))
      return `<div class="field">${label}<div class="value">${val}</div></div>`
    }
  }
}

export function buildEmailHtml(data: EmailData): string {
  const time = data.timestamp.toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const renderedFields = data.fields.map(renderField).filter(Boolean).join('\n      ')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="light dark">
  <style>
    :root { color-scheme: light dark; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #334155; background-color: #f8fafc; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%); padding: 30px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 24px; font-weight: 600; }
    .header .source { color: rgba(255,255,255,0.85); font-size: 13px; margin-top: 6px; }
    .content { padding: 30px; }
    .field { margin-bottom: 20px; }
    .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; font-weight: 600; margin-bottom: 6px; }
    .value { font-size: 16px; color: #1e293b; padding: 12px; background: #f1f5f9; border-radius: 8px; border-left: 4px solid #06b6d4; overflow-wrap: break-word; word-break: break-word; }
    .message-box { background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 10px; white-space: pre-line; overflow-wrap: break-word; word-break: break-word; }
    .footer { padding: 20px; text-align: center; background: #f8fafc; color: #64748b; font-size: 12px; border-top: 1px solid #e2e8f0; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; margin-top: 10px; }
    .badge-verified { background: #dcfce7; color: #166534; }
    .badge-unverified { background: #fef3c7; color: #92400e; }
    .badge-yes { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; background: #dcfce7; color: #166534; }
    .badge-no { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; background: #fee2e2; color: #991b1b; }
    @media (prefers-color-scheme: dark) {
      body { background-color: #0f172a; color: #cbd5e1; }
      .container { background: #1e293b; box-shadow: 0 4px 6px rgba(0,0,0,0.4); }
      .content { color: #cbd5e1; }
      .value { background: #334155; color: #e2e8f0; border-left-color: #06b6d4; }
      .label { color: #94a3b8; }
      .message-box { background: #0f172a; border-color: #334155; color: #e2e8f0; }
      .footer { background: #0f172a; border-top-color: #334155; color: #94a3b8; }
      .badge-yes { background: #166534; color: #dcfce7; }
      .badge-no { background: #991b1b; color: #fee2e2; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${escapeHtml(data.headerTitle)}</h1>
      <div class="source">${escapeHtml(data.formName)}</div>
    </div>
    <div class="content">
      ${renderedFields}
      ${data.turnstileVerified
        ? '<div class="badge badge-verified">Verifiziert durch Cloudflare Turnstile</div>'
        : '<div class="badge badge-unverified">Ohne Turnstile-Verifizierung</div>'
      }
    </div>
    <div class="footer">
      Eingegangen am ${escapeHtml(time)}
    </div>
  </div>
</body>
</html>`
}
