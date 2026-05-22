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

    const isBlank = (idx: number): boolean => {
      const a = data[idx * 4 + 3]
      const r = data[idx * 4]
      const g = data[idx * 4 + 1]
      const b = data[idx * 4 + 2]
      return a < 30 || (r > 220 && g > 220 && b > 220)
    }

    // ── Pass 1: drawn pixels, bounding box, color buckets ─────
    let drawnPixels = 0
    let minX = width, maxX = 0, minY = height, maxY = 0
    const colorBuckets = new Set<string>()

    for (let i = 0; i < total; i++) {
      if (isBlank(i)) continue
      drawnPixels++
      const x = i % width
      const y = Math.floor(i / width)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      const r = data[i * 4]
      const g = data[i * 4 + 1]
      const b = data[i * 4 + 2]
      colorBuckets.add(`${Math.round(r / 32)}-${Math.round(g / 32)}-${Math.round(b / 32)}`)
    }

    if (drawnPixels === 0) return { score: 0, label: 'unknown', ready: true }

    // ── Coverage ──────────────────────────────────────────────
    const coverageRatio = drawnPixels / total

    // ── Bounding box & aspect ratio ───────────────────────────
    const bboxW  = maxX - minX + 1
    const bboxH  = maxY - minY + 1
    const aspectRatio = Math.min(bboxW, bboxH) / Math.max(bboxW, bboxH)

    // ── Pass 2: outline check ─────────────────────────────────
    // Edge pixel = drawn AND has at least one blank (transparent/white) neighbor
    let edgePixels = 0
    for (let i = 0; i < total; i++) {
      if (isBlank(i)) continue
      const x = i % width
      const y = Math.floor(i / width)
      const hasBlankNeighbor =
        (x > 0          && isBlank(y * width + x - 1))       ||
        (x < width - 1  && isBlank(y * width + x + 1))       ||
        (y > 0          && isBlank((y - 1) * width + x))      ||
        (y < height - 1 && isBlank((y + 1) * width + x))
      if (hasBlankNeighbor) edgePixels++
    }
    const outlineRatio = edgePixels / drawnPixels

    // ── Pass 3: interior fill ─────────────────────────────────
    // Inner 50% of bounding box = from 25% to 75% of each bbox dimension
    const innerMinX  = Math.floor(minX + bboxW * 0.25)
    const innerMaxX  = Math.floor(maxX - bboxW * 0.25)
    const innerMinY  = Math.floor(minY + bboxH * 0.25)
    const innerMaxY  = Math.floor(maxY - bboxH * 0.25)
    const centerArea = Math.max(1, (innerMaxX - innerMinX + 1) * (innerMaxY - innerMinY + 1))
    let   centerDrawn = 0
    for (let y = innerMinY; y <= innerMaxY; y++) {
      for (let x = innerMinX; x <= innerMaxX; x++) {
        if (!isBlank(y * width + x)) centerDrawn++
      }
    }
    const innerFillRatio = centerDrawn / centerArea

    // ── Base score ────────────────────────────────────────────
    let score =
      Math.min(coverageRatio  / 0.15, 1) * 0.20 +
      Math.min(aspectRatio    / 0.50, 1) * 0.20 +
      Math.min(outlineRatio   / 0.25, 1) * 0.25 +
      Math.min(innerFillRatio / 0.50, 1) * 0.20 +
      Math.min(colorBuckets.size / 4,  1) * 0.15

    score = Math.max(0, Math.min(1, score))

    // ── Hard caps (applied in order from strictest) ───────────

    // 1. Coverage gate: 5–80% of canvas
    if (coverageRatio < 0.05 || coverageRatio > 0.80)
      score = Math.min(score, 0.20)

    // 2. Outline gate: at least 15% of drawn pixels must be edge pixels
    if (outlineRatio < 0.15)
      score = Math.min(score, 0.20)

    // 3. Solid fill with no outline: very low edge ratio on a non-trivial drawing
    if (outlineRatio < 0.05 && coverageRatio > 0.10)
      score = Math.min(score, 0.25)

    // 4. Outline-only, no interior fill: center region < 10% filled
    if (innerFillRatio < 0.10 && edgePixels > 0)
      score = Math.min(score, 0.35)

    // 5. Color variety: single color max 0.30
    if (colorBuckets.size < 2)
      score = Math.min(score, 0.30)

    // 6. Aspect ratio: thin line
    if (aspectRatio < 0.25)
      score = Math.min(score, 0.40)

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
