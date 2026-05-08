// OnnxValidator.ts
// Pure canvas pixel analysis — no ONNX model needed.
//
// Rule: ANY colour, but shape MUST be:
//   1. Substantial area (not a line or scribble)
//   2. Compact / filled (drawn pixels fill a large portion of their bounding box)
//   3. Not just a thin outline ring (fill density check)
//
// Key insight: flood-fill enclosure fails for filled shapes (no interior white).
// Instead we use FILL DENSITY = drawn pixels / bounding box area.
// A filled blob scores high. A thin outline ring scores low.

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

    // ── Find all drawn pixels ─────────────────────────────────
    let drawnCount = 0
    let minX = width, maxX = 0, minY = height, maxY = 0

    for (let i = 0; i < total; i++) {
      const r = data[i * 4]
      const g = data[i * 4 + 1]
      const b = data[i * 4 + 2]
      const a = data[i * 4 + 3]
      // Skip transparent or white (background)
      if (a < 30 || (r > 220 && g > 220 && b > 220)) continue

      drawnCount++
      const x = i % width
      const y = Math.floor(i / width)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }

    if (drawnCount === 0) return { score: 0, label: 'unknown', ready: true }

    // ── Coverage: how much of the canvas is drawn ─────────────
    const coverageRatio = drawnCount / total

    // ── Bounding box fill density ─────────────────────────────
    // Filled blob: drawn pixels ≈ bounding box area → high density
    // Thin outline ring: drawn pixels << bounding box area → low density
    // Single line: bounding box is wide/tall but thin → low density
    const bboxW    = maxX - minX + 1
    const bboxH    = maxY - minY + 1
    const bboxArea = bboxW * bboxH
    const fillDensity = drawnCount / bboxArea

    // ── Aspect ratio check ────────────────────────────────────
    // A single line has extreme aspect ratio (very wide, very thin)
    const aspectRatio = Math.min(bboxW, bboxH) / Math.max(bboxW, bboxH)
    // A blob is roughly square-ish: aspectRatio > 0.3
    // A line is very elongated: aspectRatio < 0.1

    // ── Hard gates ────────────────────────────────────────────
    const hasArea      = coverageRatio >= 0.04   // big enough
    const hasFill      = fillDensity   >= 0.35   // filled, not hollow ring or line
    const hasShape     = aspectRatio   >= 0.25   // not a thin line

    // ── Score ─────────────────────────────────────────────────
    const raw =
      Math.min(coverageRatio / 0.15, 1) * 0.20 +
      fillDensity                        * 0.55 +
      Math.min(aspectRatio   / 0.5,  1) * 0.25

    let score = Math.max(0, Math.min(1, raw))

    if (!hasArea)  score = Math.min(score, 0.35)
    if (!hasFill)  score = Math.min(score, 0.45)
    if (!hasShape) score = Math.min(score, 0.40)

    return {
      score,
      label: score >= 0.6 ? 'creature' : score >= 0.3 ? 'maybe' : 'unknown',
      ready: true,
    }
  }

  getBackgroundColor(score: number): string {
    if (score >= 0.6) return '#F0FFF4'
    if (score >= 0.3) return '#FFFFF0'
    return '#FFF5F5'
  }
}
