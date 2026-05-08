import { useRef, useState, useEffect, useCallback } from 'react'
import StatBar from '../ui/StatBar'
import { PetAnimator } from '../engine/PetAnimator'
import type { PetCoords } from '../api/aiRecognize'
import { savePet, getLikeBalance, redeemLikesForFood } from '../lib/petService'
import styles from './RoomScene.module.css'

interface PetStats {
  hunger: number
  happy:  number
  energy: number
}

interface RoomSceneProps {
  petData: { pixelData: string; coords: PetCoords; name: string }
  onGoToPlaza: () => void
}

interface FloatEmoji {
  id:   number
  char: string
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

const FEED_LINES = ['Yummy!', 'Thank you!', 'So good!']

const PET_SIZE        = 160
const SMALL_HUNGER    = 10
const BIG_HUNGER      = 20
const DAILY_EAT_LIMIT = 5

type DoorPhase = 'idle' | 'appearing' | 'opening' | 'walking' | 'done'

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
  const walkRafRef    = useRef(0)
  const walkXRef      = useRef(80)
  const walkDirRef    = useRef(1)

  // ── Drag / throw / dizzy refs ─────────────────────────────
  const isDraggingRef    = useRef(false)
  const dragOffsetRef    = useRef({ x: 0, y: 0 })
  const lastPosRef       = useRef({ x: 0, y: 0 })
  const velRef           = useRef({ x: 0, y: 0 })
  const throwRafRef      = useRef(0)
  const throwCountRef    = useRef(0)   // how many times thrown this session
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLongPressRef   = useRef(false)

  const [stats, setStats]             = useState<PetStats>({ hunger: 80, happy: 80, energy: 80 })
  const [dayCount, setDayCount]       = useState(1)
  const [floatEmojis, setFloatEmojis] = useState<FloatEmoji[]>([])
  const [bubble, setBubble]           = useState<{ text: string; id: number } | null>(null)

  // ── Like-exchange food system ────────────────────────────
  const [likeBalance, setLikeBalance] = useState(0)
  const [smallFood,   setSmallFood]   = useState(0)
  const [bigFood,     setBigFood]     = useState(0)
  const [todayEats,   setTodayEats]   = useState(0)

  // ── Door transition ───────────────────────────────────────
  const [doorPhase, setDoorPhase] = useState<DoorPhase>('idle')
  const [petSaved,  setPetSaved]  = useState(false)
  const [isDizzy,   setIsDizzy]   = useState(false)

  // ── Day / Night + Weekend ─────────────────────────────────
  const [isNight,   setIsNight]   = useState(() => { const h = new Date().getHours(); return h >= 22 || h < 6 })
  const [isWeekend, setIsWeekend] = useState(() => { const d = new Date().getDay();   return d === 0 || d === 6 })

  useEffect(() => { statsRef.current = stats }, [stats])

  // ── Save pet to Supabase (once, idempotent) ───────────────
  useEffect(() => {
    savePet({
      name:      petData.name,
      pixelData: petData.pixelData,
      coords:    petData.coords,
    })
      .then(() => setPetSaved(true))
      .catch(() => setPetSaved(true))
  }, [petData])

  // ── Load like balance from Supabase ───────────────────────
  useEffect(() => {
    getLikeBalance()
      .then(b => setLikeBalance(b))
      .catch(() => {})
  }, [])

  // ── Load localStorage ─────────────────────────────────────
  useEffect(() => {
    try {
      const s = localStorage.getItem('oodle_stats')
      if (s) { const p = JSON.parse(s) as PetStats; setStats(p); statsRef.current = p }
      const d = localStorage.getItem('oodle_day_count')
      if (d) setDayCount(parseInt(d, 10))
      // Food state (persisted separately from the old key_state)
      const fs = localStorage.getItem('oodle_food_state')
      if (fs) {
        const fp = JSON.parse(fs) as { smallFood?: number; bigFood?: number; todayEats?: number; eatDate?: string }
        setSmallFood(fp.smallFood ?? 0)
        setBigFood(fp.bigFood   ?? 0)
        const today = new Date().toDateString()
        setTodayEats(fp.eatDate === today ? (fp.todayEats ?? 0) : 0)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { localStorage.setItem('oodle_stats',      JSON.stringify(stats))    }, [stats])
  useEffect(() => { localStorage.setItem('oodle_day_count',  String(dayCount))          }, [dayCount])
  useEffect(() => {
    localStorage.setItem('oodle_food_state', JSON.stringify({
      smallFood, bigFood, todayEats,
      eatDate: new Date().toDateString(),
    }))
  }, [smallFood, bigFood, todayEats])

  // ── Stat decay (halved on weekends) ──────────────────────
  useEffect(() => {
    const interval = isWeekend ? 60000 : 30000
    const decay = setInterval(() => {
      setStats(s => ({
        hunger: Math.max(0, s.hunger - 1),
        happy:  Math.max(0, s.happy  - 0.5),
        energy: Math.max(0, s.energy - 0.8),
      }))
    }, interval)
    return () => clearInterval(decay)
  }, [isWeekend])

  // ── Auto sleep ────────────────────────────────────────────
  useEffect(() => {
    const check = setInterval(() => {
      const s       = statsRef.current
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

  // ── Time check (every minute) ─────────────────────────────
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setIsNight(now.getHours() >= 22 || now.getHours() < 6)
      setIsWeekend(now.getDay() === 0 || now.getDay() === 6)
    }
    const id = setInterval(tick, 60000)
    return () => clearInterval(id)
  }, [])

  // ── Night → force sleep ───────────────────────────────────
  useEffect(() => {
    if (isNight) animatorRef.current?.setState('sleep')
  }, [isNight])

  // ── Weekend celebration: random play every 30 s ───────────
  useEffect(() => {
    if (!isWeekend) return
    const id = setInterval(() => {
      if (Math.random() < 0.5) animatorRef.current?.setState('play')
    }, 30000)
    return () => clearInterval(id)
  }, [isWeekend])

  // ── Animation + walk loop ─────────────────────────────────
  useEffect(() => {
    const canvas  = petCanvasRef.current!
    const wrapper = petWrapperRef.current!
    const room    = roomRef.current!

    let mounted = true
    walkXRef.current   = 80
    walkDirRef.current = 1

    const coords: PetCoords = (petData.coords?.has_eyes) ? petData.coords : DEFAULT_COORDS
    const eyeStyle = localStorage.getItem('oodle_eye_style') || 'eye_round'

    const animator = new PetAnimator(canvas, { imageDataURL: petData.pixelData, coords, size: PET_SIZE, eyeStyle })
    animatorRef.current = animator
    animator.setState('walk')
    animator.start()

    const walk = () => {
      if (!mounted) return
      if (statsRef.current.energy >= 25) {
        const maxX = room.offsetWidth - PET_SIZE
        walkXRef.current += 0.3 * walkDirRef.current
        if (walkXRef.current >= maxX) walkDirRef.current = -1
        if (walkXRef.current <= 0)    walkDirRef.current =  1
        wrapper.style.left     = `${walkXRef.current}px`
        canvas.style.transform = walkDirRef.current === -1 ? 'scaleX(-1)' : 'none'
      }
      walkRafRef.current = requestAnimationFrame(walk)
    }
    walkRafRef.current = requestAnimationFrame(walk)

    return () => {
      mounted = false
      animator.stop()
      cancelAnimationFrame(walkRafRef.current)
    }
  }, [petData])

  // ── Door transition ───────────────────────────────────────
  useEffect(() => {
    if (doorPhase === 'appearing') {
      const t = setTimeout(() => setDoorPhase('opening'), 50)
      return () => clearTimeout(t)
    }

    if (doorPhase === 'opening') {
      const t = setTimeout(() => setDoorPhase('walking'), 700)
      return () => clearTimeout(t)
    }

    if (doorPhase === 'walking') {
      const wrapper = petWrapperRef.current
      const canvas  = petCanvasRef.current
      const room    = roomRef.current
      if (!wrapper || !canvas || !room) return

      cancelAnimationFrame(walkRafRef.current)
      animatorRef.current?.setState('walk')

      const targetX = room.offsetWidth * 0.85 - PET_SIZE / 2
      canvas.style.transform = 'none'

      let rafId = 0
      const walkToDoor = () => {
        const current = parseFloat(wrapper.style.left) || walkXRef.current
        const dx      = targetX - current
        if (Math.abs(dx) < 3) {
          wrapper.style.transition = 'opacity 0.4s'
          wrapper.style.opacity    = '0'
          setTimeout(() => setDoorPhase('done'), 450)
          return
        }
        wrapper.style.left = `${current + Math.sign(dx) * Math.min(Math.abs(dx), 3)}px`
        rafId = requestAnimationFrame(walkToDoor)
      }
      rafId = requestAnimationFrame(walkToDoor)
      return () => cancelAnimationFrame(rafId)
    }

    if (doorPhase === 'done') onGoToPlaza()
  }, [doorPhase, onGoToPlaza])

  // ── Helpers ───────────────────────────────────────────────
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

  // ── Like → food redemption ────────────────────────────────
  const handleRedeemSmall = useCallback(async () => {
    if (likeBalance < 5) return
    const ok = await redeemLikesForFood(5)
    if (ok) {
      setSmallFood(f => f + 1)
      setLikeBalance(b => b - 5)
      showFloat('🍎')
      showBubble('Got a snack!')
    }
  }, [likeBalance, showFloat, showBubble])

  const handleRedeemBig = useCallback(async () => {
    if (likeBalance < 20) return
    const ok = await redeemLikesForFood(20)
    if (ok) {
      setBigFood(f => f + 1)
      setLikeBalance(b => b - 20)
      showFloat('🍱')
      showBubble('Got a meal!')
    }
  }, [likeBalance, showFloat, showBubble])

  // ── Feed ──────────────────────────────────────────────────
  const handleFeed = useCallback((size: 'small' | 'big') => {
    if (todayEats >= DAILY_EAT_LIMIT) { showBubble('Too full! Come back tomorrow'); return }
    if (size === 'small') {
      if (smallFood <= 0) { showBubble('Redeem likes for snacks! ❤️'); return }
      setSmallFood(f => f - 1)
      setStats(s => ({ ...s, hunger: Math.min(100, s.hunger + SMALL_HUNGER) }))
    } else {
      if (bigFood <= 0) { showBubble('Redeem likes for meals! ❤️'); return }
      setBigFood(f => f - 1)
      setStats(s => ({ ...s, hunger: Math.min(100, s.hunger + BIG_HUNGER) }))
    }
    setTodayEats(n => n + 1)
    showFloat('🍖')
    showBubble(pick(FEED_LINES))
    animatorRef.current?.setState('eat')
    setTimeout(() => animatorRef.current?.setState('walk'), 2000)
  }, [todayEats, smallFood, bigFood, showFloat, showBubble])

  // ── Pinch / drag / throw ─────────────────────────────────
  const isDizzyRef = useRef(false)

  const startBounce = useCallback((vx: number, vy: number, triggerDizzy: boolean) => {
    const wrapper = petWrapperRef.current
    const room    = roomRef.current
    if (!wrapper || !room) return

    cancelAnimationFrame(walkRafRef.current)
    cancelAnimationFrame(throwRafRef.current)

    let pvx = vx, pvy = vy
    const GRAVITY  = 0.5
    const BOUNCE   = 0.55
    const FRICTION = 0.92
    const roomW    = room.offsetWidth
    const roomH    = room.offsetHeight
    const PET_W    = 160

    const tick = () => {
      pvy += GRAVITY
      let nx = parseFloat(wrapper.style.left || '80') + pvx
      let ny = parseFloat(wrapper.style.top  || String(roomH * 0.5)) + pvy

      const floor = roomH * 0.70
      if (ny + PET_W > floor) {
        ny  = floor - PET_W
        pvy = -Math.abs(pvy) * BOUNCE
        pvx *= FRICTION
        animatorRef.current?.setState('squish')
        if (Math.abs(pvy) < 1) pvy = 0
      }
      if (nx < 0)             { nx = 0;           pvx =  Math.abs(pvx) * BOUNCE }
      if (nx + PET_W > roomW) { nx = roomW-PET_W; pvx = -Math.abs(pvx) * BOUNCE }
      if (ny < 0)             { ny = 0;            pvy =  Math.abs(pvy) * BOUNCE }

      wrapper.style.left = `${nx}px`
      wrapper.style.top  = `${ny}px`

      if (Math.abs(pvx) > 0.2 || Math.abs(pvy) > 0.2) {
        throwRafRef.current = requestAnimationFrame(tick)
      } else {
        // Bounce fully settled
        walkXRef.current  = nx
        wrapper.style.top = ''

        if (triggerDizzy) {
          // Trigger dizzy NOW after bounce settles
          isDizzyRef.current = true
          setIsDizzy(true)
          animatorRef.current?.setState('dizzy')
          setTimeout(() => {
            isDizzyRef.current    = false
            throwCountRef.current = 0
            setIsDizzy(false)
            animatorRef.current?.setState('walk')
            // Resume walk loop
            const canvas = petCanvasRef.current
            if (canvas) {
              walkDirRef.current = 1
              const walk = () => {
                const maxX = room.offsetWidth - PET_W
                walkXRef.current += 0.3 * walkDirRef.current
                if (walkXRef.current >= maxX) walkDirRef.current = -1
                if (walkXRef.current <= 0)    walkDirRef.current =  1
                wrapper.style.left     = `${walkXRef.current}px`
                canvas.style.transform = walkDirRef.current === -1 ? 'scaleX(-1)' : 'none'
                walkRafRef.current = requestAnimationFrame(walk)
              }
              walkRafRef.current = requestAnimationFrame(walk)
            }
          }, 15000)
        } else {
          // Resume normal walk
          animatorRef.current?.setState('walk')
          const canvas = petCanvasRef.current
          if (canvas) {
            walkDirRef.current = 1
            const walk = () => {
              const maxX = room.offsetWidth - PET_W
              walkXRef.current += 0.3 * walkDirRef.current
              if (walkXRef.current >= maxX) walkDirRef.current = -1
              if (walkXRef.current <= 0)    walkDirRef.current =  1
              wrapper.style.left     = `${walkXRef.current}px`
              canvas.style.transform = walkDirRef.current === -1 ? 'scaleX(-1)' : 'none'
              walkRafRef.current = requestAnimationFrame(walk)
            }
            walkRafRef.current = requestAnimationFrame(walk)
          }
        }
      }
    }
    throwRafRef.current = requestAnimationFrame(tick)
  }, [])

  const handlePetMouseDown = useCallback((e: React.MouseEvent) => {
    if (isDizzyRef.current) return
    const wrapper = petWrapperRef.current
    if (!wrapper) return

    isLongPressRef.current = false

    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true
      isDraggingRef.current  = true
      cancelAnimationFrame(walkRafRef.current)
      cancelAnimationFrame(throwRafRef.current)
      animatorRef.current?.setState('squish')
      const rect = wrapper.getBoundingClientRect()
      dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      lastPosRef.current    = { x: e.clientX, y: e.clientY }
      velRef.current        = { x: 0, y: 0 }
    }, 300)
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return
    const wrapper = petWrapperRef.current
    const room    = roomRef.current
    if (!wrapper || !room) return
    const rect = room.getBoundingClientRect()
    const nx   = e.clientX - rect.left - dragOffsetRef.current.x
    const ny   = e.clientY - rect.top  - dragOffsetRef.current.y
    velRef.current     = { x: e.clientX - lastPosRef.current.x, y: e.clientY - lastPosRef.current.y }
    lastPosRef.current = { x: e.clientX, y: e.clientY }
    wrapper.style.left = `${nx}px`
    wrapper.style.top  = `${ny}px`
  }, [])

  const handleMouseUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    if (!isDraggingRef.current) {
      // Quick click = pinch
      if (!isDizzyRef.current) {
        animatorRef.current?.setState('squish')
        setStats(s => ({ ...s, happy: Math.min(100, s.happy + 10) }))
        showFloat('⭐')
        setTimeout(() => animatorRef.current?.setState('walk'), 600)
      }
      return
    }
    isDraggingRef.current = false
    const vx = velRef.current.x * 0.8
    const vy = velRef.current.y * 0.8

    throwCountRef.current += 1
    // Trigger dizzy after bounce settles if this is the 2nd+ throw
    const triggerDizzy = throwCountRef.current >= 2 && !isDizzyRef.current
    startBounce(vx, vy, triggerDizzy)
  }, [startBounce, showFloat])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup',   handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup',   handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  const handleGoToPlaza = useCallback(() => {
    if (doorPhase !== 'idle') return
    setDoorPhase('appearing')
  }, [doorPhase])

  const isTransitioning = doorPhase !== 'idle'
  const plazaReady      = petSaved && !isTransitioning

  return (
    <div className={styles.page}>
      <div className={styles.room} ref={roomRef}>

        {/* Night overlay */}
        {isNight && <div className={styles.nightOverlay} />}

        {/* Top-left: HUD */}
        <div className={styles.topLeft}>
          <div className={styles.hud}>
            <StatBar label="🍖" value={stats.hunger} color="var(--color-hunger)" maxWidth={80} />
            <StatBar label="💛" value={stats.happy}  color="var(--color-happy)"  maxWidth={80} />
            <StatBar label="⚡" value={stats.energy} color="var(--color-energy)" maxWidth={80} />
          </div>
        </div>

        <div className={styles.dayCounter}>DAY {dayCount}</div>
        <div className={styles.petNameDisplay}>{petData.name}</div>

        {/* Door transition overlay */}
        {isTransitioning && (
          <div className={styles.doorContainer}>
            <div className={`${styles.doorFrame} ${styles.doorFrameVisible}`}>
              <div className={`${styles.doorLeft}  ${doorPhase !== 'appearing' ? styles.doorLeftOpen  : ''}`} />
              <div className={`${styles.doorRight} ${doorPhase !== 'appearing' ? styles.doorRightOpen : ''}`} />
              <div className={styles.doorTop}>TO PLAZA →</div>
            </div>
          </div>
        )}

        {/* Like-balance panel (replaces energy panel) */}
        <div className={styles.likePanel}>
          <div className={styles.energyRow}>
            <span className={styles.energyLabel}>❤️ LIKES</span>
            <span className={styles.energyValue}>{likeBalance}</span>
          </div>
          <button
            className={styles.convertBtn}
            onClick={handleRedeemSmall}
            disabled={likeBalance < 5}
          >
            🍎 SNACK
            <span className={styles.costTag}>5 ❤️</span>
            <span className={styles.foodCount}>{smallFood}</span>
          </button>
          <button
            className={styles.convertBtn}
            onClick={handleRedeemBig}
            disabled={likeBalance < 20}
          >
            🍱 MEAL
            <span className={styles.costTag}>20 ❤️</span>
            <span className={styles.foodCount}>{bigFood}</span>
          </button>
        </div>

        {/* Pet */}
        <div
          className={styles.petWrapper}
          ref={petWrapperRef}
          onMouseDown={handlePetMouseDown}
          style={{ cursor: isDizzy ? 'not-allowed' : 'grab', userSelect: 'none' }}
        >
          <canvas
            ref={petCanvasRef}
            width={PET_SIZE}
            height={PET_SIZE}
            style={{ display: 'block', background: 'transparent', border: 'none' }}
          />
          {bubble && <div className={styles.bubble} key={bubble.id}>{bubble.text}</div>}
          {floatEmojis.map(e => (
            <span key={e.id} className={styles.floatEmoji}>{e.char}</span>
          ))}
        </div>
      </div>

      <div className={styles.actionBar}>
        <div className={styles.feedRow}>
          <button
            className={styles.actionBtn}
            onClick={() => handleFeed('small')}
            disabled={smallFood <= 0 || todayEats >= DAILY_EAT_LIMIT}
          >
            🍎 FEED SNACK
          </button>
          <button
            className={styles.actionBtn}
            onClick={() => handleFeed('big')}
            disabled={bigFood <= 0 || todayEats >= DAILY_EAT_LIMIT}
          >
            🍱 FEED MEAL
          </button>
          <button
            className={`${styles.actionBtn} ${styles.plazaBtn}`}
            onClick={handleGoToPlaza}
            disabled={!plazaReady}
          >
            {!petSaved ? 'SAVING...' : isTransitioning ? 'GOING...' : 'GO TO PLAZA →'}
          </button>
        </div>
      </div>
    </div>
  )
}
