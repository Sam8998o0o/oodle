import type { PetCoords } from '../api/aiRecognize'

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

  private t          = 0
  private blinkTimer = 0
  private blinkCycle = 3.5
  private blinkFrame = 0
  private isBlinking = false

  private sleepAngle  = 0
  private sleepTarget = 0
  private jumpT       = 0
  private isJumping   = false
  private jumpCount   = 0
  private nodT        = 0
  private walkT       = 0
  private sadDroop    = 0
  private squishT     = 0
  private dizzyT      = 0

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
    const loop = () => { this.frame(); this.rafId = requestAnimationFrame(loop) }
    this.rafId = requestAnimationFrame(loop)
  }

  stop(): void {
    cancelAnimationFrame(this.rafId)
    this.rafId = 0
  }

  setState(s: PetState): void {
    const prev = this.state
    this.state = s
    if (s === 'play')   { this.isJumping = true; this.jumpCount = 0; this.jumpT = 0 }
    if (s === 'eat')    { this.nodT = 0 }
    if (s === 'sleep')  { this.sleepTarget = Math.PI / 2 }
    if (prev === 'sleep' && s !== 'sleep') { this.sleepTarget = 0 }
    if (s === 'sad')    { this.sadDroop = 0 }
    if (s === 'walk')   { this.walkT = 0 }
    if (s === 'squish') { this.squishT = 0 }
    if (s === 'dizzy')  { this.dizzyT = 0 }
  }

  private frame(): void {
    const { ctx, data, state, src } = this
    const { size, coords } = data

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    if (!src) return

    this.t += 0.055

    let translateY = 0
    let rotate     = 0
    let scaleY     = 1
    let alpha      = 1

    switch (state) {
      case 'idle': {
        scaleY = 1 + Math.sin(this.t * 0.8) * 0.015
        break
      }
      case 'walk': {
        this.walkT += 0.14
        rotate     = Math.sin(this.walkT) * 0.06
        translateY = (1 - Math.abs(Math.cos(this.walkT))) * -4
        break
      }
      case 'eat': {
        this.nodT += 0.18
        rotate     = Math.sin(this.nodT) * 0.12
        translateY = Math.max(0, Math.sin(this.nodT)) * 4
        break
      }
      case 'play': {
        this.jumpT += 0.18
        if (this.isJumping) {
          const jumpY = Math.sin(this.jumpT * Math.PI)
          translateY  = -Math.max(0, jumpY) * 20
          rotate      = jumpY * 0.15
          if (this.jumpT >= 1) {
            this.jumpT = 0; this.jumpCount++
            if (this.jumpCount >= 3) { this.isJumping = false; this.setState('idle') }
          }
        }
        break
      }
      case 'sleep': {
        const diff = this.sleepTarget - this.sleepAngle
        this.sleepAngle += diff * 0.08
        rotate     = this.sleepAngle
        translateY = Math.sin(this.sleepAngle) * (size * 0.25)
        break
      }
      case 'sad': {
        this.sadDroop = Math.min(this.sadDroop + 0.3, 8)
        translateY   = this.sadDroop
        scaleY       = 0.90
        alpha        = 0.70
        rotate       = Math.sin(this.t * 0.5) * 0.06
        break
      }
      case 'squish': {
        // Quick squish: flatten then spring back
        this.squishT += 0.18
        const squishProgress = Math.min(this.squishT, Math.PI)
        scaleY     = 1 - Math.sin(squishProgress) * 0.35
        translateY = Math.sin(squishProgress) * 8
        rotate     = Math.sin(this.squishT * 2) * 0.08
        break
      }
      case 'dizzy': {
        // Frozen but wobble slightly
        this.dizzyT += 0.04
        rotate     = Math.sin(this.dizzyT * 1.5) * 0.08
        translateY = Math.abs(Math.sin(this.dizzyT)) * 2
        break
      }
    }

    // 身體 + 眼睛全在同一個 transform 裡
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.imageSmoothingEnabled = false

    const cx2 = size / 2
    const pivotY = size - 4

    ctx.translate(cx2, pivotY + translateY)
    ctx.rotate(rotate)
    ctx.scale(1, scaleY)
    ctx.translate(-cx2, -pivotY)

    // 畫身體
    ctx.drawImage(src, 2, 2, size-4, size-4)

    // 眨眼邏輯 — 只用 drawEye 的 blink flag，完全移除 compressEyes
    // compressEyes 會在身體圖上挖方塊造成方形殘影，不再使用
    let blink = false
    if (state === 'sleep') {
      blink = true  // sleep = 眼睛一直閉著
    } else if (state === 'sad') {
      blink = true  // sad = 半閉眼效果由 drawEye 處理
    } else {
      this.blinkTimer += 0.028
      if (this.blinkTimer >= this.blinkCycle) {
        this.isBlinking = true; this.blinkFrame = 0
        this.blinkTimer = 0
        this.blinkCycle = 3.5 + (Math.random()-0.5)*3
      }
      if (this.isBlinking) {
        this.blinkFrame++
        if (this.blinkFrame <= 6) {
          blink = true
        } else {
          this.isBlinking = false
        }
      }
    }

    // 眼睛款式（在同一個 transform 裡，跟著身體擺動）
    const eyeStyleToUse = state === 'dizzy' ? 'eye_x' : (data.eyeStyle ?? 'eye_round')
    if (coords.eyes.length > 0) {
      const eyeSize = size * 0.09
      const ex = coords.eyes.reduce((s,e) => s+e.x, 0) / coords.eyes.length * size
      const ey = coords.eyes[0].y * size
      this.drawEye(ctx, eyeStyleToUse, ex - eyeSize*1.3, ey, eyeSize, blink)
      this.drawEye(ctx, eyeStyleToUse, ex + eyeSize*1.3, ey, eyeSize, blink)
    }

    ctx.restore()

    // 影子跟著 translateY 偏移，貼在寵物底部
    ctx.save()
    ctx.globalAlpha = 0.18
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(size / 2, size - 6 + translateY, size * 0.30, 5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    if (state === 'sleep') this.drawZzz(ctx, size)
    if (state === 'sad')   this.drawSweat(ctx, size)
    if (state === 'dizzy') this.drawDizzy(ctx, size)
  }

  private drawEye(
    ctx: CanvasRenderingContext2D,
    id: string, cx: number, cy: number,
    size: number, blink: boolean
  ): void {
    const r = size / 2
    ctx.save()
    ctx.translate(cx, cy)
    switch(id) {
      case 'eye_round':
        ctx.fillStyle = '#2C2C2C'
        ctx.beginPath(); ctx.arc(0, 0, blink ? r*0.15 : r, 0, Math.PI*2); ctx.fill()
        if (!blink) {
          ctx.fillStyle = '#fff'
          ctx.beginPath(); ctx.arc(-r*0.25,-r*0.25,r*0.3,0,Math.PI*2); ctx.fill()
        }
        break
      case 'eye_happy':
        ctx.strokeStyle = '#2C2C2C'; ctx.lineWidth = 2; ctx.beginPath()
        if (blink) { ctx.moveTo(-r,0); ctx.lineTo(r,0) }
        else { ctx.arc(0, r*0.3, r, Math.PI, 0) }
        ctx.stroke(); break
      case 'eye_sleepy':
        ctx.strokeStyle = '#2C2C2C'; ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(-r,0); ctx.lineTo(r,0); ctx.stroke()
        if (!blink) {
          ctx.fillStyle = '#2C2C2C'
          ctx.beginPath(); ctx.arc(0,r*0.4,r*0.5,0,Math.PI*2); ctx.fill()
        }
        break
      case 'eye_star':
        ctx.fillStyle = '#FFD700'
        if (blink) { ctx.fillRect(-r,-r*0.15,r*2,r*0.3) }
        else {
          for (let i=0;i<5;i++) {
            const a=(i*Math.PI*2/5)-Math.PI/2
            ctx.beginPath(); ctx.moveTo(0,0)
            ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r)
            ctx.lineTo(Math.cos(a+Math.PI/5)*r*0.4,Math.sin(a+Math.PI/5)*r*0.4)
            ctx.fill()
          }
        }
        break
      case 'eye_heart':
        ctx.fillStyle = '#E91E63'
        if (blink) { ctx.fillRect(-r,-r*0.15,r*2,r*0.3) }
        else {
          ctx.beginPath(); ctx.moveTo(0,r*0.3)
          ctx.bezierCurveTo(-r,-r*0.3,-r,-r,0,-r*0.3)
          ctx.bezierCurveTo(r,-r,r,-r*0.3,0,r*0.3)
          ctx.fill()
        }
        break
      case 'eye_x':
        ctx.strokeStyle = '#E91E63'; ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(-r,-r); ctx.lineTo(r,r)
        ctx.moveTo(r,-r);  ctx.lineTo(-r,r)
        ctx.stroke(); break
    }
    ctx.restore()
  }


  private zzzT = 0
  private drawZzz(ctx: CanvasRenderingContext2D, size: number): void {
    this.zzzT += 0.02
    ;['z','z','Z'].forEach((l, i) => {
      const phase = (this.zzzT + i*0.6) % 1.8
      const a = phase < 0.9 ? phase/0.9 : 1-(phase-0.9)/0.9
      ctx.save()
      ctx.globalAlpha = Math.max(0, a)
      ctx.fillStyle   = '#555'
      ctx.font        = `bold ${10+i*4}px system-ui`
      ctx.fillText(l, Math.sin(phase*Math.PI)*10 + size*0.65, size*0.25 - phase*18)
      ctx.restore()
    })
  }

  private drawSweat(ctx: CanvasRenderingContext2D, size: number): void {
    ctx.save()
    ctx.fillStyle = '#64B5F6'; ctx.globalAlpha = 0.8
    const x = size*0.78, y = size*0.22
    ctx.beginPath()
    ctx.moveTo(x, y-8)
    ctx.bezierCurveTo(x+5, y-4, x+5, y+4, x, y+5)
    ctx.bezierCurveTo(x-5, y+4, x-5, y-4, x, y-8)
    ctx.fill()
    ctx.restore()
  }

  private drawDizzy(ctx: CanvasRenderingContext2D, size: number): void {
    // Spinning 💫 stars above pet head
    const cx = size / 2
    const cy = size * 0.08
    const radius = size * 0.22
    const count = 3
    for (let i = 0; i < count; i++) {
      const angle = (this.dizzyT * 2) + (i / count) * Math.PI * 2
      const x = cx + Math.cos(angle) * radius
      const y = cy + Math.sin(angle) * radius * 0.4
      const opacity = 0.6 + Math.sin(angle + this.dizzyT) * 0.4
      ctx.save()
      ctx.globalAlpha = Math.max(0.2, opacity)
      ctx.font = `${size * 0.18}px system-ui`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('💫', x, y)
      ctx.restore()
    }
  }
}