import { useRef, useState, useEffect, useCallback } from 'react'
import PixelCanvas from '../ui/PixelCanvas'
import { OnnxValidator } from '../engine/OnnxValidator'
import type { PetCoords } from '../api/aiRecognize'
import styles from './DrawScene.module.css'

interface DrawSceneProps {
  onPetCreated: (pixelData: string, coords: PetCoords, name: string) => void
}

interface StoredPet {
  id: string
  pixelData: string
  name: string
}

interface Particle {
  id: number
  char: string
  x: number
  y: number
  angle: number
  distance: number
}

interface Accessory {
  id: string
  type: 'eye'
  label: string
  emoji: string
  free: boolean
}

type Step = 'draw' | 'decorate' | 'done'

const CHARS = ['✦', '★', '♥', '✿', '◆', '•']
const validator = new OnnxValidator()
const CANVAS_DISPLAY = 320

const EYES: Accessory[] = [
  { id: 'eye_round',  type: 'eye', label: 'Round',  emoji: '👀', free: true },
  { id: 'eye_happy',  type: 'eye', label: 'Happy',  emoji: '😊', free: true },
  { id: 'eye_sleepy', type: 'eye', label: 'Sleepy', emoji: '😴', free: true },
  { id: 'eye_star',   type: 'eye', label: 'Star',   emoji: '⭐', free: false },
  { id: 'eye_heart',  type: 'eye', label: 'Heart',  emoji: '💕', free: false },
  { id: 'eye_x',      type: 'eye', label: 'X Eyes', emoji: '😵', free: false },
]

function drawEyeStyle(
  ctx: CanvasRenderingContext2D,
  id: string, cx: number, cy: number,
  size: number, blink: boolean
) {
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
        for (let i=0; i<5; i++) {
          const a = (i*Math.PI*2/5) - Math.PI/2
          ctx.beginPath(); ctx.moveTo(0,0)
          ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r)
          ctx.lineTo(Math.cos(a+Math.PI/5)*r*0.4, Math.sin(a+Math.PI/5)*r*0.4)
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

async function validateFromDataURL(dataURL: string): Promise<number> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width; canvas.height = img.height
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      validator.validate(canvas).then(r => resolve(r.score))
    }
    img.onerror = () => resolve(0.75)
    img.src = dataURL
  })
}

export default function DrawScene({ onPetCreated }: DrawSceneProps) {
  const btnRef     = useRef<HTMLButtonElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const rafRef     = useRef(0)

  const [petDataURL, setPetDataURL]   = useState('')
  const [onnxScore, setOnnxScore]     = useState<number | null>(null)
  const [particles, setParticles]     = useState<Particle[]>([])
  const [storedPets, setStoredPets]   = useState<StoredPet[]>([])
  const [step, setStep]               = useState<Step>('draw')
  const [selectedEye, setSelectedEye] = useState<Accessory>(EYES[0])
  const [eyePos, setEyePos]           = useState<{x:number,y:number}>({ x:0.5, y:0.3 })
  const [dragging, setDragging]       = useState<'eye'|null>(null)
  const [petName, setPetName]         = useState('')

  const blinkRef = useRef({ timer:0, cycle:3.5, frame:0, blinking:false })

  useEffect(() => {
    try {
      const raw = localStorage.getItem('oodle_pets')
      if (raw) setStoredPets(JSON.parse(raw) as StoredPet[])
    } catch { /**/ }
  }, [])

  // 預覽動畫
  useEffect(() => {
    if (step !== 'decorate' || !petDataURL) return
    const canvas = previewRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false

    const img = new Image()
    img.src = petDataURL
    img.onload = () => {
      let bobT = 0
      const b = blinkRef.current

      const loop = () => {
        ctx.clearRect(0, 0, CANVAS_DISPLAY, CANVAS_DISPLAY)

        const offscreen = document.createElement('canvas')
        offscreen.width = img.width; offscreen.height = img.height
        const oc = offscreen.getContext('2d')!
        oc.drawImage(img, 0, 0)
        const id = oc.getImageData(0, 0, img.width, img.height)
        for (let i=0; i<id.data.length; i+=4) {
          if(id.data[i]>240&&id.data[i+1]>240&&id.data[i+2]>240) id.data[i+3]=0
        }
        oc.putImageData(id, 0, 0)

        bobT += 0.055
        const bob = Math.round(Math.sin(bobT) * 2)
        ctx.drawImage(offscreen, 2, 2+bob, CANVAS_DISPLAY-4, CANVAS_DISPLAY-12)

        b.timer += 0.028
        if (b.timer >= b.cycle) {
          b.blinking=true; b.frame=0; b.timer=0
          b.cycle=3.5+(Math.random()-0.5)*3
        }
        const blink = b.blinking && b.frame <= 6
        if (b.blinking) { b.frame++; if(b.frame>6) b.blinking=false }

        const eyeSize = CANVAS_DISPLAY * 0.08
        const ex = eyePos.x * CANVAS_DISPLAY
        const ey = eyePos.y * CANVAS_DISPLAY + bob
        drawEyeStyle(ctx, selectedEye.id, ex-eyeSize*1.2, ey, eyeSize, blink)
        drawEyeStyle(ctx, selectedEye.id, ex+eyeSize*1.2, ey, eyeSize, blink)

        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    return () => cancelAnimationFrame(rafRef.current)
  }, [step, petDataURL, selectedEye, eyePos])

  const handleComplete = useCallback(async (url: string) => {
    setPetDataURL(url)
    const score = await validateFromDataURL(url)
    setOnnxScore(score)
  }, [])

  const spawnParticles = useCallback(() => {
    const btn = btnRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const cx = rect.left + rect.width/2
    const cy = rect.top  + rect.height/2
    const newP: Particle[] = Array.from({length:12},(_,i)=>({
      id: Date.now()+i, char: CHARS[i%CHARS.length],
      x: cx, y: cy, angle: (i/12)*360, distance: 60+Math.random()*60,
    }))
    setParticles(newP)
    setTimeout(() => setParticles([]), 900)
  }, [])

  const handleMakeItLife = useCallback(() => {
    if (!petDataURL) return
    if (onnxScore === null || onnxScore < 0.6) return
    setStep('decorate')
  }, [petDataURL, onnxScore])

  const handlePreviewMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = previewRef.current!.getBoundingClientRect()
    const x = (e.clientX - rect.left) / CANVAS_DISPLAY
    const y = (e.clientY - rect.top)  / CANVAS_DISPLAY
    const eyeDist = Math.hypot(x-eyePos.x, y-eyePos.y)
    if (eyeDist < 0.2) setDragging('eye')
  }, [eyePos])

  const handlePreviewMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return
    const rect = previewRef.current!.getBoundingClientRect()
    const x = Math.max(0.05, Math.min(0.95, (e.clientX-rect.left)/CANVAS_DISPLAY))
    const y = Math.max(0.05, Math.min(0.95, (e.clientY-rect.top) /CANVAS_DISPLAY))
    setEyePos({x, y})
  }, [dragging])

  const handlePreviewMouseUp = useCallback(() => setDragging(null), [])

  const handleConfirm = useCallback(() => {
    const finalName = petName.trim() || 'My Pet'
    const eyeSize   = CANVAS_DISPLAY * 0.08

    const coords: PetCoords = {
      eyes: [
        { x: eyePos.x-(eyeSize*1.2)/CANVAS_DISPLAY, y: eyePos.y },
        { x: eyePos.x+(eyeSize*1.2)/CANVAS_DISPLAY, y: eyePos.y },
      ],
      legs:     [],
      center:   { x:0.5, y:0.5 },
      has_eyes: true,
      has_legs: false,
    }

    localStorage.setItem('oodle_eye_style', selectedEye.id)
    localStorage.removeItem('oodle_leg_style')

    const newPet: StoredPet = {
      id: crypto.randomUUID(),
      pixelData: petDataURL,
      name: finalName,
    }
    const updated = [...storedPets, newPet].slice(-20)
    setStoredPets(updated)
    localStorage.setItem('oodle_pets', JSON.stringify(updated))

    spawnParticles()
    setStep('done')
    onPetCreated(petDataURL, coords, finalName)
  }, [petName, eyePos, selectedEye, petDataURL, storedPets, spawnParticles, onPetCreated])

  return (
    <div className={styles.page}>
      <div className={styles.titleBlock}>
        <h1 className={styles.title}>OODLE</h1>
        <p className={styles.sub}>draw a pet. make it life.</p>
      </div>

      {step === 'draw' && (
        <>
          {onnxScore !== null && (
            <p className={styles.onnxLabel} style={{
              color: onnxScore>=0.6?'#4CAF50':onnxScore>=0.3?'#F5A623':'#FF5A5F'
            }}>
              {onnxScore>=0.6?'looks like a creature!':onnxScore>=0.3?'keep drawing...':'not sure yet...'} {Math.round(onnxScore*100)}%
            </p>
          )}
          <div className={styles.canvasArea}>
            <PixelCanvas onComplete={handleComplete} onStroke={() => {}} />
          </div>
          <button
            ref={btnRef}
            className={styles.ctaBtn}
            onClick={handleMakeItLife}
            disabled={!petDataURL}
          >
            ✦ MAKE IT LIFE ✦
          </button>
        </>
      )}

      {step === 'decorate' && (
        <>
          <p className={styles.markHint} style={{ color:'#2196F3' }}>
            👁 Pick eyes & drag to position!
          </p>

          <div style={{ position:'relative', cursor: dragging?'grabbing':'grab' }}>
            <canvas
              ref={previewRef}
              width={CANVAS_DISPLAY}
              height={CANVAS_DISPLAY}
              style={{ display:'block', border:'2px solid #ddd', borderRadius:8 }}
              onMouseDown={handlePreviewMouseDown}
              onMouseMove={handlePreviewMouseMove}
              onMouseUp={handlePreviewMouseUp}
              onMouseLeave={handlePreviewMouseUp}
            />
            <p style={{ textAlign:'center', fontSize:11, color:'#999', margin:'4px 0 0' }}>
              Drag 👁 to position the eyes
            </p>
          </div>

          <div className={styles.accessoryRow}>
            <span className={styles.accessoryLabel}>👁 EYES</span>
            <div className={styles.accessoryGrid}>
              {EYES.map(eye => (
                <button
                  key={eye.id}
                  className={`${styles.accessoryBtn} ${selectedEye.id===eye.id?styles.accessorySelected:''} ${!eye.free?styles.accessoryLocked:''}`}
                  onClick={() => eye.free && setSelectedEye(eye)}
                  title={eye.free ? eye.label : `${eye.label} (Premium)`}
                >
                  <span style={{ fontSize:20 }}>{eye.emoji}</span>
                  <span className={styles.accessoryName}>{eye.label}</span>
                  {!eye.free && <span className={styles.lockIcon}>🔒</span>}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.nameRow}>
            <span className={styles.accessoryLabel}>🏷 NAME YOUR PET</span>
            <input
              className={styles.nameInput}
              type="text"
              maxLength={16}
              placeholder="e.g. Biscuit, Noodle, Zap..."
              value={petName}
              onChange={e => setPetName(e.target.value)}
            />
          </div>

          <button
            className={styles.ctaBtn}
            style={{ background:'#4CAF50', borderColor:'#2E7D32', boxShadow:'4px 4px 0 #2E7D32' }}
            onClick={handleConfirm}
          >
            ✓ BRING IT TO LIFE!
          </button>
        </>
      )}

      {particles.map(p => (
        <span key={p.id} className={styles.particle} style={{
          left:p.x, top:p.y,
          '--angle':`${p.angle}deg`,
          '--dist':`${p.distance}px`,
        } as React.CSSProperties}>
          {p.char}
        </span>
      ))}
    </div>
  )
}
