interface EmailData {
  name: string
  email: string
  phone?: string
  message: string
}

export function buildEmailHtml(data: EmailData): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #334155; background-color: #f8fafc; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%); padding: 30px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 24px; font-weight: 600; }
    .content { padding: 30px; }
    .field { margin-bottom: 20px; }
    .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; font-weight: 600; margin-bottom: 6px; }
    .value { font-size: 16px; color: #1e293b; padding: 12px; background: #f1f5f9; border-radius: 8px; border-left: 4px solid #06b6d4; }
    .message-box { background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin-top: 10px; }
    .footer { padding: 20px; text-align: center; background: #f8fafc; color: #64748b; font-size: 12px; border-top: 1px solid #e2e8f0; }
    .badge { display: inline-block; background: #dcfce7; color: #166534; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Neue Kontaktanfrage</h1>
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
        <div class="message-box">${escapeHtml(data.message).replace(/\\n/g, '<br>')}</div>
      </div>
      <div class="badge">Verifiziert durch Cloudflare Turnstile</div>
    </div>
    <div class="footer">
      Gesendet über das Kontaktformular
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
