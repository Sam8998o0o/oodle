// ── Stripe client helpers ─────────────────────────────────

// Creates a Stripe Checkout session and returns the redirect URL.
// Returns null on failure.
export async function createCheckoutSession(userId: string): Promise<string | null> {
  try {
    const res = await fetch('/api/create-checkout-session', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ userId }),
    })
    if (!res.ok) return null
    const data = await res.json() as { url?: string }
    return data.url ?? null
  } catch {
    return null
  }
}

// Opens the Stripe Customer Portal for managing subscriptions.
// Returns null on failure.
export async function createPortalSession(userId: string): Promise<string | null> {
  try {
    const res = await fetch('/api/create-portal-session', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ userId }),
    })
    if (!res.ok) return null
    const data = await res.json() as { url?: string }
    return data.url ?? null
  } catch {
    return null
  }
}
