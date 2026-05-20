import { useRef, useState, useEffect, useCallback } from 'react'
import { OnnxValidator } from '../engine/OnnxValidator'
import { drawEye } from '../engine/drawEye'
import type { PetCoords } from '../api/aiRecognize'
import styles from './DrawScene.module.css'

// ── Grid constants ─────────────────────────────────────────
const GRID_SIZE = 64
const CELL_SIZE = 8
const CANVAS_PX = GRID_SIZE * CELL_SIZE   // 512

// ── 16-colour pixel-art palette ───────────────────────────
const PALETTE = [
  '#000000', '#ffffff', '#e94560', '#f5a623',
  '#ffe600', '#4ecca3', '#00b4d8', '#0f3460',
  '#7c4dff', '#ff80ab', '#795548', '#9e9e9e',
  '#b71c1c', '#1b5e20', '#0d47a1', '#ffccbc',
]

const CHARS = ['✦', '★', '♥', '✿', '◆', '•']

const validator = new OnnxValidator()

type Tool      = 'draw' | 'erase' | 'fill'
type BrushSize = 1 | 2 | 4
type Step      = 'draw' | 'decorate' | 'done'
type TabMode   = 'draw' | 'ai'

interface EyeOption { id: string; label: string; free: boolean }
interface Particle  { id: number; char: string; x: number; y: number; angle: number; distance: number }
interface StoredPet { id: string; pixelData: string; name: string }

interface DrawSceneProps {
  onPetCreated: (pixelData: string, coords: PetCoords, name: string) => void
}

const EYES: EyeOption[] = [
  { id: 'eye_round',  label: 'Round',  free: true  },
  { id: 'eye_happy',  label: 'Happy',  free: true  },
  { id: 'eye_sleepy', label: 'Sleepy', free: true  },
  { id: 'eye_star',   label: 'Star',   free: false },
  { id: 'eye_heart',  label: 'Heart',  free: false },
  { id: 'eye_x',      label: 'X Eyes', free: false },
]

// ── Grid helpers ──────────────────────────────────────────
function makeGrid(): string[][] {
  return Array.from({ length: GRID_SIZE }, () => new Array<string>(GRID_SIZE).fill(''))
}

function floodFill(grid: string[][], r: number, c: number, color: string): string[][] {
  const target = grid[r][c]
  if (target === color) return grid
  const next = grid.map(row => [...row])
  const stack: [number, number][] = [[r, c]]
  while (stack.length) {
    const [cr, cc] = stack.pop()!
    if (cr < 0 || cr >= GRID_SIZE || cc < 0 || cc >= GRID_SIZE) continue
    if (next[cr][cc] !== target) continue
    next[cr][cc] = color
    stack.push([cr - 1, cc], [cr + 1, cc], [cr, cc - 1], [cr, cc + 1])
  }
  return next
}

function paintBrush(
  grid: string[][], r: number, c: number,
  brushSize: BrushSize, color: string, erase: boolean,
): string[][] {
  const next = grid.map(row => [...row])
  const half = Math.floor(brushSize / 2)
  for (let dr = 0; dr < brushSize; dr++) {
    for (let dc = 0; dc < brushSize; dc++) {
      const nr = r + dr - half
      const nc = c + dc - half
      if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
        next[nr][nc] = erase ? '' : color
      }
    }
  }
  return next
}

function renderGridToCtx(ctx: CanvasRenderingContext2D, grid: string[][], showGrid: boolean): void {
  ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX)
  // White background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX)
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const col = grid[r][c]
      if (col) {
        ctx.fillStyle = col
        ctx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE)
      }
    }
  }
  // Pixel grid overlay — only when showGrid is true
  if (showGrid) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)'
    ctx.lineWidth   = 1
    for (let i = 0; i <= GRID_SIZE; i++) {
      const px = i * CELL_SIZE
      ctx.beginPath(); ctx.moveTo(px, 0);      ctx.lineTo(px, CANVAS_PX); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0,  px);     ctx.lineTo(CANVAS_PX, px); ctx.stroke()
    }
    // Thicker lines every 8 cells for 8×8 chunk guides
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)'
    ctx.lineWidth   = 1
    for (let i = 0; i <= GRID_SIZE; i += 8) {
      const px = i * CELL_SIZE
      ctx.beginPath(); ctx.moveTo(px, 0);      ctx.lineTo(px, CANVAS_PX); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0,  px);     ctx.lineTo(CANVAS_PX, px); ctx.stroke()
    }
  }
}

function gridToDataURL(grid: string[][]): string {
  const c   = document.createElement('canvas')
  c.width   = CANVAS_PX; c.height = CANVAS_PX
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let cc = 0; cc < GRID_SIZE; cc++) {
      const col = grid[r][cc]
      if (col) { ctx.fillStyle = col; ctx.fillRect(cc * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE) }
    }
  }
  return c.toDataURL('image/png')
}

function gridToSmallCanvas(grid: string[][]): HTMLCanvasElement {
  const c   = document.createElement('canvas')
  c.width   = GRID_SIZE; c.height = GRID_SIZE
  const ctx = c.getContext('2d')!
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let cc = 0; cc < GRID_SIZE; cc++) {
      const col = grid[r][cc]
      if (col) { ctx.fillStyle = col; ctx.fillRect(cc, r, 1, 1) }
    }
  }
  return c
}

// ── Component ──────────────────────────────────────────────
export default function DrawScene({ onPetCreated }: DrawSceneProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const decorateRef = useRef<HTMLCanvasElement>(null)
  const rafRef     = useRef(0)
  const btnRef     = useRef<HTMLButtonElement>(null)

  // Refs for stable event handlers
  const gridRef      = useRef<string[][]>(makeGrid())
  const toolRef      = useRef<Tool>('draw')
  const colorRef     = useRef(PALETTE[0])
  const brushRef     = useRef<BrushSize>(1)
  const isDrawRef    = useRef(false)
  const isDragEyeRef = useRef(false)

  const [grid, setGridState]      = useState<string[][]>(() => makeGrid())
  const historyRef = useRef<string[][][]>([])
  const [tool, setTool]           = useState<Tool>('draw')
  const [color, setColor]         = useState(PALETTE[0])
  const [brushSize, setBrushSize] = useState<BrushSize>(1)
  const [tab, setTab]             = useState<TabMode>('draw')
  const [step, setStep]           = useState<Step>('draw')
  const [onnxScore, setOnnxScore] = useState<number | null>(null)
  const [selectedEye, setSelectedEye] = useState<EyeOption>(EYES[0])
  const [eyePos, setEyePos]       = useState({ row: 20, col: 32 })
  const [petName, setPetName]     = useState('')
  const [particles, setParticles] = useState<Particle[]>([])
  const [storedPets, setStoredPets] = useState<StoredPet[]>([])
  const [showGrid, setShowGrid]   = useState(true)

  const blinkRef = useRef({ countdown: 210, frame: 0, blinking: false, cycle: 210 })

  // Keep refs in sync with state
  useEffect(() => { toolRef.current  = tool  }, [tool])
  useEffect(() => { colorRef.current = color }, [color])
  useEffect(() => { brushRef.current = brushSize }, [brushSize])

  // Stable grid updater
  const updateGrid = useCallback((next: string[][]) => {
    gridRef.current = next
    setGridState(next)
  }, [])

  // Load stored pets
  useEffect(() => {
    try {
      const raw = localStorage.getItem('oodle_pets')
      if (raw) setStoredPets(JSON.parse(raw) as StoredPet[])
    } catch { /**/ }
  }, [])

  // Render grid to canvas whenever grid state or showGrid changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    renderGridToCtx(ctx, grid, showGrid)
  }, [grid, showGrid])

  // Debounced validation
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (validateTimerRef.current) clearTimeout(validateTimerRef.current)
    validateTimerRef.current = setTimeout(() => {
      const small = gridToSmallCanvas(grid)
      validator.validate(small).then(r => setOnnxScore(r.score))
    }, 300)
    return () => { if (validateTimerRef.current) clearTimeout(validateTimerRef.current) }
  }, [grid])

  // ── Cell lookup ──────────────────────────────────────────
  const getCell = useCallback((clientX: number, clientY: number, ref: React.RefObject<HTMLCanvasElement | null>) => {
    const canvas = ref.current!
    const rect   = canvas.getBoundingClientRect()
    const scaleX = CANVAS_PX / rect.width
    const scaleY = CANVAS_PX / rect.height
    return {
      r: Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((clientY - rect.top)  * scaleY / CELL_SIZE))),
      c: Math.max(0, Math.min(GRID_SIZE - 1, Math.floor((clientX - rect.left) * scaleX / CELL_SIZE))),
    }
  }, [])

  // ── Draw tool application ─────────────────────────────────
  const applyDraw = useCallback((clientX: number, clientY: number, pushUndo: boolean) => {
    const { r, c } = getCell(clientX, clientY, canvasRef)
    if (pushUndo) historyRef.current = [...historyRef.current.slice(-19), gridRef.current.map(r => [...r])]
    const t  = toolRef.current
    const col = colorRef.current
    const bs = brushRef.current
    if (t === 'fill') {
      updateGrid(floodFill(gridRef.current, r, c, col))
    } else {
      updateGrid(paintBrush(gridRef.current, r, c, bs, col, t === 'erase'))
    }
  }, [getCell, updateGrid])

  // ── Mouse events (draw canvas) ────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    isDrawRef.current = true
    applyDraw(e.clientX, e.clientY, true)
  }, [applyDraw])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawRef.current || toolRef.current === 'fill') return
    applyDraw(e.clientX, e.clientY, false)
  }, [applyDraw])

  const handleMouseUp = useCallback(() => { isDrawRef.current = false }, [])

  // ── Touch events (non-passive) ────────────────────────────
  const handleTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault()
    isDrawRef.current = true
    const t = e.touches[0]
    applyDraw(t.clientX, t.clientY, true)
  }, [applyDraw])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault()
    if (!isDrawRef.current || toolRef.current === 'fill') return
    const t = e.touches[0]
    applyDraw(t.clientX, t.clientY, false)
  }, [applyDraw])

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    e.preventDefault()
    isDrawRef.current = false
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || step !== 'draw') return
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false })
    canvas.addEventListener('touchmove',  handleTouchMove,  { passive: false })
    canvas.addEventListener('touchend',   handleTouchEnd,   { passive: false })
    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart)
      canvas.removeEventListener('touchmove',  handleTouchMove)
      canvas.removeEventListener('touchend',   handleTouchEnd)
    }
  }, [step, handleTouchStart, handleTouchMove, handleTouchEnd])

  // ── Undo / Clear ──────────────────────────────────────────
  const handleUndo = useCallback(() => {
    if (historyRef.current.length === 0) return
    const prev = historyRef.current[historyRef.current.length - 1]
    historyRef.current = historyRef.current.slice(0, -1)
    updateGrid(prev)
  }, [updateGrid])

  const handleClear = useCallback(() => {
    historyRef.current = [...historyRef.current.slice(-19), gridRef.current.map(r => [...r])]
    updateGrid(makeGrid())
  }, [updateGrid])

  // ── Step: draw → decorate ────────────────────────────────
  const handleMakeItLife = useCallback(() => {
    if (!onnxScore || onnxScore < 0.6) return
    setStep('decorate')
  }, [onnxScore])

  // ── Decorate: preview animation ───────────────────────────
  const eyePosRef      = useRef(eyePos)
  const selectedEyeRef = useRef(selectedEye)
  useEffect(() => { eyePosRef.current = eyePos },      [eyePos])
  useEffect(() => { selectedEyeRef.current = selectedEye }, [selectedEye])

  useEffect(() => {
    if (step !== 'decorate') return
    const canvas = decorateRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false

    const img  = new Image()
    img.src    = gridToDataURL(gridRef.current)
    img.onload = () => {
      let frame = 0
      const b   = blinkRef.current

      const loop = () => {
        ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX)

        const bob = Math.floor(frame / 30) % 2 === 0 ? 0 : -1
        ctx.drawImage(img, 0, bob, CANVAS_PX, CANVAS_PX)

        b.countdown--
        if (b.countdown <= 0) {
          b.blinking = true; b.frame = 0
          b.countdown = 180 + Math.round((Math.random() - 0.5) * 120)
        }
        const blink = b.blinking && b.frame <= 6
        if (b.blinking) { b.frame++; if (b.frame > 6) b.blinking = false }

        const ep  = eyePosRef.current
        const eye = selectedEyeRef.current
        const ex  = ep.col * CELL_SIZE
        const ey  = ep.row * CELL_SIZE + bob
        drawEye(ctx, eye.id, ex - 40, ey, 20, blink)
        drawEye(ctx, eye.id, ex + 40, ey, 20, blink)

        frame++
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    return () => cancelAnimationFrame(rafRef.current)
  }, [step])

  // ── Decorate: eye drag ────────────────────────────────────
  const updateEyePos = useCallback((clientX: number, clientY: number) => {
    const canvas = decorateRef.current!
    const rect   = canvas.getBoundingClientRect()
    const scaleX = CANVAS_PX / rect.width
    const scaleY = CANVAS_PX / rect.height
    setEyePos({
      row: Math.max(5,  Math.min(GRID_SIZE - 5,  Math.floor((clientY - rect.top)  * scaleY / CELL_SIZE))),
      col: Math.max(10, Math.min(GRID_SIZE - 10, Math.floor((clientX - rect.left) * scaleX / CELL_SIZE))),
    })
  }, [])

  const handleDecMouseDown = useCallback((e: React.MouseEvent) => { isDragEyeRef.current = true;  updateEyePos(e.clientX, e.clientY) }, [updateEyePos])
  const handleDecMouseMove = useCallback((e: React.MouseEvent) => { if (isDragEyeRef.current) updateEyePos(e.clientX, e.clientY) }, [updateEyePos])
  const handleDecMouseUp   = useCallback(() => { isDragEyeRef.current = false }, [])

  // ── Particles ──────────────────────────────────────────────
  const spawnParticles = useCallback(() => {
    const btn = btnRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const cx   = rect.left + rect.width  / 2
    const cy   = rect.top  + rect.height / 2
    const ps   = Array.from({ length: 12 }, (_, i) => ({
      id: Date.now() + i, char: CHARS[i % CHARS.length],
      x: cx, y: cy, angle: (i / 12) * 360, distance: 60 + Math.random() * 60,
    }))
    setParticles(ps)
    setTimeout(() => setParticles([]), 900)
  }, [])

  // ── Confirm ───────────────────────────────────────────────
  const handleConfirm = useCallback(() => {
    const finalName  = petName.trim() || 'My Pet'
    const pixelData  = gridToDataURL(gridRef.current)
    const ep         = eyePos

    const coords: PetCoords = {
      eyes: [
        { x: (ep.col - 5) / GRID_SIZE, y: ep.row / GRID_SIZE },
        { x: (ep.col + 5) / GRID_SIZE, y: ep.row / GRID_SIZE },
      ],
      legs:     [],
      center:   { x: 0.5, y: 0.5 },
      has_eyes: true,
      has_legs: false,
    }

    localStorage.setItem('oodle_eye_style', selectedEye.id)
    localStorage.removeItem('oodle_leg_style')

    const newPet: StoredPet = { id: crypto.randomUUID(), pixelData, name: finalName }
    const updated = [...storedPets, newPet].slice(-20)
    setStoredPets(updated)
    localStorage.setItem('oodle_pets', JSON.stringify(updated))

    spawnParticles()
    setStep('done')
    onPetCreated(pixelData, coords, finalName)
  }, [petName, eyePos, selectedEye, storedPets, spawnParticles, onPetCreated])


  // ── Render ────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <div className={styles.titleBlock}>
        <h1 className={styles.title}>OODLE</h1>
        <p className={styles.sub}>draw a pixel pet. make it life.</p>
      </div>

      {step === 'draw' && (
        <>
          {/* Tab switcher */}
          <div className={styles.tabRow}>
            <button
              className={`${styles.tab} ${tab === 'draw' ? styles.tabActive : ''}`}
              onClick={() => setTab('draw')}
            >DRAW</button>
            <button
              className={`${styles.tab} ${tab === 'ai' ? styles.tabActive : ''}`}
              onClick={() => setTab('ai')}
            >AI GENERATE</button>
          </div>

          {tab === 'ai' ? (
            <div className={styles.aiPanel}>
              <div className={styles.premiumBadge}>✨ AI GENERATE</div>
              <p className={styles.aiDesc} style={{ color: '#FFE600', fontSize: '10px', marginTop: '24px' }}>COMING SOON</p>
              <p className={styles.aiDesc}>AI pixel art generation is on the way!</p>
            </div>
          ) : (
            <>
              {/* Validation label */}
              {onnxScore !== null && (
                <p
                  className={styles.validLabel}
                  style={{
                    color: onnxScore >= 0.6
                      ? '#4CAF50'
                      : onnxScore >= 0.3
                      ? '#F5A623'
                      : '#e94560',
                  }}
                >
                  {onnxScore >= 0.6
                    ? 'looks like a creature!'
                    : onnxScore >= 0.3
                    ? 'keep drawing...'
                    : 'not sure yet...'
                  } {Math.round(onnxScore * 100)}%
                </p>
              )}

              {/* Draw canvas */}
              <div className={styles.canvasWrap}>
                <canvas
                  ref={canvasRef}
                  width={CANVAS_PX}
                  height={CANVAS_PX}
                  className={styles.drawCanvas}
                  style={{ cursor: tool === 'erase' ? 'cell' : tool === 'fill' ? 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\'%3E%3Ctext y=\'14\' font-size=\'14\'%3E🪣%3C/text%3E%3C/svg%3E") 0 16, crosshair' : 'crosshair' }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                />
              </div>

              {/* ── Controls below canvas ── */}
              <div className={styles.controls}>

                {/* Row 1: Colour palette */}
                <div className={styles.controlRow}>
                  <div className={styles.palette}>
                    {PALETTE.map(c => (
                      <button
                        key={c}
                        className={`${styles.swatch} ${color === c && tool === 'draw' ? styles.swatchActive : ''}`}
                        style={{ background: c }}
                        onClick={() => { setColor(c); setTool('draw') }}
                      />
                    ))}
                  </div>
                </div>

                {/* Row 2: Tools + Brush size + Undo/Clear + Grid */}
                <div className={styles.controlRow}>
                  {/* Tools */}
                  <div className={styles.btnGroup}>
                    <button
                      className={`${styles.toolBtn} ${tool === 'draw'  ? styles.toolActive : ''}`}
                      onClick={() => setTool('draw')}
                    >✏️ Draw</button>
                    <button
                      className={`${styles.toolBtn} ${tool === 'erase' ? styles.toolActive : ''}`}
                      onClick={() => setTool('erase')}
                    >⬜ Erase</button>
                    <button
                      className={`${styles.toolBtn} ${tool === 'fill'  ? styles.toolActive : ''}`}
                      onClick={() => setTool('fill')}
                    >🪣 Fill</button>
                  </div>

                  <div className={styles.groupSep} />

                  {/* Brush size */}
                  <div className={styles.btnGroup}>
                    {([1, 2, 4] as const).map(bs => (
                      <button
                        key={bs}
                        className={`${styles.toolBtn} ${brushSize === bs ? styles.toolActive : ''}`}
                        onClick={() => setBrushSize(bs)}
                      >{bs}px</button>
                    ))}
                  </div>

                  <div className={styles.groupSep} />

                  {/* Undo / Clear / Grid */}
                  <div className={styles.btnGroup}>
                    <button className={styles.toolBtn} onClick={handleUndo}>↩ Undo</button>
                    <button className={styles.toolBtn} onClick={handleClear}>🗑 Clear</button>
                    <button
                      className={`${styles.toolBtn} ${showGrid ? styles.toolActive : ''}`}
                      onClick={() => setShowGrid(v => !v)}
                    >⊞ Grid</button>
                  </div>
                </div>

              </div>

              <button
                ref={btnRef}
                className={styles.ctaBtn}
                onClick={handleMakeItLife}
                disabled={!onnxScore || onnxScore < 0.6}
              >
                ✦ MAKE IT LIFE ✦
              </button>
            </>
          )}
        </>
      )}

      {step === 'decorate' && (
        <>
          <p className={styles.decorateHint}>PICK EYES · CLICK TO POSITION</p>

          <div className={styles.canvasWrap} style={{ cursor: 'crosshair' }}>
            <canvas
              ref={decorateRef}
              width={CANVAS_PX}
              height={CANVAS_PX}
              className={styles.drawCanvas}
              onMouseDown={handleDecMouseDown}
              onMouseMove={handleDecMouseMove}
              onMouseUp={handleDecMouseUp}
              onMouseLeave={handleDecMouseUp}
            />
          </div>

          {/* Eye picker */}
          <div className={styles.section}>
            <span className={styles.sectionLabel}>EYES</span>
            <div className={styles.eyeGrid}>
              {EYES.map(eye => (
                <button
                  key={eye.id}
                  className={[
                    styles.eyeBtn,
                    selectedEye.id === eye.id ? styles.eyeSelected : '',
                    !eye.free ? styles.eyeLocked : '',
                  ].join(' ')}
                  onClick={() => eye.free && setSelectedEye(eye)}
                >
                  <span className={styles.eyeLabel}>{eye.label}</span>
                  {!eye.free && <span className={styles.lockBadge}>🔒</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div className={styles.section}>
            <span className={styles.sectionLabel}>PET NAME</span>
            <input
              className={styles.nameInput}
              maxLength={16}
              placeholder="Biscuit, Noodle, Zap..."
              value={petName}
              onChange={e => setPetName(e.target.value)}
            />
          </div>

          <button
            className={`${styles.ctaBtn} ${styles.ctaBtnGreen}`}
            onClick={handleConfirm}
          >
            ✓ BRING IT TO LIFE!
          </button>
        </>
      )}

      {particles.map(p => (
        <span
          key={p.id}
          className={styles.particle}
          style={{
            left: p.x, top: p.y,
            '--angle': `${p.angle}deg`,
            '--dist':  `${p.distance}px`,
          } as React.CSSProperties}
        >
          {p.char}
        </span>
      ))}
    </div>
  )
}
