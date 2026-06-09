import { useRef, useEffect } from 'react'

interface PropellerHatProps {
  size?:    number
  spinning?: boolean
}

/**
 * Pixel-art bamboo propeller hat.
 * Renders a small straw hat with two spinning blades above it.
 * All drawing is done with ctx.fillRect (no arc / bezier).
 * Blade rotation uses ctx.rotate for correctness — blades are
 * simple rectangles drawn on a rotated canvas context.
 */
export default function PropellerHat({ size = 40, spinning = true }: PropellerHatProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const angleRef  = useRef(0)
  const rafRef    = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W  = size
    const H  = Math.round(size * 0.9)
    canvas.width  = W
    canvas.height = H

    const cx = Math.round(W / 2)
    const u  = Math.max(1, Math.round(size / 14))   // pixel unit

    const drawFrame = () => {
      ctx.clearRect(0, 0, W, H)

      // ── Hub position (sits above the dome) ────────────────
      const hubCy = Math.round(H * 0.30)

      // ── Spinning blades (two blades, 180° apart) ─────────
      const bladeLen = Math.round(size * 0.44)
      const bladeW   = Math.max(2, u + 1)

      ctx.save()
      ctx.translate(cx, hubCy)

      ctx.save()
      ctx.rotate(angleRef.current)
      ctx.fillStyle = '#88cc44'
      ctx.fillRect(-bladeLen / 2, -Math.floor(bladeW / 2), bladeLen, bladeW)
      ctx.restore()

      ctx.save()
      ctx.rotate(angleRef.current + Math.PI / 2)
      ctx.fillStyle = '#66aa33'
      ctx.fillRect(-bladeLen / 2, -Math.floor(bladeW / 2), bladeLen, bladeW)
      ctx.restore()

      ctx.restore()

      // ── Hub square ────────────────────────────────────────
      const hubR = u + 1
      ctx.fillStyle = '#5C3D1E'
      ctx.fillRect(cx - hubR, hubCy - hubR, hubR * 2, hubR * 2)

      // ── Hat dome ──────────────────────────────────────────
      const domeW = Math.round(W * 0.48)
      const domeH = u * 4
      const domeX = cx - Math.round(domeW / 2)
      const domeY = hubCy + hubR + 1

      ctx.fillStyle = '#C8A46E'
      ctx.fillRect(domeX, domeY, domeW, domeH)
      // Left highlight
      ctx.fillStyle = '#D4B484'
      ctx.fillRect(domeX, domeY, u, domeH)
      // Right shadow
      ctx.fillStyle = '#9A6830'
      ctx.fillRect(domeX + domeW - u, domeY, u, domeH)

      // ── Hat brim ──────────────────────────────────────────
      const brimW = Math.round(W * 0.88)
      const brimH = u + 1
      const brimX = cx - Math.round(brimW / 2)
      const brimY = domeY + domeH

      ctx.fillStyle = '#C8A46E'
      ctx.fillRect(brimX, brimY, brimW, brimH)
      // Brim underside shadow
      ctx.fillStyle = '#9A6830'
      ctx.fillRect(brimX, brimY + brimH, brimW, u)
    }

    if (spinning) {
      const animate = () => {
        angleRef.current += 0.11
        drawFrame()
        rafRef.current = requestAnimationFrame(animate)
      }
      rafRef.current = requestAnimationFrame(animate)
    } else {
      drawFrame()
    }

    return () => { cancelAnimationFrame(rafRef.current) }
  }, [size, spinning])

  return (
    <canvas
      ref={canvasRef}
      style={{
        display:         'block',
        imageRendering:  'pixelated',
        width:           size,
        height:          Math.round(size * 0.9),
      }}
    />
  )
}
