import { useRef, useState, useEffect, useCallback } from 'react'
import StatBar from '../ui/StatBar'
import { PetAnimator } from '../engine/PetAnimator'
import type { PetCoords } from '../api/aiRecognize'
import styles from './RoomScene.module.css'

interface PetStats {
  hunger: number
  happy: number
  energy: number
}

interface RoomSceneProps {
  petData: { pixelData: string; coords: PetCoords; name: string }
  onGoToPlaza: () => void
}

interface FloatEmoji {
  id: number
  char: string
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

const FEED_LINES = ['好吃！', '謝謝！', 'Yum!']
const PLAY_LINES = ['好開心！', 'Wee!', '嘻嘻！']

const PET_SIZE = 160

const DEFAULT_COORDS: PetCoords = {
  eyes:     [{ x: 0.35, y: 0.28 }, { x: 0.65, y: 0.28 }],
  legs:     [],
  center:   { x: 0.5, y: 0.5 },
  has_eyes: false,
  has_legs: false,
}

export default function RoomScene({ petData, onGoToPlaza }: RoomSceneProps) {
  const roomRef       = useRef<HTMLDivElement>(null)
  const petWrapperRef = useRef<HTMLDivElement>(null)
  const petCanvasRef  = useRef<HTMLCanvasElement>(null)
  const animatorRef   = useRef<PetAnimator | null>(null)
  const statsRef      = useRef<PetStats>({ hunger: 80, happy: 80, energy: 80 })

  const [stats, setStats]       = useState<PetStats>({ hunger: 80, happy: 80, energy: 80 })
  const [dayCount, setDayCount] = useState(1)
  const [floatEmojis, setFloatEmojis] = useState<FloatEmoji[]>([])
  const [bubble, setBubble]     = useState<{ text: string; id: number } | null>(null)

  useEffect(() => { statsRef.current = stats }, [stats])

  useEffect(() => {
    try {
      const s = localStorage.getItem('oodle_stats')
      if (s) { const p = JSON.parse(s) as PetStats; setStats(p); statsRef.current = p }
      const d = localStorage.getItem('oodle_day_count')
      if (d) setDayCount(parseInt(d, 10))
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    localStorage.setItem('oodle_stats', JSON.stringify(stats))
  }, [stats])

  useEffect(() => {
    localStorage.setItem('oodle_day_count', String(dayCount))
  }, [dayCount])

  // 狀態自動下降
  useEffect(() => {
    const decay = setInterval(() => {
      setStats(s => ({
        hunger: Math.max(0, s.hunger - 1),
        happy:  Math.max(0, s.happy  - 0.5),
        energy: Math.max(0, s.energy - 0.8),
      }))
    }, 30000)
    return () => clearInterval(decay)
  }, [])

  // 自動睡眠
  useEffect(() => {
    const check = setInterval(() => {
      const s = statsRef.current
      const animator = animatorRef.current
      if (!animator) return
      if (s.energy < 25) {
        animator.setState('sleep')
        setStats(prev => ({ ...prev, energy: Math.min(100, prev.energy + 2) }))
      } else if (s.energy >= 30) {
        animator.setState('walk')
      }
    }, 5000)
    return () => clearInterval(check)
  }, [])

  // 動畫主 loop
  useEffect(() => {
    const canvas  = petCanvasRef.current!
    const wrapper = petWrapperRef.current!
    const room    = roomRef.current!

    let mounted   = true
    let walkRafId = 0
    let x = 80, dir = 1

    const coords: PetCoords = (
      petData.coords && petData.coords.has_eyes
    ) ? petData.coords : DEFAULT_COORDS

    const eyeStyle = localStorage.getItem('oodle_eye_style') || 'eye_round'

    const animator = new PetAnimator(canvas, {
      imageDataURL: petData.pixelData,
      coords,
      size: PET_SIZE,
      eyeStyle,
    })
    animatorRef.current = animator
    animator.setState('walk')
    animator.start()

    // 走路 loop
    const walk = () => {
      if (!mounted) return
      const isSleeping = statsRef.current.energy < 25
      if (!isSleeping) {
        const maxX = room.offsetWidth - PET_SIZE
        x += 0.3 * dir
        if (x >= maxX) dir = -1
        if (x <= 0)    dir = 1
        wrapper.style.left = `${x}px`
        canvas.style.transform = dir === -1 ? 'scaleX(-1)' : 'none'
      }
      walkRafId = requestAnimationFrame(walk)
    }
    walkRafId = requestAnimationFrame(walk)

    return () => {
      mounted = false
      animator.stop()
      cancelAnimationFrame(walkRafId)
    }
  }, [petData])

  const showFloat = useCallback((char: string) => {
    const id = Date.now()
    setFloatEmojis(e => [...e, { id, char }])
    setTimeout(() => setFloatEmojis(e => e.filter(x => x.id !== id)), 1000)
  }, [])

  const showBubble = useCallback((text: string) => {
    const id = Date.now()
    setBubble({ text, id })
    setTimeout(() => setBubble(b => (b?.id === id ? null : b)), 2000)
  }, [])

  const handleFeed = useCallback(() => {
    setStats(s => ({ ...s, hunger: Math.min(100, s.hunger + 20) }))
    showFloat('🍖')
    showBubble(pick(FEED_LINES))
    animatorRef.current?.setState('eat')
    setTimeout(() => animatorRef.current?.setState('walk'), 2000)
    localStorage.setItem('oodle_last_fed', new Date().toISOString())
  }, [showFloat, showBubble])

  const handlePlay = useCallback(() => {
    setStats(s => ({ ...s, happy: Math.min(100, s.happy + 15) }))
    showFloat('⭐')
    showBubble(pick(PLAY_LINES))
    animatorRef.current?.setState('play')
    setTimeout(() => animatorRef.current?.setState('walk'), 2000)
  }, [showFloat, showBubble])

  return (
    <div className={styles.page}>
      <div className={styles.room} ref={roomRef}>

        <div className={styles.hud}>
          <StatBar label="🍖" value={stats.hunger} color="var(--color-hunger)" maxWidth={80} />
          <StatBar label="💛" value={stats.happy}  color="var(--color-happy)"  maxWidth={80} />
          <StatBar label="⚡" value={stats.energy} color="var(--color-energy)" maxWidth={80} />
        </div>

        <div className={styles.dayCounter}>DAY {dayCount}</div>
        <div className={styles.petNameDisplay}>{petData.name}</div>

        <div className={styles.petWrapper} ref={petWrapperRef}>
          <canvas
            ref={petCanvasRef}
            width={PET_SIZE}
            height={PET_SIZE}
            style={{ display:'block', background:'transparent', border:'none' }}
          />
          {bubble && (
            <div className={styles.bubble} key={bubble.id}>{bubble.text}</div>
          )}
          {floatEmojis.map(e => (
            <span key={e.id} className={styles.floatEmoji}>{e.char}</span>
          ))}
        </div>
      </div>

      <div className={styles.actionBar}>
        <button className={styles.actionBtn} onClick={handleFeed}>🍖 FEED</button>
        <button className={styles.actionBtn} onClick={handlePlay}>⭐ PLAY</button>
        <button className={`${styles.actionBtn} ${styles.plazaBtn}`} onClick={onGoToPlaza}>
          GO TO PLAZA →
        </button>
      </div>
    </div>
  )
}