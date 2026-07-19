interface SnippetOptions {
  formId: string
  workerUrl: string
  turnstile: boolean
  sitekey: string | null
}

/**
 * Generates a copy-paste HTML+JS snippet that calls the worker for a given form
 * (standard contact-form mode: name / email / phone / message + honeypot).
 * If the form has Turnstile enabled, the widget and token handling are included.
 */
export function buildSnippet({ formId, workerUrl, turnstile, sitekey }: SnippetOptions): string {
  const turnstileScript = turnstile
    ? '\n<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : ''
  const turnstileWidget = turnstile
    ? `\n  <div class="cf-turnstile" data-sitekey="${sitekey ?? 'YOUR_SITEKEY'}"></div>`
    : ''
  const tokenHandling = turnstile
    ? `
    // Turnstile injects a hidden "cf-turnstile-response" field — map it to turnstileToken
    data.turnstileToken = data['cf-turnstile-response'];
    delete data['cf-turnstile-response'];`
    : ''

  return `<!-- Kontaktformular für "${formId}" -->
<form id="contact-form-${formId}">
  <input name="name" required placeholder="Name">
  <input name="email" type="email" required placeholder="E-Mail">
  <input name="phone" placeholder="Telefon (optional)">
  <textarea name="message" required placeholder="Nachricht"></textarea>
  <!-- Honeypot: muss leer bleiben (nicht entfernen) -->
  <input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">${turnstileWidget}
  <button type="submit">Senden</button>
</form>${turnstileScript}
<script>
  const form = document.getElementById('contact-form-${formId}');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));${tokenHandling}
    const res = await fetch('${workerUrl}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formId: '${formId}', ...data }),
    });
    if (res.ok) { form.reset(); alert('Danke für deine Nachricht!'); }
    else { alert('Senden fehlgeschlagen. Bitte später erneut versuchen.'); }
  });
</script>`
}
