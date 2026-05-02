import { useRef, useEffect, useState, useCallback } from 'react'
import styles from './PixelCanvas.module.css'

const CANVAS_SIZE = 400
const ERASER_SIZE = 20
const MAX_UNDO = 20

const PALETTE = [
  '#2C2C2C', '#FF5A5F', '#F5A623', '#FFE600',
  '#4CAF50', '#2196F3', '#9C27B0', '#FF9800',
  '#00BCD4', '#E91E63', '#8BC34A', '#FFFFFF',
]

type Tool = 'pencil' | 'eraser' | 'fill'

interface PixelCanvasProps {
  onComplete: (dataURL: string) => void
  onStroke?: () => void
}

function hexToRgba(hex: string): [number, number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]
}

function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillColor: string,
) {
  const imgData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE)
  const data = imgData.data
  const idx = (x: number, y: number) => (y * CANVAS_SIZE + x) * 4
  const si = idx(startX, startY)
  const target = [data[si], data[si + 1], data[si + 2], data[si + 3]] as const
  const fill = hexToRgba(fillColor)
  if (
    target[0] === fill[0] && target[1] === fill[1] &&
    target[2] === fill[2] && target[3] === fill[3]
  ) return
  const stack: [number, number][] = [[startX, startY]]
  const match = (x: number, y: number) => {
    const i = idx(x, y)
    return data[i] === target[0] && data[i+1] === target[1] &&
           data[i+2] === target[2] && data[i+3] === target[3]
  }
  while (stack.length) {
    const [x, y] = stack.pop()!
    if (x < 0 || x >= CANVAS_SIZE || y < 0 || y >= CANVAS_SIZE) continue
    if (!match(x, y)) continue
    const i = idx(x, y)
    data[i] = fill[0]; data[i+1] = fill[1]
    data[i+2] = fill[2]; data[i+3] = fill[3]
    stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1])
  }
  ctx.putImageData(imgData, 0, 0)
}

export default function PixelCanvas({ onComplete, onStroke }: PixelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const undoStack = useRef<ImageData[]>([])
  const isDrawing = useRef(false)
  const lastPos = useRef<[number, number] | null>(null)

  const [tool, setTool] = useState<Tool>('pencil')
  const [color, setColor] = useState(PALETTE[0])
  const [brushSize, setBrushSize] = useState(6)

  const getCtx = useCallback(() => {
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    return ctx
  }, [])

  const snapshot = useCallback(() => {
    const ctx = getCtx()
    const imgData = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    undoStack.current.push(imgData)
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift()
  }, [getCtx])

  useEffect(() => {
    const ctx = getCtx()
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
  }, [getCtx])

  const getCanvasPos = (e: MouseEvent | Touch): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const scaleX = CANVAS_SIZE / rect.width
    const scaleY = CANVAS_SIZE / rect.height
    return [
      (e.clientX - rect.left) * scaleX,
      (e.clientY - rect.top) * scaleY,
    ]
  }

  const drawStroke = useCallback((
    from: [number, number],
    to: [number, number]
  ) => {
    const ctx = getCtx()
    const isEraser = tool === 'eraser'
    ctx.save()
    ctx.strokeStyle = isEraser ? '#FFFFFF' : color
    ctx.fillStyle = isEraser ? '#FFFFFF' : color
    ctx.lineWidth = isEraser ? ERASER_SIZE : brushSize
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from[0], from[1])
    ctx.lineTo(to[0], to[1])
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(to[0], to[1], (isEraser ? ERASER_SIZE : brushSize) / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }, [tool, color, brushSize, getCtx])

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return
    snapshot()
    const pos = getCanvasPos(e)
    if (tool === 'fill') {
      floodFill(getCtx(), Math.floor(pos[0]), Math.floor(pos[1]), color)
      onStroke?.()
      onComplete(canvasRef.current!.toDataURL())
      return
    }
    isDrawing.current = true
    lastPos.current = pos
    drawStroke(pos, pos)
  }, [snapshot, tool, color, getCtx, drawStroke, onStroke, onComplete])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDrawing.current || !lastPos.current) return
    const pos = getCanvasPos(e)
    drawStroke(lastPos.current, pos)
    lastPos.current = pos
  }, [drawStroke])

  const handleMouseUp = useCallback(() => {
    if (!isDrawing.current) return
    isDrawing.current = false
    lastPos.current = null
    onStroke?.()
    onComplete(canvasRef.current!.toDataURL())
  }, [onStroke, onComplete])

  const handleTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault()
    snapshot()
    const pos = getCanvasPos(e.touches[0])
    if (tool === 'fill') {
      floodFill(getCtx(), Math.floor(pos[0]), Math.floor(pos[1]), color)
      onStroke?.()
      onComplete(canvasRef.current!.toDataURL())
      return
    }
    isDrawing.current = true
    lastPos.current = pos
    drawStroke(pos, pos)
  }, [snapshot, tool, color, getCtx, drawStroke, onStroke, onComplete])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault()
    if (!isDrawing.current || !lastPos.current) return
    const pos = getCanvasPos(e.touches[0])
    drawStroke(lastPos.current, pos)
    lastPos.current = pos
  }, [drawStroke])

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    e.preventDefault()
    if (!isDrawing.current) return
    isDrawing.current = false
    lastPos.current = null
    onStroke?.()
    onComplete(canvasRef.current!.toDataURL())
  }, [onStroke, onComplete])

  useEffect(() => {
    const canvas = canvasRef.current!
    canvas.addEventListener('mousedown', handleMouseDown)
    canvas.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false })
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false })
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false })
    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown)
      canvas.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      canvas.removeEventListener('touchstart', handleTouchStart)
      canvas.removeEventListener('touchmove', handleTouchMove)
      canvas.removeEventListener('touchend', handleTouchEnd)
    }
  }, [handleMouseDown, handleMouseMove, handleMouseUp,
      handleTouchStart, handleTouchMove, handleTouchEnd])

  const undo = useCallback(() => {
    if (!undoStack.current.length) return
    const ctx = getCtx()
    ctx.putImageData(undoStack.current.pop()!, 0, 0)
    onComplete(canvasRef.current!.toDataURL())
  }, [getCtx, onComplete])

  const clear = useCallback(() => {
    snapshot()
    const ctx = getCtx()
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    onComplete(canvasRef.current!.toDataURL())
  }, [snapshot, getCtx, onComplete])

  return (
    <div className={styles.wrapper}>
      <div className={styles.canvasWrap}>
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          className={styles.canvas}
        />
      </div>

      <div className={styles.palette}>
        {PALETTE.map((c) => (
          <button
            key={c}
            className={styles.swatch}
            style={{
              background: c,
              outline: c === color && tool !== 'eraser'
                ? '3px solid #2C2C2C' : '3px solid transparent',
              outlineOffset: '2px',
            }}
            onClick={() => { setColor(c); setTool('pencil') }}
          />
        ))}
      </div>

      <div className={styles.tools}>
        <button
          className={`${styles.toolBtn} ${tool === 'pencil' ? styles.active : ''}`}
          onClick={() => setTool('pencil')}
        >✏️ Draw</button>
        <button
          className={`${styles.toolBtn} ${tool === 'eraser' ? styles.active : ''}`}
          onClick={() => setTool('eraser')}
        >⌫ Erase</button>
        <button
          className={`${styles.toolBtn} ${tool === 'fill' ? styles.active : ''}`}
          onClick={() => setTool('fill')}
        >🪣 Fill</button>
        <button className={styles.toolBtn} onClick={undo}>↩ Undo</button>
        <button className={styles.toolBtn} onClick={clear}>🗑 Clear</button>
      </div>

      {/* 筆刷大小滑桿 */}
      <div className={styles.brushSlider}>
        <span className={styles.brushLabel}>✏️</span>
        <input
          type="range"
          min="2"
          max="30"
          value={brushSize}
          onChange={(e) => { setBrushSize(Number(e.target.value)); setTool('pencil') }}
          className={styles.slider}
        />
        <span
          className={styles.brushPreview}
          style={{
            width: brushSize + 4,
            height: brushSize + 4,
            background: color,
          }}
        />
      </div>

    </div>
  )
}