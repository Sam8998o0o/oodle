import { useRef, useState, useEffect, useCallback } from 'react'
import StatBar from '../ui/StatBar'
import { PetAnimator } from '../engine/PetAnimator'
import type { PetCoords } from '../api/aiRecognize'
import { savePet, getLikeBalance, redeemLikesForFood } from '../lib/petService'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../lib/auth'
import styles from './RoomScene.module.css'

interface PetStats {
  hunger: number
  happy:  number
  energy: number
}

interface RoomSceneProps {
  petData:      { pixelData: string; coords: PetCoords; name: string }
  onGoToPlaza:  () => void
  onSizeChange: (size: number) => void
}

interface FloatEmoji {
  id:   number
  char: string
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

const FEED_LINES = ['Yummy!', 'Thank you!', 'So good!']

const PET_SIZE_MIN    = 60
const PET_SIZE_MAX    = 160
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

export default function RoomScene({ petData, onGoToPlaza, onSizeChange }: RoomSceneProps) {
  const { isAnonymous } = useAuthStore()
  const roomRef       = useRef<HTMLDivElement>(null)
  const petWrapperRef = useRef<HTMLDivElement>(null)
  const petCanvasRef  = useRef<HTMLCanvasElement>(null)
  const animatorRef   = useRef<PetAnimator | null>(null)
  const statsRef      = useRef<PetStats>({ hunger: 80, happy: 80, energy: 80 })
  const walkRafRef    = useRef(0)
  const walkXRef      = useRef(80)
  const walkDirRef    = useRef(1)
  const walkYRef      = useRef(0)
  const walkDYRef     = useRef(0)

  // ── Drag / throw / dizzy refs ─────────────────────────────
  const isDraggingRef    = useRef(false)
  const dragOffsetRef    = useRef({ x: 0, y: 0 })
  const lastPosRef       = useRef({ x: 0, y: 0 })
  const velRef           = useRef({ x: 0, y: 0 })
  const throwRafRef      = useRef(0)
  const throwCountRef    = useRef(0)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLongPressRef   = useRef(false)
  const isPetClickRef    = useRef(false)

  const [stats, setStats] = useState<PetStats>(() => {
    try {
      const s        = localStorage.getItem('oodle_stats')
      const lastSeen = localStorage.getItem('oodle_last_seen')
      // Update last_seen NOW before anything else runs
      localStorage.setItem('oodle_last_seen', String(Date.now()))
      if (!s) return { hunger: 80, happy: 80, energy: 80 }
      let p = JSON.parse(s) as PetStats
      if (lastSeen) {
        const offlineMs   = Date.now() - parseInt(lastSeen, 10)
        const offlineMins = offlineMs / 1000 / 60
        if (offlineMins > 1) {
          const isWeekendNow = [0, 6].includes(new Date().getDay())
          const decayMult    = isWeekendNow ? 0.5 : 1
          // Simulate sleep cycles offline:
          // Every 30s interval: if energy < 25 → sleep (energy recovers, hunger/happy still decay slowly)
          // This prevents energy from hitting 0 after long offline periods
          let { hunger, happy, energy } = p
          const totalIntervals = Math.floor(offlineMins * 2 * decayMult)
          let sleeping = energy <= 0
          for (let i = 0; i < totalIntervals; i++) {
            if (sleeping) {
              // Sleeping: energy recovers fast, hunger/happy decay at half rate
              energy = Math.min(100, energy + 2)
              hunger = Math.max(0, hunger - 0.04)
              happy  = Math.max(0, happy  - 0.03)
              if (energy >= 100) sleeping = false
            } else {
              // Awake: normal decay
              energy = Math.max(0, energy - 0.11)
              hunger = Math.max(0, hunger - 0.08)
              happy  = Math.max(0, happy  - 0.06)
              if (energy <= 0) sleeping = true
            }
          }
          p = { hunger, happy, energy }
        }
      }
      return p
    } catch { return { hunger: 80, happy: 80, energy: 80 } }
  })
  const [dayCount, setDayCount]       = useState(1)
  const [floatEmojis, setFloatEmojis] = useState<FloatEmoji[]>([])
  const [bubble, setBubble]           = useState<{ text: string; id: number } | null>(null)
  const isSleepingRef = useRef(false)

  // ── Like-exchange food system ────────────────────────────
  const [likeBalance, setLikeBalance] = useState(0)
  const [smallFood, setSmallFood] = useState(() => {
    try {
      const fs = localStorage.getItem('oodle_food_state')
      if (fs) return JSON.parse(fs).smallFood ?? 0
      return 1   // new user starter snack
    } catch { return 1 }
  })
  const [bigFood, setBigFood] = useState(() => {
    try {
      const fs = localStorage.getItem('oodle_food_state')
      if (fs) return JSON.parse(fs).bigFood ?? 0
      return 1   // new user starter meal
    } catch { return 1 }
  })
  const [todayEats,   setTodayEats]   = useState(0)

  // ── Door transition ───────────────────────────────────────
  const [doorPhase, setDoorPhase] = useState<DoorPhase>('idle')
  const [petSaved,  setPetSaved]  = useState(false)
  const [isDizzy,    setIsDizzy]    = useState(false)
  const [isFainted,  setIsFainted]  = useState(false)
  const [isSleeping, setIsSleeping] = useState(false)
  const [showMore,    setShowMore]    = useState(false)
  const [showRewards, setShowRewards] = useState(false)
  const [showShop,    setShowShop]    = useState(false)
  const isFaintedRef = useRef(false)
  const isDizzyRef   = useRef(false)

  // Close MORE popup on outside click
  useEffect(() => {
    if (!showMore) return
    const handler = () => setShowMore(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [showMore])

  // ── Growth system (day-based) ─────────────────────────────
  const [growthPoints, setGrowthPoints] = useState(() => {
    try { return Math.min(100, Math.max(0, parseInt(localStorage.getItem('oodle_growth') ?? '0', 10))) }
    catch { return 0 }
  })
  const petSize = Math.round(PET_SIZE_MIN + (growthPoints / 100) * (PET_SIZE_MAX - PET_SIZE_MIN))

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

  // ── Load like balance + poll every 10s + notify on new like ─
  useEffect(() => {
    let prevBalance = 0

    const fetchBalance = async () => {
      const b = await getLikeBalance().catch(() => 0)
      if (b > prevBalance && prevBalance > 0) {
        const gained = b - prevBalance
        setBubble({ text: `+${gained} ❤️ someone liked you!`, id: Date.now() })
      }
      prevBalance = b
      setLikeBalance(b)
    }

    fetchBalance()
    const timer = setInterval(fetchBalance, 10000)

    // Realtime: subscribe to like_balance changes for this user
    const userId = useAuthStore.getState().userId
    let channel: ReturnType<typeof supabase.channel> | null = null
    if (userId) {
      channel = supabase
        .channel('like-balance-' + userId)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'like_balance',
          filter: `user_id=eq.${userId}`,
        }, payload => {
          const newBal = (payload.new as { balance: number }).balance
          setLikeBalance(prev => {
            if (newBal > prev) {
              setBubble({ text: `+${newBal - prev} ❤️ someone liked you!`, id: Date.now() })
            }
            return newBal
          })
        })
        .subscribe()
    }

    return () => {
      clearInterval(timer)
      if (channel) supabase.removeChannel(channel)
    }
  }, [])

  // ── Load localStorage (food, day, growth only — stats handled above) ─
  useEffect(() => {
    try {
      const d = localStorage.getItem('oodle_day_count')
      if (d) setDayCount(parseInt(d, 10))

      const fs = localStorage.getItem('oodle_food_state')
      if (fs) {
        const fp = JSON.parse(fs) as { smallFood?: number; bigFood?: number; todayEats?: number; eatDate?: string }
        const today = new Date().toDateString()
        if (fp.eatDate && fp.eatDate !== today) {
          const fedYesterday = (fp.todayEats ?? 0) > 0
          setGrowthPoints((g: number) => Math.min(100, Math.max(0, g + (fedYesterday ? 10 : -5))))
        }
        setTodayEats(fp.eatDate === today ? (fp.todayEats ?? 0) : 0)
      }
    } catch { /* ignore */ }
  }, [])

  // ── Save last seen timestamp every 10s (no immediate call — already set in useState) ──
  useEffect(() => {
    const id = setInterval(() => {
      localStorage.setItem('oodle_last_seen', String(Date.now()))
    }, 10000)
    return () => {
      localStorage.setItem('oodle_last_seen', String(Date.now()))
      clearInterval(id)
    }
  }, [])

  useEffect(() => { localStorage.setItem('oodle_stats',      JSON.stringify(stats))    }, [stats])
  useEffect(() => { localStorage.setItem('oodle_day_count',  String(dayCount))          }, [dayCount])
  useEffect(() => { localStorage.setItem('oodle_growth',     String(growthPoints))      }, [growthPoints])
  useEffect(() => { onSizeChange(petSize) }, [petSize, onSizeChange])
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
      if (isSleepingRef.current) {
        // Sleeping: energy handled by sleep effect, hunger/happy decay at half rate
        setStats((s: PetStats) => ({
          hunger: Math.max(0, s.hunger - 0.04),
          happy:  Math.max(0, s.happy  - 0.03),
          energy: s.energy,
        }))
      } else {
        setStats((s: PetStats) => ({
          hunger: Math.max(0, s.hunger - 0.08),
          happy:  Math.max(0, s.happy  - 0.06),
          energy: Math.max(0, s.energy - 0.11),
        }))
      }
    }, interval)
    return () => clearInterval(decay)
  }, [isWeekend])

  // ── Auto sleep (energy-based) ─────────────────────────────
  useEffect(() => {
    const check = setInterval(() => {
      const s        = statsRef.current
      const animator = animatorRef.current
      if (!animator) return
      if (isFaintedRef.current) return
      if (isDizzyRef.current)   return

      if (!isSleepingRef.current && s.energy <= 0) {
        isSleepingRef.current = true
        setIsSleeping(true)
        animator.setState('sleep')
        setTimeout(() => {
          const r = roomRef.current
          const w = petWrapperRef.current
          if (r && w && r.offsetWidth > 0) {
            const cx = Math.round((r.offsetWidth - petSize) / 2)
            walkXRef.current = cx
            w.style.left = `${cx}px`
          }
        }, 200)
        setBubble({ text: 'Zzz... 💤', id: Date.now() })
      } else if (isSleepingRef.current && s.energy < 100) {
        if (s.hunger > 20 && s.happy > 20) {
          setBubble({ text: 'Zzz... 💤', id: Date.now() })
        }
        setStats((prev: PetStats) => ({ ...prev, energy: Math.min(100, prev.energy + 0.14) }))
      } else if (isSleepingRef.current && s.energy >= 100) {
        isSleepingRef.current = false
        setIsSleeping(false)
        setBubble(null)
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
    if (isNight) {
      isSleepingRef.current = true
      setIsSleeping(true)
      animatorRef.current?.setState('sleep')
    } else if (!isNight && isSleepingRef.current) {
      isSleepingRef.current = false
      setIsSleeping(false)
      animatorRef.current?.setState('walk')
    }
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
    walkYRef.current   = 0
    walkDYRef.current  = 0

    // Set initial left position
    wrapper.style.left = '80px'

    const coords: PetCoords = (petData.coords?.has_eyes) ? petData.coords : DEFAULT_COORDS
    const eyeStyle = localStorage.getItem('oodle_eye_style') || 'eye_round'

    animatorRef.current?.stop()
    canvas.width  = petSize
    canvas.height = petSize
    wrapper.style.width  = `${petSize}px`
    wrapper.style.height = `${petSize}px`

    const animator = new PetAnimator(canvas, { imageDataURL: petData.pixelData, coords, size: petSize, eyeStyle })
    animatorRef.current = animator
    animator.setState('walk')
    animator.start()

    const walk = () => {
      if (!mounted) return
      if (statsRef.current.energy > 0 && !isFaintedRef.current && !isDizzyRef.current && !isSleepingRef.current) {
        const maxX = room.offsetWidth - petSize
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
  }, [petData, petSize])

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

      const targetX = room.offsetWidth * 0.85 - petSize / 2
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
    setTimeout(() => setBubble((b: { text: string; id: number } | null) => (b?.id === id ? null : b)), 6000)
  }, [])

  // ── Warning bubbles when stats are low ───────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (isFaintedRef.current || isSleepingRef.current) return
      if (statsRef.current.hunger > 0 && statsRef.current.hunger <= 20) {
        showBubble('I\'m hungry... 🍖')
      } else if (statsRef.current.happy <= 20) {
        showBubble('I\'m unhappy... 😢')
      } else if (statsRef.current.energy <= 20 && !isSleepingRef.current) {
        showBubble('I\'m sleepy... 😴')
      }
    }, 5000)
    return () => clearInterval(id)
  }, [showBubble])
  useEffect(() => {
    if (stats.hunger <= 0 && !isFaintedRef.current) {
      isFaintedRef.current = true
      setIsFainted(true)
      cancelAnimationFrame(walkRafRef.current)
      // Move pet to center of room when fainting
      const room = roomRef.current
      const wrapper = petWrapperRef.current
      if (room && wrapper) {
        const centerX = Math.round((room.offsetWidth - petSize) / 2)
        walkXRef.current = centerX
        wrapper.style.left = `${centerX}px`
      }
      animatorRef.current?.setState('faint')
      showBubble('So hungry... 😵')
    }
  }, [stats.hunger, showBubble, petSize])

  // ── Keep faint state on animator (in case animator reinits) ──
  useEffect(() => {
    if (isFainted) {
      animatorRef.current?.setState('faint')
    }
  }, [isFainted])

  // ── Like → food redemption ────────────────────────────────
  const handleRedeemSmall = useCallback(async () => {
    if (likeBalance < 5) return
    const ok = await redeemLikesForFood(5)
    if (ok) {
      setSmallFood((f: number) => f + 1)
      setLikeBalance((b: number) => b - 5)
      showFloat('🍎')
      showBubble('Got a snack!')
    }
  }, [likeBalance, showFloat, showBubble])

  const handleRedeemBig = useCallback(async () => {
    if (likeBalance < 20) return
    const ok = await redeemLikesForFood(20)
    if (ok) {
      setBigFood((f: number) => f + 1)
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
      setSmallFood((f: number) => f - 1)
      setStats((s: PetStats) => ({ ...s, hunger: Math.min(100, s.hunger + SMALL_HUNGER) }))
    } else {
      if (bigFood <= 0) { showBubble('Redeem likes for meals! ❤️'); return }
      setBigFood((f: number) => f - 1)
      setStats((s: PetStats) => ({ ...s, hunger: Math.min(100, s.hunger + BIG_HUNGER) }))
    }
    setTodayEats((n: number) => n + 1)
    showFloat('🍖')
    showBubble(pick(FEED_LINES))
    animatorRef.current?.setState('eat')

    // Recover from faint
    if (isFaintedRef.current) {
      isFaintedRef.current = false
      setIsFainted(false)
    }
    setTimeout(() => animatorRef.current?.setState('walk'), 2000)
  }, [todayEats, smallFood, bigFood, showFloat, showBubble])

  // ── Pinch / drag / throw ─────────────────────────────────

  const startBounce = useCallback((vx: number, vy: number, triggerDizzy: boolean) => {
    const wrapper = petWrapperRef.current
    const room    = roomRef.current
    if (!wrapper || !room) return

    cancelAnimationFrame(walkRafRef.current)
    cancelAnimationFrame(throwRafRef.current)

    // Switch from bottom% to top px for physics
    const currentBottom = room.offsetHeight * 0.22
    wrapper.style.top    = `${room.offsetHeight - currentBottom - petSize}px`
    wrapper.style.bottom = 'auto'

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
        // Bounce fully settled — restore CSS bottom positioning
        walkXRef.current       = nx
        wrapper.style.top      = ''
        wrapper.style.bottom   = '22%'

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
    if (isDizzyRef.current || isFaintedRef.current) return

    // Wake up if sleeping and energy >= 30
    if (isSleepingRef.current) {
      if (statsRef.current.energy >= 30) {
        isSleepingRef.current = false
        setIsSleeping(false)
        setBubble(null)
        const wrapper = petWrapperRef.current
        if (wrapper) {
          wrapper.style.left      = `${walkXRef.current}px`
          wrapper.style.transform = ''
        }
        animatorRef.current?.setState('walk')
        showBubble('Good morning! 🌞')
      } else {
        showBubble('Still sleepy... 😴')
      }
      return
    }
    const wrapper = petWrapperRef.current
    if (!wrapper) return

    isPetClickRef.current  = true
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
      // Only scratch if click originated on the pet
      if (isPetClickRef.current && !isDizzyRef.current) {
        animatorRef.current?.setState('squish')
        setStats(s => ({ ...s, happy: Math.min(100, s.happy + 10) }))
        showFloat('⭐')
        setTimeout(() => animatorRef.current?.setState('walk'), 600)
      }
      isPetClickRef.current = false
      return
    }
    isPetClickRef.current = false
    isDraggingRef.current = false
    const vx = velRef.current.x * 0.8
    const vy = velRef.current.y * 0.8

    throwCountRef.current += 1
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
  const plazaReady = petSaved && !isTransitioning && !isDizzy && !isFainted && !isSleeping

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
          style={{ cursor: isFainted ? 'not-allowed' : isDizzy ? 'not-allowed' : 'grab', userSelect: 'none' }}
        >
          {isFainted && (
            <div style={{
              position: 'absolute',
              bottom: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              fontFamily: 'var(--font-pixel)',
              fontSize: '8px',
              background: '#fff',
              border: '2px solid #e94560',
              boxShadow: '2px 2px 0 #2C2C2C',
              padding: '3px 8px',
              whiteSpace: 'nowrap',
              color: '#e94560',
              zIndex: 10,
              marginBottom: '4px',
            }}>
              FEED ME! 😵
            </div>
          )}
          <canvas
            ref={petCanvasRef}
            width={petSize}
            height={petSize}
            style={{ display: 'block', background: 'transparent', border: 'none' }}
          />
          {bubble && <div className={styles.bubble} key={bubble.id}>{bubble.text}</div>}
          {floatEmojis.map(e => (
            <span key={e.id} className={styles.floatEmoji}>{e.char}</span>
          ))}
        </div>
      </div>

      <div className={styles.actionBar} style={{ position: 'relative', justifyContent: 'center' }}>
        {/* MORE popup */}
        {showMore && (
          <div
            className={styles.morePopup}
            onClick={e => e.stopPropagation()}
          >
            {/* Streak header */}
            <div className={styles.morePopupStreak}>
              🔥 STREAK: {isAnonymous ? '--' : `DAY ${dayCount}`}
            </div>
            <button
              className={styles.morePopupItem}
              onClick={() => { setShowMore(false); setShowRewards(true) }}
            >🎁 REWARDS</button>
            <button
              className={`${styles.morePopupItem} ${styles.morePopupItemLast}`}
              onClick={() => { setShowMore(false); setShowShop(true) }}
            >🛒 SHOP</button>
          </div>
        )}

        {/* MORE button — absolutely positioned far left */}
        <button
          className={`${styles.actionBtn} ${showMore ? styles.moreActive : ''}`}
          style={{ position: 'absolute', left: '16px' }}
          onClick={e => { e.stopPropagation(); setShowMore(v => !v) }}
        >
          ☰ MORE
        </button>

        {/* CENTRE: feed + plaza */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className={styles.actionBtn}
            onClick={() => handleFeed('small')}
            disabled={smallFood <= 0 || todayEats >= DAILY_EAT_LIMIT || isSleeping}
          >
            🍎 FEED SNACK
          </button>
          <button
            className={styles.actionBtn}
            onClick={() => handleFeed('big')}
            disabled={bigFood <= 0 || todayEats >= DAILY_EAT_LIMIT || isSleeping}
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

      {/* Rewards placeholder modal */}
      {showRewards && (
        <div
          onClick={() => setShowRewards(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#FDF6E3', border: '3px solid #2C2C2C', boxShadow: '6px 6px 0 #2C2C2C', padding: '40px 32px', textAlign: 'center', position: 'relative', minWidth: '260px' }}
          >
            <button
              onClick={() => setShowRewards(false)}
              style={{ position: 'absolute', top: '10px', right: '10px', fontFamily: 'var(--font-pixel)', fontSize: '10px', background: '#fff', border: '2px solid #2C2C2C', boxShadow: '2px 2px 0 #2C2C2C', width: '26px', height: '26px', cursor: 'pointer' }}
            >✕</button>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '11px', color: '#2C2C2C', marginBottom: '12px' }}>🎁 REWARDS</div>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '9px', color: '#888', lineHeight: 2 }}>🚧 COMING SOON</div>
          </div>
        </div>
      )}

      {/* Shop placeholder modal */}
      {showShop && (
        <div
          onClick={() => setShowShop(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#FDF6E3', border: '3px solid #2C2C2C', boxShadow: '6px 6px 0 #2C2C2C', padding: '40px 32px', textAlign: 'center', position: 'relative', minWidth: '260px' }}
          >
            <button
              onClick={() => setShowShop(false)}
              style={{ position: 'absolute', top: '10px', right: '10px', fontFamily: 'var(--font-pixel)', fontSize: '10px', background: '#fff', border: '2px solid #2C2C2C', boxShadow: '2px 2px 0 #2C2C2C', width: '26px', height: '26px', cursor: 'pointer' }}
            >✕</button>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '11px', color: '#2C2C2C', marginBottom: '12px' }}>🛒 SHOP</div>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '9px', color: '#888', lineHeight: 2 }}>🚧 COMING SOON</div>
          </div>
        </div>
      )}
    </div>
  )
}
