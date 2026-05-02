export interface PetCoords {
  eyes:     { x: number; y: number }[]
  legs:     { x: number; y: number }[]
  center:   { x: number; y: number }
  has_eyes: boolean
  has_legs: boolean
}

const DEFAULT_COORDS: PetCoords = {
  eyes:     [{ x: 0.35, y: 0.28 }, { x: 0.65, y: 0.28 }],
  legs:     [{ x: 0.25, y: 0.85 }, { x: 0.45, y: 0.85 },
             { x: 0.55, y: 0.85 }, { x: 0.75, y: 0.85 }],
  center:   { x: 0.5, y: 0.5 },
  has_eyes: false,
  has_legs: false,
}

export async function recognizePet(imageDataURL: string): Promise<PetCoords> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const res = await fetch('/api/recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageDataURL }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) return DEFAULT_COORDS

    const data = await res.json() as PetCoords
    return data
  } catch {
    return DEFAULT_COORDS
  }
}
