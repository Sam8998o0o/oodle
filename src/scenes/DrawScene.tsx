import { useRef, useState, useEffect, useCallback } from 'react'
import { OnnxValidator } from '../engine/OnnxValidator'
import { drawEye } from '../engine/drawEye'
import type { PetCoords } from '../api/aiRecognize'
import { generatePetImage, validatePetImage } from '../lib/aiService'
import { useAuthStore } from '../lib/auth'
import { savePet } from '../lib/petService'
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


const validator = new OnnxValidator()

type Tool      = 'draw' | 'erase' | 'fill'
type BrushSize = 1 | 2 | 4
type Step      = 'draw' | 'decorate' | 'done'
type TabMode   = 'draw' | 'ai' | 'import'

interface EyeOption { id: string; label: string; free: boolean }
interface Particle  { id: number; char: string; x: number; y: number; angle: number; distance: number }
interface StoredPet { id: string; pixelData: string; name: string }

interface DrawSceneProps {
  onPetCreated: (pixelData: string, coords: PetCoords, name: string) => void
  isPremium: boolean
  onSubscribeClick: () => void
  initialStep?: 'draw' | 'decorate'
  initialPixelData?: string
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
  ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX)
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

// ── Decode a data URL back into a grid ────────────────────
async function dataURLToGrid(dataURL: string): Promise<string[][]> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const offscreen = document.createElement('canvas')
      offscreen.width  = GRID_SIZE
      offscreen.height = GRID_SIZE
      const ctx = offscreen.getContext('2d')!
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE)
      const imageData = ctx.getImageData(0, 0, GRID_SIZE, GRID_SIZE)
      const newGrid = makeGrid()
      for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
          const i = (r * GRID_SIZE + c) * 4
          if (imageData.data[i + 3] < 128) { newGrid[r][c] = ''; continue }
          const rr = imageData.data[i], gg = imageData.data[i + 1], bb = imageData.data[i + 2]
          let best = PALETTE[0], bestDist = Infinity
          for (const hex of PALETTE) {
            const pr = parseInt(hex.slice(1, 3), 16)
            const pg = parseInt(hex.slice(3, 5), 16)
            const pb = parseInt(hex.slice(5, 7), 16)
            const d  = (rr - pr) ** 2 + (gg - pg) ** 2 + (bb - pb) ** 2
            if (d < bestDist) { bestDist = d; best = hex }
          }
          newGrid[r][c] = best
        }
      }
      resolve(newGrid)
    }
    img.src = dataURL
  })
}

// ── Component ──────────────────────────────────────────────
export default function DrawScene({ onPetCreated, isPremium, onSubscribeClick, initialStep, initialPixelData }: DrawSceneProps) {
  const { userId } = useAuthStore()

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
  const [particles] = useState<Particle[]>([])
  const [_storedPets, setStoredPets] = useState<StoredPet[]>([])
  const [showGrid, setShowGrid]   = useState(true)
  const [importLocked, setImportLocked] = useState(false)
  const [importError,  setImportError]  = useState('')
  const [aiPrompt,     setAiPrompt]     = useState('')
  const [aiLoading,    setAiLoading]    = useState(false)
  const [aiError,      setAiError]      = useState('')
  const [isConfirming,   setIsConfirming]   = useState(false)
  const [confirmError,   setConfirmError]   = useState<string | null>(null)
  const [showShareModal, setShowShareModal] = useState(false)

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

  // Resume at decorate step after sign-in redirect
  useEffect(() => {
    if (initialStep !== 'decorate' || !initialPixelData) return
    dataURLToGrid(initialPixelData).then(newGrid => {
      updateGrid(newGrid)
      setStep('decorate')
    })
  }, [initialStep, initialPixelData, updateGrid])

  const importImage = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = async () => {
        const offscreen = document.createElement('canvas')
        offscreen.width = GRID_SIZE
        offscreen.height = GRID_SIZE
        const ctx = offscreen.getContext('2d')!
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE)
        const imageData = ctx.getImageData(0, 0, GRID_SIZE, GRID_SIZE)
        const newGrid = makeGrid()
        for (let r = 0; r < GRID_SIZE; r++) {
          for (let c = 0; c < GRID_SIZE; c++) {
            const i = (r * GRID_SIZE + c) * 4
            const a = imageData.data[i + 3]
            if (a < 128) { newGrid[r][c] = ''; continue }
            const rr = imageData.data[i]
            const gg = imageData.data[i + 1]
            const bb = imageData.data[i + 2]
            let best = PALETTE[0], bestDist = Infinity
            for (const hex of PALETTE) {
              const pr = parseInt(hex.slice(1, 3), 16)
              const pg = parseInt(hex.slice(3, 5), 16)
              const pb = parseInt(hex.slice(5, 7), 16)
              const d = (rr - pr) ** 2 + (gg - pg) ** 2 + (bb - pb) ** 2
              if (d < bestDist) { bestDist = d; best = hex }
            }
            if (best === '#ffffff' && !(rr > 240 && gg > 240 && bb > 240)) {
              newGrid[r][c] = ''
            } else {
              newGrid[r][c] = best
            }
          }
        }

        // Remove background: flood fill from all 4 corners
        const bgColors = new Set([
          newGrid[0][0],
          newGrid[0][GRID_SIZE - 1],
          newGrid[GRID_SIZE - 1][0],
          newGrid[GRID_SIZE - 1][GRID_SIZE - 1],
        ])
        bgColors.delete('')  // don't flood-fill already empty cells
        bgColors.delete('#ffffff')  // white is too common in characters, skip it
        bgColors.delete('#eaeaea')  // also skip near-white

        for (const bgColor of bgColors) {
          if (!bgColor) continue
          const stack: [number, number][] = [
            [0, 0], [0, GRID_SIZE - 1],
            [GRID_SIZE - 1, 0], [GRID_SIZE - 1, GRID_SIZE - 1]
          ]
          const visited = new Set<string>()
          while (stack.length) {
            const [r, c] = stack.pop()!
            const key = `${r},${c}`
            if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue
            if (visited.has(key)) continue
            if (newGrid[r][c] !== bgColor) continue
            visited.add(key)
            newGrid[r][c] = ''
            stack.push([r-1,c],[r+1,c],[r,c-1],[r,c+1])
          }
        }

        const base64 = offscreen.toDataURL('image/png').split(',')[1]
        const validation = await validatePetImage(base64)
        if (!validation.pass) {
          setImportError(`Not a pet! Try a simpler creature. (${validation.reason})`)
          return
        }
        setImportError('')
        updateGrid(newGrid)
        setTab('draw')
        setImportLocked(true)
        setOnnxScore(null)
      }
      img.src = e.target!.result as string
    }
    reader.readAsDataURL(file)
  }, [updateGrid])

  const handleAiGenerate = useCallback(async () => {
    if (!aiPrompt.trim()) return
    setAiLoading(true)
    setAiError('')
    const base64 = await generatePetImage(aiPrompt.trim())
    if (!base64) {
      setAiError('Generation failed. Try again.')
      setAiLoading(false)
      return
    }
    const img = new Image()
    img.onload = () => {
      const offscreen = document.createElement('canvas')
      offscreen.width = GRID_SIZE
      offscreen.height = GRID_SIZE
      const ctx = offscreen.getContext('2d')!
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0, GRID_SIZE, GRID_SIZE)
      const imageData = ctx.getImageData(0, 0, GRID_SIZE, GRID_SIZE)
      const newGrid = makeGrid()
      for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
          const i = (r * GRID_SIZE + c) * 4
          const a = imageData.data[i + 3]
          if (a < 128) { newGrid[r][c] = ''; continue }
          const rr = imageData.data[i]
          const gg = imageData.data[i + 1]
          const bb = imageData.data[i + 2]
          let best = PALETTE[0], bestDist = Infinity
          for (const hex of PALETTE) {
            const pr = parseInt(hex.slice(1, 3), 16)
            const pg = parseInt(hex.slice(3, 5), 16)
            const pb = parseInt(hex.slice(5, 7), 16)
            const d = (rr - pr) ** 2 + (gg - pg) ** 2 + (bb - pb) ** 2
            if (d < bestDist) { bestDist = d; best = hex }
          }
          if (best === '#ffffff' && !(rr > 240 && gg > 240 && bb > 240)) {
            newGrid[r][c] = ''
          } else {
            newGrid[r][c] = best
          }
        }
      }
      const bgColors = new Set([
        newGrid[0][0], newGrid[0][GRID_SIZE - 1],
        newGrid[GRID_SIZE - 1][0], newGrid[GRID_SIZE - 1][GRID_SIZE - 1],
      ])
      bgColors.delete('')
      bgColors.delete('#ffffff')
      bgColors.delete('#eaeaea')
      for (const bgColor of bgColors) {
        if (!bgColor) continue
        const stack: [number, number][] = [
          [0, 0], [0, GRID_SIZE - 1],
          [GRID_SIZE - 1, 0], [GRID_SIZE - 1, GRID_SIZE - 1],
        ]
        const visited = new Set<string>()
        while (stack.length) {
          const [r, c] = stack.pop()!
          const key = `${r},${c}`
          if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) continue
          if (visited.has(key)) continue
          if (newGrid[r][c] !== bgColor) continue
          visited.add(key)
          newGrid[r][c] = ''
          stack.push([r-1,c],[r+1,c],[r,c-1],[r,c+1])
        }
      }
      updateGrid(newGrid)
      setTab('draw')
      setAiLoading(false)
    }
    img.onerror = () => {
      setAiError('Failed to load generated image.')
      setAiLoading(false)
    }
    img.src = `data:image/png;base64,${base64}`
  }, [aiPrompt, updateGrid])

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
    if (!onnxScore || onnxScore < 0.65) return
    setStep('decorate')
  }, [onnxScore])

  // Save drawing to localStorage then open sign-in modal (unsigned path)
  const handleMakeItLifeUnsigned = useCallback(() => {
    const pixelData = gridToDataURL(gridRef.current)
    localStorage.setItem('oodle_resume_draw', pixelData)
    useAuthStore.getState().setShowSignInModal(true)
  }, [])

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

  // ── Confirm ───────────────────────────────────────────────
  // Signed-in user (returning, dead pet): save directly and enter game.
  // New user (no session): stash pending pet in localStorage, redirect to Google.
  // App.tsx picks up 'oodle_pending_pet' on return and finishes the flow.
  const handleConfirm = useCallback(async () => {
    setIsConfirming(true)
    setConfirmError(null)
    try {
      const finalName = petName.trim() || 'My Pet'
      const pixelData = gridToDataURL(gridRef.current)
      const ep        = eyePos

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

      if (userId) {
        // Already signed in — save pet directly and enter game
        const id = await savePet({ name: finalName, pixelData, coords })
        if (!id) {
          setConfirmError('Could not save pet. Please try again.')
          setIsConfirming(false)
          return
        }
        onPetCreated(pixelData, coords, finalName)
      } else {
        // Not signed in — stash pet and open sign-in modal via store
        localStorage.setItem('oodle_pending_pet', JSON.stringify({ name: finalName, pixelData, coords }))
        setIsConfirming(false)
        useAuthStore.getState().setShowSignInModal(true)
      }
    } catch {
      setConfirmError('Something went wrong. Please try again.')
      setIsConfirming(false)
    }
  }, [petName, eyePos, selectedEye, userId, onPetCreated])


  // ── Render ────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      {!userId && (
        <button className={styles.signInBtn} onClick={() => useAuthStore.getState().setShowSignInModal(true)}>
          SIGN IN
        </button>
      )}

      <div className={styles.titleBlock}>
        <h1 className={styles.title}>OODLE</h1>
        <p className={styles.sub}>draw a pixel pet. make it life.</p>
      </div>

      <button
        onClick={() => setShowShareModal(true)}
        style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '8px',
          padding: '8px 14px',
          background: '#FFE600',
          color: '#2C2C2C',
          border: '2px solid #2C2C2C',
          boxShadow: '3px 3px 0 #2C2C2C',
          cursor: 'pointer',
          letterSpacing: '1px',
          marginBottom: '4px',
        }}
      >
        ✦ SHARE YOUR IP
      </button>

      {step === 'draw' && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'stretch', gap: '12px', width: '100%', maxWidth: '720px', margin: '0 auto' }}>

          {/* ── LEFT COLUMN ── */}
          <div style={{ width: '150px', flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div className={styles.drawGuide}>
              <div className={styles.drawGuideTitle}>HOW TO DRAW</div>
              <div className={styles.drawGuideTips}>
                <div>✦ DRAW AN OUTLINE</div>
                <div>✦ FILL WITH COLOURS</div>
                <div>✦ USE 3+ COLORS</div>
                <div>✦ ADD EYES / FACE</div>
                <div>✦ NEED 65% TO PASS</div>
              </div>
            </div>
            <div className={styles.drawGuide}>
              <div className={styles.drawGuideTitle}>HOW TO IMPORT</div>
              <div className={styles.drawGuideTips}>
                <div>✦ CLICK IMPORT TAB</div>
                <div>✦ UPLOAD ANY IMAGE</div>
                <div>✦ BG AUTO-REMOVED</div>
                <div>✦ EDIT IF NEEDED</div>
                <div>✦ NEED 65% TO PASS</div>
              </div>
            </div>
            {/* Color swatches */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', paddingTop: '4px' }}>
              {PALETTE.map((c, i) => (
                <button
                  key={c}
                  className={`${styles.swatch} ${color === c && tool === 'draw' ? styles.swatchActive : ''}`}
                  style={{ background: c, transform: `rotate(${(-14 + i * 1.933).toFixed(1)}deg)` }}
                  onClick={() => { setColor(c); setTool('draw') }}
                />
              ))}
            </div>
          </div>

          {/* ── CENTER COLUMN ── */}
          <div style={{ flex: 1, maxWidth: '420px', minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'stretch' }}>

            {/* Tab row */}
            <div className={styles.tabRow}>
              <button
                className={`${styles.tab} ${tab === 'draw' ? styles.tabActive : ''}`}
                onClick={() => setTab('draw')}
              >DRAW</button>
              <button
                className={`${styles.tab} ${tab === 'ai' ? styles.tabActive : ''}`}
                onClick={() => setTab('ai')}
                style={{ position: 'relative' }}
              >AI GENERATE{!isPremium && <span className={styles.proBadge}>PRO</span>}</button>
              <button
                className={`${styles.tab} ${tab === 'import' ? styles.tabActive : ''}`}
                onClick={() => setTab('import')}
                style={{ position: 'relative' }}
              >IMPORT{!isPremium && <span className={styles.proBadge}>PRO</span>}</button>
            </div>

            {tab === 'import' ? (
              <div className={styles.aiPanel} style={{ width: '100%', boxSizing: 'border-box' }}>
                {!isPremium ? (
                  <>
                    <div className={styles.premiumBadge}>🔒 PRO FEATURE</div>
                    <p className={styles.aiDesc}>Import any image and turn it into your pixel pet!</p>
                    <button className={styles.subscribeUnlockBtn} onClick={userId ? onSubscribeClick : () => useAuthStore.getState().setShowSignInModal(true)}>
                      {userId ? 'UNLOCK $2.99/mo' : 'SIGN IN TO SUBSCRIBE'}
                    </button>
                  </>
                ) : (
                  <>
                    <p className={styles.aiDesc}>Upload any image — meme, photo, or pixel art. We'll pixelate it for you!</p>
                    <label style={{
                      display: 'block', width: '100%', padding: '14px',
                      background: '#FFE600', color: '#2C2C2C',
                      border: '2px solid #2C2C2C', boxShadow: '4px 4px 0 #2C2C2C',
                      fontFamily: 'var(--font-pixel)', fontSize: '10px',
                      textAlign: 'center', cursor: 'pointer', letterSpacing: '2px',
                      boxSizing: 'border-box',
                    }}>
                      📁 CHOOSE IMAGE
                      <input type="file" accept="image/*" style={{ display: 'none' }}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) importImage(f) }}
                      />
                    </label>
                    <p style={{ fontFamily: 'var(--font-pixel)', fontSize: '7px', color: '#888', textAlign: 'center', margin: 0 }}>
                      Works best with simple images or existing pixel art
                    </p>
                    {importError && (
                      <p style={{ fontFamily: 'var(--font-pixel)', fontSize: '7px', color: '#e94560', textAlign: 'center', margin: 0 }}>
                        {importError}
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : tab === 'ai' ? (
              <div className={styles.aiPanel} style={{ width: '100%', boxSizing: 'border-box' }}>
                {!isPremium ? (
                  <>
                    <div className={styles.premiumBadge}>🔒 PREMIUM</div>
                    <p className={styles.aiDesc}>Let AI draw your pixel pet for you!</p>
                    <input className={styles.aiInput} placeholder="a chubby space cat..." disabled />
                    <button className={styles.generateBtn} disabled>GENERATE</button>
                    <button className={styles.subscribeUnlockBtn} onClick={userId ? onSubscribeClick : () => useAuthStore.getState().setShowSignInModal(true)}>
                      {userId ? 'SUBSCRIBE TO UNLOCK' : 'SIGN IN TO SUBSCRIBE'}
                    </button>
                  </>
                ) : (
                  <>
                    <p className={styles.aiDesc}>Let AI draw your pixel pet for you!</p>
                    <input
                      className={styles.aiInput}
                      placeholder="a chubby space cat..."
                      value={aiPrompt}
                      onChange={e => setAiPrompt(e.target.value)}
                      disabled={aiLoading}
                    />
                    <button
                      className={styles.generateBtn}
                      onClick={handleAiGenerate}
                      disabled={aiLoading || !aiPrompt.trim()}
                    >
                      {aiLoading ? 'GENERATING...' : 'GENERATE'}
                    </button>
                    {aiError && (
                      <p style={{ fontFamily: 'var(--font-pixel)', fontSize: '7px', color: '#e94560', margin: 0, textAlign: 'center' }}>
                        {aiError}
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : (
              <>
                {/* Import-lock banner */}
                {importLocked && (
                  <div style={{
                    width: '100%', background: '#e94560', color: '#fff',
                    fontFamily: 'var(--font-pixel)', fontSize: '8px',
                    padding: '8px 12px', display: 'flex',
                    justifyContent: 'space-between', alignItems: 'center',
                    border: '2px solid #2C2C2C', boxSizing: 'border-box',
                    letterSpacing: '1px'
                  }}>
                    <span>✏️ SIMPLIFY TO LOOK LIKE A PET</span>
                    <button
                      onClick={() => { setImportLocked(false); setOnnxScore(null) }}
                      style={{
                        fontFamily: 'var(--font-pixel)', fontSize: '7px',
                        background: '#FFE600', color: '#2C2C2C',
                        border: '2px solid #2C2C2C', padding: '4px 10px',
                        cursor: 'pointer', letterSpacing: '1px'
                      }}
                    >✓ DONE EDITING</button>
                  </div>
                )}

                {/* Validation label */}
                {onnxScore !== null && (
                  <p
                    className={styles.validLabel}
                    style={{
                      textAlign: 'center',
                      color: onnxScore >= 0.65
                        ? '#4CAF50'
                        : onnxScore >= 0.3
                        ? '#F5A623'
                        : '#e94560',
                    }}
                  >
                    {onnxScore >= 0.65
                      ? 'looks like a creature!'
                      : onnxScore >= 0.3
                      ? 'keep drawing...'
                      : 'not sure yet...'
                    } {Math.round(onnxScore * 100)}%
                  </p>
                )}

                {/* Canvas */}
                <div className={styles.canvasWrap} style={{ width: '100%' }}>
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

                {/* MAKE IT LIFE button */}
                <button
                  ref={btnRef}
                  className={styles.ctaBtn}
                  onClick={userId ? handleMakeItLife : handleMakeItLifeUnsigned}
                  disabled={importLocked || !onnxScore || onnxScore < 0.65}
                >
                  {userId ? '✦ MAKE IT LIFE ✦' : 'SIGN IN TO MAKE IT LIFE'}
                </button>
              </>
            )}

          </div>

          {/* ── RIGHT COLUMN ── */}
          <div style={{ width: '110px', flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            {([
              { label: 'PEN',   action: () => setTool('draw'),              active: tool === 'draw'   },
              { label: 'DEL',   action: () => setTool('erase'),             active: tool === 'erase'  },
              { label: 'FILL',  action: () => setTool('fill'),              active: tool === 'fill'   },
              { label: '1PX',   action: () => setBrushSize(1 as BrushSize), active: brushSize === 1   },
              { label: '2PX',   action: () => setBrushSize(2 as BrushSize), active: brushSize === 2   },
              { label: '4PX',   action: () => setBrushSize(4 as BrushSize), active: brushSize === 4   },
              { label: 'UNDO',  action: handleUndo,                         active: false             },
              { label: 'CLEAR', action: handleClear,                        active: false             },
              { label: 'GRID',  action: () => setShowGrid(g => !g),         active: showGrid          },
            ] as { label: string; action: () => void; active: boolean }[]).map((item, i) => (
              <button
                key={item.label}
                className={`${styles.toolBtn} ${item.active ? styles.toolActive : ''}`}
                style={{ transform: `rotate(${(-13 + i * 2.75).toFixed(1)}deg) translateX(${(i % 3) * 4}px)` }}
                onClick={item.action}
              >
                {item.label}
              </button>
            ))}
          </div>

        </div>
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
              {EYES.map(eye => {
                const isLocked = !isPremium && ['eye_star', 'eye_heart', 'eye_x'].includes(eye.id)
                return (
                  <button
                    key={eye.id}
                    className={[
                      styles.eyeBtn,
                      selectedEye.id === eye.id ? styles.eyeSelected : '',
                      isLocked ? styles.eyeLocked : '',
                    ].join(' ')}
                    onClick={() => !isLocked && setSelectedEye(eye)}
                  >
                    <span className={styles.eyeLabel}>{eye.label}</span>
                    {isLocked && <span className={styles.lockBadge}>🔒</span>}
                  </button>
                )
              })}
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
            disabled={isConfirming}
          >
            {isConfirming
              ? (userId ? 'Setting up...' : 'Redirecting to Google...')
              : (userId ? '✓ BRING IT TO LIFE!' : 'SIGN UP TO MAKE IT LIFE')}
          </button>
          {confirmError && (
            <div style={{ color: '#e94560', fontFamily: 'var(--font-pixel)', fontSize: '10px', marginTop: 8, textAlign: 'center' }}>
              {confirmError}
            </div>
          )}
        </>
      )}

      {/* ── SHARE TO OODLE CREATORS MODAL ──────────────── */}
      {showShareModal && (
        <div
          onClick={() => setShowShareModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#FDF6E3', border: '3px solid #2C2C2C', boxShadow: '6px 6px 0 #2C2C2C', maxWidth: '360px', width: '100%', position: 'relative' }}
          >
            <div style={{ background: '#2C2C2C', color: '#FFE600', fontFamily: 'var(--font-pixel)', fontSize: '9px', textAlign: 'center', padding: '14px', letterSpacing: '2px' }}>
              ✦ SHARE TO OODLE CREATORS
            </div>
            <button
              onClick={() => setShowShareModal(false)}
              style={{ position: 'absolute', top: '8px', right: '8px', fontFamily: 'var(--font-pixel)', fontSize: '12px', background: 'transparent', border: '2px solid #FFE600', color: '#FFE600', width: '28px', height: '28px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >✕</button>
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
              <p style={{ fontFamily: 'var(--font-retro)', fontSize: '19px', color: '#2C2C2C', textAlign: 'center', margin: 0, lineHeight: 1.6 }}>
                Bring your character to the world&apos;s first IP creator community
              </p>
              <a
                href={`http://localhost:3000/create?name=${encodeURIComponent(petName || 'my pet')}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'block', width: '100%', fontFamily: 'var(--font-pixel)', fontSize: '9px', padding: '14px 16px', background: '#FFE600', color: '#2C2C2C', border: '3px solid #2C2C2C', boxShadow: '4px 4px 0 #2C2C2C', cursor: 'pointer', letterSpacing: '1px', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' }}
              >
                GO TO OODLE CREATORS →
              </a>
              <button
                onClick={() => setShowShareModal(false)}
                style={{ fontFamily: 'var(--font-pixel)', fontSize: '7px', color: '#888', background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                DISMISS
              </button>
            </div>
          </div>
        </div>
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
