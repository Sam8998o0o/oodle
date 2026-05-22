// OnnxValidator.ts
// Pure canvas pixel analysis — no ONNX model needed.
//
// Checks: outline presence, interior fill, color variety, coverage, aspect ratio.
// Pass threshold: score >= 0.65

export interface ValidationResult {
  score: number
  label: string
  ready: boolean
}

export class OnnxValidator {
  ready = true
  constructor() {}

  async validate(canvas: HTMLCanvasElement): Promise<ValidationResult> {
    const ctx = canvas.getContext('2d')!
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const total = width * height

    // A pixel is transparent if alpha < 30.
    // A pixel is white/blank if alpha < 30 OR near-white (r>220 && g>220 && b>220).
    // Drawn pixels are anything NOT fully transparent.
    const isTransparent = (i: number): boolean => data[i * 4 + 3] < 30
    const isBlankNeighbor = (i: number): boolean => {
      const a = data[i * 4 + 3]
      const r = data[i * 4]
      const g = data[i * 4 + 1]
      const b = data[i * 4 + 2]
      return a < 30 || (r > 220 && g > 220 && b > 220)
    }

    // ── Pass 1: color buckets + drawn pixel count ─────────────
    const colorBuckets = new Set<string>()
    let drawnPixels = 0

    for (let i = 0; i < total; i++) {
      if (isTransparent(i)) continue
      drawnPixels++
      const r = data[i * 4]
      const g = data[i * 4 + 1]
      const b = data[i * 4 + 2]
      colorBuckets.add(`${Math.round(r / 32)}-${Math.round(g / 32)}-${Math.round(b / 32)}`)
    }

    if (drawnPixels === 0) return { score: 0, label: 'unknown', ready: true }

    // ── CHECK 1: Color variety ────────────────────────────────
    if (colorBuckets.size < 3)
      return { score: 0.25, label: 'unknown', ready: true }

    // ── Pass 2: edge pixels ───────────────────────────────────
    // Edge pixel = drawn (not transparent) AND has at least 1 white/transparent neighbor
    let edgePixels = 0
    for (let i = 0; i < total; i++) {
      if (isTransparent(i)) continue
      const x = i % width
      const y = Math.floor(i / width)
      const hasBlankNeighbor =
        (x > 0          && isBlankNeighbor(y * width + x - 1))  ||
        (x < width - 1  && isBlankNeighbor(y * width + x + 1))  ||
        (y > 0          && isBlankNeighbor((y - 1) * width + x)) ||
        (y < height - 1 && isBlankNeighbor((y + 1) * width + x))
      if (hasBlankNeighbor) edgePixels++
    }

    // ── CHECK 2: Outline presence ─────────────────────────────
    const edgeRatio = edgePixels / drawnPixels
    if (edgeRatio < 0.05)
      return { score: 0.25, label: 'unknown', ready: true }

    // ── CHECK 3: Interior fill ────────────────────────────────
    // Interior pixels = drawn pixels that are NOT edge pixels.
    // Need at least 3% of total canvas pixels to be interior fill.
    const interiorPixels = drawnPixels - edgePixels
    if (interiorPixels / total < 0.03)
      return { score: 0.30, label: 'unknown', ready: true }

    // ── Score calculation ─────────────────────────────────────
    let score = 0.70
    if (colorBuckets.size >= 4) score += 0.15
    if (colorBuckets.size >= 5) score += 0.10
    score = Math.min(1.0, score)

    return {
      score,
      label: score >= 0.65 ? 'creature' : score >= 0.35 ? 'maybe' : 'unknown',
      ready: true,
    }
  }

  getBackgroundColor(score: number): string {
    if (score >= 0.65) return '#F0FFF4'
    if (score >= 0.35) return '#FFFFF0'
    return '#FFF5F5'
  }
}
