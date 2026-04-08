interface EmailData {
  name: string
  email: string
  phone?: string
  message: string
  formName: string
  turnstileVerified: boolean
  timestamp: Date
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
    .value { font-size: 16px; color: #1e293b; padding: 12px; background: #f1f5f9; border-radius: 8px; border-left: 4px solid #06b6d4; }
    .message-box { background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 10px; white-space: pre-line; }
    .footer { padding: 20px; text-align: center; background: #f8fafc; color: #64748b; font-size: 12px; border-top: 1px solid #e2e8f0; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; margin-top: 10px; }
    .badge-verified { background: #dcfce7; color: #166534; }
    .badge-unverified { background: #fef3c7; color: #92400e; }
    @media (prefers-color-scheme: dark) {
      body { background-color: #0f172a; color: #cbd5e1; }
      .container { background: #1e293b; box-shadow: 0 4px 6px rgba(0,0,0,0.4); }
      .content { color: #cbd5e1; }
      .value { background: #334155; color: #e2e8f0; border-left-color: #06b6d4; }
      .label { color: #94a3b8; }
      .message-box { background: #0f172a; border-color: #334155; color: #e2e8f0; }
      .footer { background: #0f172a; border-top-color: #334155; color: #94a3b8; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Neue Kontaktanfrage</h1>
      <div class="source">${escapeHtml(data.formName)}</div>
    </div>
    <div class="content">
      <div class="field">
        <div class="label">Name</div>
        <div class="value">${escapeHtml(data.name)}</div>
      </div>
      <div class="field">
        <div class="label">E-Mail</div>
        <div class="value"><a href="mailto:${escapeHtml(data.email)}" style="color: #06b6d4; text-decoration: none;">${escapeHtml(data.email)}</a></div>
      </div>
      ${data.phone ? `
      <div class="field">
        <div class="label">Telefon</div>
        <div class="value"><a href="tel:${escapeHtml(data.phone)}" style="color: #06b6d4; text-decoration: none;">${escapeHtml(data.phone)}</a></div>
      </div>
      ` : ''}
      <div class="field">
        <div class="label">Nachricht</div>
        <div class="message-box">${escapeHtml(data.message)}</div>
      </div>
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
