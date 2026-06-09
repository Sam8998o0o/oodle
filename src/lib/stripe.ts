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

export type CoinPackage = 'coins_50' | 'coins_150' | 'coins_350'

export async function createCoinsCheckoutSession(
  userId: string,
  petId: string,
  pkg: CoinPackage,
): Promise<string | null> {
  try {
    const res = await fetch('/api/create-coins-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, petId, package: pkg }),
    })
    const data = await res.json() as { url: string }
    return data.url ?? null
  } catch {
    return null
  }
}
