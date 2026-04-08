export async function verifyTurnstile(secret: string, token: string, ip: string | null): Promise<boolean> {
  const formData = new URLSearchParams()
  formData.append('secret', secret)
  formData.append('response', token)
  if (ip) formData.append('remoteip', ip)

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: formData,
  })

  const result = await response.json<{ success: boolean }>()
  return result.success
}
