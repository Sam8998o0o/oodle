import { useRef, useState, useEffect, useCallback } from 'react'
import StatBar from '../ui/StatBar'
import { PetAnimator } from '../engine/PetAnimator'
import type { PetCoords } from '../api/aiRecognize'
import { savePet } from '../lib/petService'
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

const FEED_LINES = ['Yummy!', 'Thank you!', 'So good!']
const PLAY_LINES = ['Wheee!', 'So fun!', 'Yay!']

const PET_SIZE = 160

const KEYS_PER_ENERGY  = 100
const ENERGY_FOR_SMALL = 5
const ENERGY_FOR_BIG   = 30
const SMALL_MAX        = 10
const BIG_MAX          = 5
const SMALL_HUNGER     = 10
const BIG_HUNGER       = 20
const DAILY_EAT_LIMIT  = 5
const IDLE_HOURS       = 8
const IDLE_DECAY       = 10

// Door transition phases
type DoorPhase = 'idle' | 'opening' | 'walking' | 'done'

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

  const [stats, setStats]             = useState<PetStats>({ hunger: 80, happy: 80, energy: 80 })
  const [dayCount, setDayCount]       = useState(1)
  const [floatEmojis, setFloatEmojis] = useState<FloatEmoji[]>([])
  const [bubble, setBubble]           = useState<{ text: string; id: number } | null>(null)

  const [keyEnergy,  setKeyEnergy]  = useState(0)
  const [keyBuffer,  setKeyBuffer]  = useState(0)
  const [smallFood,  setSmallFood]  = useState(0)
  const [bigFood,    setBigFood]    = useState(0)
  const [todayEats,  setTodayEats]  = useState(0)
  const [shelfSmall, setShelfSmall] = useState(0)
  const [shelfBig,   setShelfBig]   = useState(0)

  // Door transition state
  const [doorPhase, setDoorPhase] = useState<DoorPhase>('idle')

  // Track whether savePet has finished so Plaza can safely filter own pet
  const [petSaved, setPetSaved] = useState(false)

  // ── Day / Night + Weekend ─────────────────────────────────
  const [isNight, setIsNight]     = useState(() => { const h = new Date().getHours(); return h >= 22 || h < 6 })
  const [isWeekend, setIsWeekend] = useState(() => { const d = new Date().getDay(); return d === 0 || d === 6 })

  useEffect(() => { statsRef.current = stats }, [stats])

  useEffect(() => {
    // Await savePet so oodle_pet_supabase_id is in localStorage
    // before the user enters Plaza — otherwise fetchAllPets cannot filter own pet
    savePet({
      name:      petData.name,
      pixelData: petData.pixelData,
      coords:    petData.coords,
    })
      .then(() => setPetSaved(true))
      .catch(() => setPetSaved(true)) // offline: still allow Plaza entry
  }, [petData])

  // ── Load localStorage ─────────────────────────────────────
  useEffect(() => {
    try {
      const s = localStorage.getItem('oodle_stats')
      if (s) { const p = JSON.parse(s) as PetStats; setStats(p); statsRef.current = p }
      const d = localStorage.getItem('oodle_day_count')
      if (d) setDayCount(parseInt(d, 10))
      const ks = localStorage.getItem('oodle_key_state')
      if (ks) {
        const kp = JSON.parse(ks)
        setKeyEnergy(kp.keyEnergy   ?? 0)
        setKeyBuffer(kp.keyBuffer   ?? 0)
        setSmallFood(kp.smallFood   ?? 0)
        setBigFood(kp.bigFood       ?? 0)
        setShelfSmall(kp.shelfSmall ?? 0)
        setShelfBig(kp.shelfBig     ?? 0)
        const savedDate = kp.eatDate ?? ''
        const today     = new Date().toDateString()
        setTodayEats(savedDate === today ? (kp.todayEats ?? 0) : 0)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { localStorage.setItem('oodle_stats', JSON.stringify(stats)) }, [stats])
  useEffect(() => { localStorage.setItem('oodle_day_count', String(dayCount)) }, [dayCount])
  useEffect(() => {
    localStorage.setItem('oodle_key_state', JSON.stringify({
      keyEnergy, keyBuffer, smallFood, bigFood,
      shelfSmall, shelfBig, todayEats,
      eatDate: new Date().toDateString(),
    }))
  }, [keyEnergy, keyBuffer, smallFood, bigFood, shelfSmall, shelfBig, todayEats])

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

  // ── Time check (every minute) ────────────────────────────
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const h   = now.getHours()
      const d   = now.getDay()
      setIsNight(h >= 22 || h < 6)
      setIsWeekend(d === 0 || d === 6)
    }
    const id = setInterval(tick, 60000)
    return () => clearInterval(id)
  }, [])

  // ── Night → force sleep; day → let energy system resume ──
  useEffect(() => {
    if (isNight) {
      animatorRef.current?.setState('sleep')
    }
  }, [isNight])

  // ── Weekend celebration: random play every 30 s ───────────
  useEffect(() => {
    if (!isWeekend) return
    const id = setInterval(() => {
      if (Math.random() < 0.5) {
        animatorRef.current?.setState('play')
      }
    }, 30000)
    return () => clearInterval(id)
  }, [isWeekend])

  // ── Keyboard listener ─────────────────────────────────────
  useEffect(() => {
    const onKey = () => {
      localStorage.setItem('oodle_last_keystroke', new Date().toISOString())
      setKeyBuffer(prev => {
        const next = prev + 1
        if (next >= KEYS_PER_ENERGY) { setKeyEnergy(e => e + 1); return 0 }
        return next
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Idle decay ────────────────────────────────────────────
  useEffect(() => {
    const check = setInterval(() => {
      const last = localStorage.getItem('oodle_last_keystroke')
      if (!last) return
      const hoursIdle = (Date.now() - new Date(last).getTime()) / 3600000
      if (hoursIdle >= IDLE_HOURS) {
        setStats(s => ({ ...s, hunger: Math.max(0, s.hunger - IDLE_DECAY) }))
      }
    }, 3600000)
    return () => clearInterval(check)
  }, [])

  // ── Animation loop ────────────────────────────────────────
  useEffect(() => {
    const canvas  = petCanvasRef.current!
    const wrapper = petWrapperRef.current!
    const room    = roomRef.current!

    let mounted = true
    walkXRef.current   = 80
    walkDirRef.current = 1

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

    const walk = () => {
      if (!mounted) return
      const isSleeping = statsRef.current.energy < 25
      if (!isSleeping) {
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

  // ── Door transition logic ─────────────────────────────────
  // Phase sequence:
  //   idle → (click GO TO PLAZA) → opening (door swings open, 600ms)
  //          → walking (pet walks to door, ~1200ms)
  //          → done (trigger scene change)
  useEffect(() => {
    if (doorPhase === 'opening') {
      // After door opens, start pet walking toward door
      const t = setTimeout(() => setDoorPhase('walking'), 700)
      return () => clearTimeout(t)
    }

    if (doorPhase === 'walking') {
      const wrapper = petWrapperRef.current
      const canvas  = petCanvasRef.current
      const room    = roomRef.current
      if (!wrapper || !canvas || !room) return

      // Cancel normal walk loop
      cancelAnimationFrame(walkRafRef.current)
      animatorRef.current?.setState('walk')

      // Door is on the right side of the room at ~85% width
      const doorX   = room.offsetWidth * 0.85 - PET_SIZE / 2
      const targetX = doorX
      canvas.style.transform = 'none' // face right toward door

      let rafId = 0
      const walkToDoor = () => {
        const current = parseFloat(wrapper.style.left) || walkXRef.current
        const dx = targetX - current
        if (Math.abs(dx) < 3) {
          // Reached door — fade out then switch scene
          wrapper.style.transition = 'opacity 0.4s'
          wrapper.style.opacity    = '0'
          setTimeout(() => setDoorPhase('done'), 450)
          return
        }
        const step = Math.sign(dx) * Math.min(Math.abs(dx), 3)
        wrapper.style.left = `${current + step}px`
        rafId = requestAnimationFrame(walkToDoor)
      }
      rafId = requestAnimationFrame(walkToDoor)
      return () => cancelAnimationFrame(rafId)
    }

    if (doorPhase === 'done') {
      onGoToPlaza()
    }
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

  const convertSmall = useCallback(() => {
    if (keyEnergy < ENERGY_FOR_SMALL) { showBubble(`Need ${ENERGY_FOR_SMALL} energy pts!`); return }
    if (shelfSmall >= SMALL_MAX)      { showBubble('Shelf is full!'); return }
    setKeyEnergy(e => e - ENERGY_FOR_SMALL)
    setShelfSmall(f => f + 1)
    setSmallFood(f => f + 1)
    showFloat('🍎')
  }, [keyEnergy, shelfSmall, showFloat, showBubble])

  const convertBig = useCallback(() => {
    if (keyEnergy < ENERGY_FOR_BIG) { showBubble(`Need ${ENERGY_FOR_BIG} energy pts!`); return }
    if (shelfBig >= BIG_MAX)        { showBubble('Shelf is full!'); return }
    setKeyEnergy(e => e - ENERGY_FOR_BIG)
    setShelfBig(f => f + 1)
    setBigFood(f => f + 1)
    showFloat('🍱')
  }, [keyEnergy, shelfBig, showFloat, showBubble])

  const handleFeed = useCallback((size: 'small' | 'big') => {
    if (todayEats >= DAILY_EAT_LIMIT) { showBubble('Too full! Come back tomorrow 😅'); return }
    if (size === 'small') {
      if (smallFood <= 0) { showBubble('No snacks! Type to earn 🍎'); return }
      setSmallFood(f => f - 1)
      setShelfSmall(f => Math.max(0, f - 1))
      setStats(s => ({ ...s, hunger: Math.min(100, s.hunger + SMALL_HUNGER) }))
    } else {
      if (bigFood <= 0) { showBubble('No meals! Type to earn 🍱'); return }
      setBigFood(f => f - 1)
      setShelfBig(f => Math.max(0, f - 1))
      setStats(s => ({ ...s, hunger: Math.min(100, s.hunger + BIG_HUNGER) }))
    }
    setTodayEats(n => n + 1)
    showFloat('🍖')
    showBubble(pick(FEED_LINES))
    animatorRef.current?.setState('eat')
    setTimeout(() => animatorRef.current?.setState('walk'), 2000)
  }, [todayEats, smallFood, bigFood, showFloat, showBubble])

  const handlePlay = useCallback(() => {
    setStats(s => ({ ...s, happy: Math.min(100, s.happy + 15) }))
    showFloat('⭐')
    showBubble(pick(PLAY_LINES))
    animatorRef.current?.setState('play')
    setTimeout(() => animatorRef.current?.setState('walk'), 2000)
  }, [showFloat, showBubble])

  // ── Trigger door transition ───────────────────────────────
  const handleGoToPlaza = useCallback(() => {
    if (doorPhase !== 'idle') return
    setDoorPhase('opening')
  }, [doorPhase])

  const isTransitioning = doorPhase !== 'idle'
  const plazaReady      = petSaved && !isTransitioning

  return (
    <div className={styles.page}>
      <div className={styles.room} ref={roomRef}>

        {/* Night overlay */}
        {isNight && <div className={styles.nightOverlay} />}

        <div className={styles.topLeft}>
          <div className={styles.hud}>
            <StatBar label="🍖" value={stats.hunger} color="var(--color-hunger)" maxWidth={80} />
            <StatBar label="💛" value={stats.happy}  color="var(--color-happy)"  maxWidth={80} />
            <StatBar label="⚡" value={stats.energy} color="var(--color-energy)" maxWidth={80} />
          </div>
          {(shelfSmall > 0 || shelfBig > 0) && (
            <div className={styles.foodShelf}>
              <div className={styles.foodShelfLabel}>FOOD</div>
              <div className={styles.foodShelfItems}>
                {Array.from({ length: shelfSmall }).map((_, i) => (
                  <span key={`s${i}`} className={styles.foodItem}>🍎</span>
                ))}
                {Array.from({ length: shelfBig }).map((_, i) => (
                  <span key={`b${i}`} className={styles.foodItem}>🍱</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={styles.dayCounter}>DAY {dayCount}</div>
        <div className={styles.petNameDisplay}>{petData.name}</div>

        {/* Door overlay — appears during transition */}
        {isTransitioning && (
          <div className={styles.doorContainer}>
            <div className={`${styles.doorFrame} ${doorPhase === 'opening' || doorPhase === 'walking' || doorPhase === 'done' ? styles.doorFrameVisible : ''}`}>
              <div className={`${styles.doorLeft}  ${doorPhase === 'opening' || doorPhase === 'walking' ? styles.doorLeftOpen  : ''}`} />
              <div className={`${styles.doorRight} ${doorPhase === 'opening' || doorPhase === 'walking' ? styles.doorRightOpen : ''}`} />
              <div className={styles.doorTop}>TO PLAZA →</div>
            </div>
          </div>
        )}

        {/* Energy panel */}
        <div className={styles.energyPanel}>
          <div className={styles.energyRow}>
            <span className={styles.energyLabel}>⚡ ENERGY</span>
            <span className={styles.energyValue}>{keyEnergy} PTS</span>
          </div>
          <div className={styles.keyProgress}>
            <div
              className={styles.keyProgressBar}
              style={{ width: `${(keyBuffer / KEYS_PER_ENERGY) * 100}%` }}
            />
          </div>
          <div className={styles.keyProgressLabel}>{keyBuffer} / {KEYS_PER_ENERGY} KEYSTROKES</div>
          <button
            className={styles.convertBtn}
            onClick={convertSmall}
            disabled={keyEnergy < ENERGY_FOR_SMALL || shelfSmall >= SMALL_MAX}
          >
            🍎 SNACK
            <span className={styles.costTag}>{ENERGY_FOR_SMALL} PTS</span>
            <span className={styles.foodCount}>{shelfSmall}/{SMALL_MAX}</span>
          </button>
          <button
            className={styles.convertBtn}
            onClick={convertBig}
            disabled={keyEnergy < ENERGY_FOR_BIG || shelfBig >= BIG_MAX}
          >
            🍱 MEAL
            <span className={styles.costTag}>{ENERGY_FOR_BIG} PTS</span>
            <span className={styles.foodCount}>{shelfBig}/{BIG_MAX}</span>
          </button>
        </div>

        <div className={styles.petWrapper} ref={petWrapperRef}>
          <canvas
            ref={petCanvasRef}
            width={PET_SIZE}
            height={PET_SIZE}
            style={{ display: 'block', background: 'transparent', border: 'none' }}
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
        <div className={styles.feedRow}>
          {smallFood > 0 && (
            <button
              className={styles.actionBtn}
              onClick={() => handleFeed('small')}
              disabled={todayEats >= DAILY_EAT_LIMIT}
            >
              🍎 FEED SNACK
            </button>
          )}
          {bigFood > 0 && (
            <button
              className={styles.actionBtn}
              onClick={() => handleFeed('big')}
              disabled={todayEats >= DAILY_EAT_LIMIT}
            >
              🍱 FEED MEAL
            </button>
          )}
          <button className={styles.actionBtn} onClick={handlePlay}>⭐ PLAY</button>
          <button
            className={`${styles.actionBtn} ${styles.plazaBtn}`}
            onClick={handleGoToPlaza}
            disabled={!plazaReady}
          >
            {!petSaved ? "SAVING..." : isTransitioning ? "GOING..." : "GO TO PLAZA →"}
          </button>
        </div>
      </div>
    </div>
  )
}
