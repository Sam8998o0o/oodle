import type { PetCoords } from '../api/aiRecognize'
import { drawEye } from './drawEye'

export interface PetAnimData {
  imageDataURL: string
  coords: PetCoords
  size: number
  eyeStyle?: string
}

export type PetState = 'idle' | 'walk' | 'eat' | 'play' | 'sleep' | 'sad' | 'squish' | 'dizzy'

export class PetAnimator {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private data: PetAnimData
  private src: HTMLCanvasElement | null = null

  private state: PetState = 'idle'
  private rafId = 0

  // Integer frame counter — all animation timing uses this
  private frame = 0

  // Per-state frame counters (reset on state change)
  private walkF  = 0
  private nodF   = 0
  private sadF   = 0
  private squishF = 0
  private dizzyF  = 0
  private jumpF   = 0
  private jumpCount = 0
  private isJumping = false

  // Blink timing (frame-based)
  private blinkCountdown = 210
  private blinkFrame     = 0
  private isBlinking     = false

  private zzzF = 0

  constructor(canvas: HTMLCanvasElement, petData: PetAnimData) {
    this.canvas = canvas
    this.ctx    = canvas.getContext('2d')!
    this.ctx.imageSmoothingEnabled = false
    this.data   = petData
    this.loadImage(petData.imageDataURL)
  }

  private loadImage(dataURL: string): void {
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth || img.width
      const h = img.naturalHeight || img.height
      const pc = document.createElement('canvas')
      pc.width = w; pc.height = h
      const ctx = pc.getContext('2d')!
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0)
      const id = ctx.getImageData(0, 0, w, h)
      const d  = id.data
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 240 && d[i+1] > 240 && d[i+2] > 240) d[i+3] = 0
      }
      ctx.putImageData(id, 0, 0)
      this.src = pc
    }
    img.src = dataURL
  }

  start(): void {
    if (this.rafId) return
    const loop = () => { this.tick(); this.rafId = requestAnimationFrame(loop) }
    this.rafId = requestAnimationFrame(loop)
  }

  stop(): void {
    cancelAnimationFrame(this.rafId)
    this.rafId = 0
  }

  setState(s: PetState): void {
    const prev = this.state
    this.state = s
    if (s === 'play')  { this.isJumping = true; this.jumpCount = 0; this.jumpF = 0 }
    if (s === 'eat')   { this.nodF = 0 }
    if (prev === 'sleep' && s !== 'sleep') { /* nothing extra needed */ }
    if (s === 'sad')   { this.sadF = 0 }
    if (s === 'walk')  { this.walkF = 0 }
    if (s === 'squish'){ this.squishF = 0 }
    if (s === 'dizzy') { this.dizzyF = 0 }
  }

  private tick(): void {
    const { ctx, data, state, src } = this
    const { size, coords } = data

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    if (!src) return

    this.frame++

    // Integer pixel offsets only — no sub-pixel values
    let translateX = 0
    let translateY = 0
    let rotate     = 0
    let scaleY     = 1
    let alpha      = 1

    switch (state) {
      case 'idle': {
        // Every 30 frames: bob 1px up, then back
        translateY = Math.floor(this.frame / 30) % 2 === 0 ? 0 : -1
        break
      }
      case 'walk': {
        this.walkF++
        // Every 8 frames: sway ±2px horizontally
        translateX = Math.floor(this.walkF / 8) % 2 === 0 ? 2 : -2
        // Every 16 frames: bob 1px vertically
        translateY = Math.floor(this.walkF / 16) % 2 === 0 ? 0 : -1
        break
      }
      case 'eat': {
        this.nodF++
        // 16-frame cycle: 0–7 nod down 2px, 8–15 return
        translateY = Math.floor(this.nodF / 8) % 2 === 0 ? 0 : 2
        break
      }
      case 'play': {
        this.jumpF++
        if (this.isJumping) {
          // 30-frame arc: up 20px then back
          const f = this.jumpF % 30
          translateY = f < 15 ? -Math.round((f / 15) * 20) : -Math.round(((30 - f) / 15) * 20)
          if (this.jumpF % 30 === 0) {
            this.jumpCount++
            if (this.jumpCount >= 3) { this.isJumping = false; this.setState('idle') }
          }
        }
        break
      }
      case 'sleep': {
        // Snap immediately to lying on side
        rotate     = Math.PI / 2
        translateY = Math.round(size * 0.25)
        break
      }
      case 'sad': {
        this.sadF = Math.min(this.sadF + 1, 240)
        // Gradually droop, max 4px, every 60 frames +1px
        translateY = Math.min(Math.floor(this.sadF / 60), 4)
        alpha      = 0.70
        // Slow side-to-side: every 20 frames flip ±2px
        translateX = Math.floor(this.frame / 20) % 2 === 0 ? -2 : 2
        break
      }
      case 'squish': {
        this.squishF++
        // 4-frame squish burst then reset to idle
        const f = this.squishF % 16
        scaleY     = f >= 4 && f < 8 ? 0.65 : 1
        translateY = f >= 4 && f < 8 ? Math.round(size * 0.1) : 0
        if (this.squishF >= 16) { this.squishF = 0; this.setState('idle') }
        break
      }
      case 'dizzy': {
        this.dizzyF++
        // Every 6 frames: alternate ±2px horizontal
        translateX = Math.floor(this.dizzyF / 6) % 2 === 0 ? 2 : -2
        break
      }
    }

    // ── Draw body ──────────────────────────────────────────────────
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.imageSmoothingEnabled = false

    const halfW   = size / 2
    const pivotY  = size - 4

    ctx.translate(Math.round(halfW + translateX), Math.round(pivotY + translateY))
    ctx.rotate(rotate)
    ctx.scale(1, scaleY)
    ctx.translate(Math.round(-halfW - translateX), -pivotY)

    ctx.drawImage(src, 2, 2, size - 4, size - 4)

    // ── Blink timing ───────────────────────────────────────────────
    let blink = false
    if (state === 'sleep') {
      blink = true
    } else if (state === 'sad') {
      blink = true
    } else {
      this.blinkCountdown--
      if (this.blinkCountdown <= 0) {
        this.isBlinking    = true
        this.blinkFrame    = 0
        this.blinkCountdown = 180 + Math.round((Math.random() - 0.5) * 120)
      }
      if (this.isBlinking) {
        this.blinkFrame++
        blink = this.blinkFrame <= 6
        if (this.blinkFrame > 6) this.isBlinking = false
      }
    }

    // ── Draw pixel eyes ────────────────────────────────────────────
    const eyeStyleToUse = state === 'dizzy' ? 'eye_x' : (data.eyeStyle ?? 'eye_round')
    if (coords.eyes.length > 0) {
      const eyeSize = Math.round(size * 0.09)
      const ex = coords.eyes.reduce((s, e) => s + e.x, 0) / coords.eyes.length * size
      const ey = coords.eyes[0].y * size
      drawEye(ctx, eyeStyleToUse, Math.round(ex - eyeSize * 1.3), Math.round(ey), eyeSize, blink)
      drawEye(ctx, eyeStyleToUse, Math.round(ex + eyeSize * 1.3), Math.round(ey), eyeSize, blink)
    }

    ctx.restore()

    // ── Shadow ─────────────────────────────────────────────────────
    ctx.save()
    ctx.globalAlpha = 0.18
    ctx.fillStyle   = '#000'
    ctx.beginPath()
    ctx.ellipse(
      Math.round(size / 2 + translateX),
      size - 6 + translateY,
      Math.round(size * 0.30), 5,
      0, 0, Math.PI * 2,
    )
    ctx.fill()
    ctx.restore()

    if (state === 'sleep') this.drawZzz(size)
    if (state === 'sad')   this.drawSweat(size)
    if (state === 'dizzy') this.drawDizzy(size)
  }

  private drawZzz(size: number): void {
    this.zzzF++
    const letters = ['z', 'z', 'Z']
    letters.forEach((l, i) => {
      // Each letter floats up 18px over 54 frames, then resets
      const cycle  = 54
      const offset = i * 18
      const f      = (this.zzzF + offset) % (cycle * letters.length)
      if (f >= cycle) return
      const progress = f / cycle
      const alpha    = progress < 0.7 ? progress / 0.7 : (1 - progress) / 0.3
      this.ctx.save()
      this.ctx.globalAlpha = Math.max(0, alpha)
      this.ctx.fillStyle   = '#888'
      this.ctx.font        = `bold ${10 + i * 4}px monospace`
      this.ctx.fillText(l, size * 0.65 + Math.round(Math.sin(progress * Math.PI) * 6), size * 0.22 - Math.round(progress * 18))
      this.ctx.restore()
    })
  }

  private drawSweat(size: number): void {
    const ctx = this.ctx
    ctx.save()
    ctx.fillStyle   = '#64B5F6'
    ctx.globalAlpha = 0.8
    // 3 pixel drops
    const x = size * 0.78, y = size * 0.25
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(Math.round(x + i * 2), Math.round(y + i * 3), 2, 3)
    }
    ctx.restore()
  }

  private drawDizzy(size: number): void {
    const ctx  = this.ctx
    const cx   = size / 2
    const cy   = size * 0.08
    const rad  = size * 0.22
    const count = 3
    for (let i = 0; i < count; i++) {
      // Step every 4 frames
      const step  = Math.floor(this.dizzyF / 4)
      const angle = ((step + i * (count * 4 / count)) / (count * 4)) * Math.PI * 2
      const x     = Math.round(cx + Math.cos(angle) * rad)
      const y     = Math.round(cy + Math.sin(angle) * rad * 0.4)
      ctx.save()
      ctx.globalAlpha = 0.7
      ctx.font        = `${Math.round(size * 0.18)}px monospace`
      ctx.textAlign   = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('*', x, y)
      ctx.restore()
    }
  }
}
