export async function createCheckoutSession(userId: string): Promise<string | null> {
  try {
    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    const data = await res.json() as { url: string }
    return data.url ?? null
  } catch {
    return null
  }
}

export async function createPortalSession(userId: string): Promise<string | null> {
  try {
    const res = await fetch('/api/create-portal-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    const data = await res.json() as { url: string }
    return data.url ?? null
  } catch {
    return null
  }
}
