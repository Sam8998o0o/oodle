import { useRef, useState, useEffect, useCallback } from 'react'
import StatBar from '../ui/StatBar'
import { PetAnimator } from '../engine/PetAnimator'
import type { PetCoords } from '../api/aiRecognize'
import { savePet, getLikeBalance, redeemLikesForFood, saveTalent, saveTalentDrawing, getPetAge, killPet, checkPetDead } from '../lib/petService'
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
  isPremium?:   boolean
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
// DAILY_EAT_LIMIT removed — feeding is unlimited

type DoorPhase = 'idle' | 'appearing' | 'opening' | 'walking' | 'done'

const DEFAULT_COORDS: PetCoords = {
  eyes:     [{ x: 0.35, y: 0.28 }, { x: 0.65, y: 0.28 }],
  legs:     [],
  center:   { x: 0.5, y: 0.5 },
  has_eyes: false,
  has_legs: false,
}

// ── Shop / Rewards data ───────────────────────────────────
interface ShopItem { id: string; label: string; emoji: string; price: number; rare?: boolean }

interface DailyTasks {
  feed:           number   // 0-3 feeds today
  likes:          number   // plaza likes given today
  plaza:          boolean  // visited plaza today
  allDoneClaimed: boolean  // bonus already claimed today
  date:           string   // new Date().toDateString()
}

const REWARD_DAYS: Array<{ emoji: string; label: string; snacks: number; meals: number; rare: boolean; claimMsg: string }> = [
  { emoji: '🍪',      label: '1 Snack',      snacks: 1, meals: 0, rare: false, claimMsg: '+1 SNACK ADDED!'    },
  { emoji: '🍪🍪',    label: '2 Snacks',      snacks: 2, meals: 0, rare: false, claimMsg: '+2 SNACKS ADDED!'   },
  { emoji: '🍖',      label: '1 Meal',        snacks: 0, meals: 1, rare: false, claimMsg: '+1 MEAL ADDED!'     },
  { emoji: '🪴',      label: 'Plant Deco',    snacks: 0, meals: 0, rare: false, claimMsg: '🪴 COMING SOON!'    },
  { emoji: '🎩',      label: 'Hat Deco',      snacks: 0, meals: 0, rare: false, claimMsg: '🎩 COMING SOON!'    },
  { emoji: '🍖+🍪',   label: 'Meal+Snack',    snacks: 1, meals: 1, rare: false, claimMsg: '+1 MEAL +1 SNACK!' },
  { emoji: '👑+🍖🍖', label: 'Crown+2 Meals', snacks: 0, meals: 2, rare: true,  claimMsg: '👑 +2 MEALS ADDED!' },
]

const SHOP_HATS: ShopItem[]    = [
  { id: 'hat_top',    label: 'Top Hat',   emoji: '🎩', price: 20 },
  { id: 'hat_straw',  label: 'Straw Hat', emoji: '👒', price: 30 },
  { id: 'hat_grad',   label: 'Grad Cap',  emoji: '🎓', price: 40 },
  { id: 'hat_wizard', label: 'Wizard',    emoji: '🪄', price: 50 },
  { id: 'hat_crown',  label: 'Crown',     emoji: '👑', price: 100, rare: true },
]
const SHOP_GLASSES: ShopItem[] = [
  { id: 'glasses_star',  label: 'Star Eyes',  emoji: '⭐', price: 25 },
  { id: 'glasses_heart', label: 'Heart Eyes', emoji: '💕', price: 25 },
]
const SHOP_EYES: ShopItem[]    = [
  { id: 'eye_round',  label: 'Round',  emoji: '👁', price: 0  },
  { id: 'eye_happy',  label: 'Happy',  emoji: '😊', price: 0  },
  { id: 'eye_sleepy', label: 'Sleepy', emoji: '😴', price: 0  },
  { id: 'eye_star',   label: 'Star',   emoji: '✦', price: 20 },
  { id: 'eye_heart',  label: 'Heart',  emoji: '♥', price: 20 },
  { id: 'eye_x',      label: 'X Eyes', emoji: '✕', price: 20 },
]
const SHOP_ROOM: ShopItem[]    = [
  { id: 'room_plant',    label: 'Plant',    emoji: '🪴', price: 15 },
  { id: 'room_painting', label: 'Painting', emoji: '🖼️', price: 25 },
]

// ── Confetti data ─────────────────────────────────────────
const CONFETTI_COLORS = ['#FFE600', '#FF4444', '#44FF88', '#4488FF', '#FF88FF', '#FF8844', '#FF4488', '#88FF44']
const CONFETTI = Array.from({ length: 60 }, (_, i) => ({
  id:       i,
  left:     Math.round((i * 1.6667) % 100),
  color:    CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  duration: 1.5 + (i % 6) * 0.25,
  delay:    (i % 15) * 0.08,
  size:     6 + (i % 5) * 2,
}))

export default function RoomScene({ petData, onGoToPlaza, onSizeChange, isPremium: _isPremium = false }: RoomSceneProps) {
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
  const clickCountRef      = useRef<number>(0)
  const clickResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  const [isDizzy,       setIsDizzy]       = useState(false)
  const [isFainted,     setIsFainted]     = useState(false)
  const [isPetDead,     setIsPetDead]     = useState(false)
  const [isSleeping, setIsSleeping] = useState(false)
  const [showMore,    setShowMore]    = useState(false)
  const [showRewards, setShowRewards] = useState(false)
  const [showShop,    setShowShop]    = useState(false)
  const [showTasks,   setShowTasks]   = useState(false)
  const [showAllDone, setShowAllDone] = useState(false)
  const [showPlay,     setShowPlay]     = useState(false)
  const [bubbles,      setBubbles]      = useState<{ id: number; x: number; y: number; vx: number; vy: number }[]>([])
  const [blowCooldown, setBlowCooldown] = useState(false)
  const bubblesRef = useRef<{ id: number; x: number; y: number; vx: number; vy: number }[]>([])
  useEffect(() => {
    document.documentElement.style.backgroundImage = "url('/room-bg.svg')"
    document.documentElement.style.backgroundSize = '100vw 100vh'
    document.documentElement.style.backgroundRepeat = 'no-repeat'
    return () => {
      document.documentElement.style.backgroundImage = ''
      document.documentElement.style.backgroundSize = ''
      document.documentElement.style.backgroundRepeat = ''
    }
  }, [])

  useEffect(() => { bubblesRef.current = bubbles }, [bubbles])

  // ── Teach Trick ────────────────────────────────────────────
  const [showTeachMenu,    setShowTeachMenu]    = useState(false)
  const [showTeachIntro,   setShowTeachIntro]   = useState(false)
  const [showDrawModal,    setShowDrawModal]    = useState(false)
  const [showTalentPreview, setShowTalentPreview] = useState(false)
  const miniCanvasRef = useRef<HTMLCanvasElement>(null)
  const [miniColor,   setMiniColor]   = useState('#2C2C2C')
  const [isDrawing,   setIsDrawing]   = useState(false)

  // ── Daily talent (one trick per day) ─────────────────────
  const getDailyTalent = () => {
    try {
      const raw = localStorage.getItem('oodle_daily_talent')
      if (!raw) return null
      const data = JSON.parse(raw) as { date: string; talent: string; drawing?: string }
      if (data.date !== new Date().toDateString()) return null
      return data
    } catch { return null }
  }
  const [dailyTalent,   setDailyTalent]   = useState<{ date: string; talent: string; drawing?: string } | null>(() => getDailyTalent())
  const [learningTrick, setLearningTrick] = useState<string | null>(null)
  const [learningStep,  setLearningStep]  = useState(0)
  const learningTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isBusyRef        = useRef(false)
  const [tasks, setTasks] = useState<DailyTasks>(() => {
    try {
      const today = new Date().toDateString()
      const raw   = localStorage.getItem('oodle_tasks')
      if (raw) {
        const t = JSON.parse(raw) as DailyTasks
        if (t.date === today) return t
      }
      return { feed: 0, likes: 0, plaza: false, allDoneClaimed: false, date: today }
    } catch {
      return { feed: 0, likes: 0, plaza: false, allDoneClaimed: false, date: new Date().toDateString() }
    }
  })

  // ── Rewards state ─────────────────────────────────────────
  const [streak] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('oodle_streak')
      if (!raw) return 1
      const data = JSON.parse(raw) as { streak: number; lastClaimDate: string }
      const today     = new Date().toDateString()
      const yesterday = new Date(Date.now() - 86400000).toDateString()
      if (data.lastClaimDate === today)      return data.streak          // claimed today
      if (data.lastClaimDate === yesterday)  return data.streak + 1      // new day — advance
      return 1                                                            // 2+ days missed — reset
    } catch { return 1 }
  })
  const [streakClaimedToday, setStreakClaimedToday] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('oodle_streak')
      if (!raw) return false
      const data = JSON.parse(raw) as { streak: number; lastClaimDate: string }
      return data.lastClaimDate === new Date().toDateString()
    } catch { return false }
  })
  const [rewardMsg, setRewardMsg] = useState('')

  // ── Shop state ─────────────────────────────────────────────
  const [shopTab, setShopTab] = useState<'food' | 'hats' | 'glasses' | 'eyes' | 'room'>('food')
  const [ownedItems, setOwnedItems] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('oodle_owned_items') ?? '[]') as string[]
      return new Set(['eye_round', 'eye_happy', 'eye_sleepy', ...saved])
    } catch { return new Set<string>(['eye_round', 'eye_happy', 'eye_sleepy']) }
  })
  const [equippedHat, setEquippedHat] = useState<string>(() => {
    try { return localStorage.getItem('oodle_equipped_hat') ?? '' } catch { return '' }
  })
  const [equippedEye, setEquippedEye] = useState<string>(() => {
    try { return localStorage.getItem('oodle_eye_style') ?? 'eye_round' } catch { return 'eye_round' }
  })

  const isFaintedRef = useRef(false)
  const isDizzyRef   = useRef(false)

  // Close MORE popup on outside click
  useEffect(() => {
    if (!showMore) return
    const handler = () => setShowMore(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [showMore])

  // Close PLAY popup on outside click; reset teach submenu on close
  useEffect(() => {
    if (!showPlay) { setShowTeachMenu(false); return }
    const handler = () => setShowPlay(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [showPlay])

  // Clear reward message when modal closes
  useEffect(() => {
    if (!showRewards) setRewardMsg('')
  }, [showRewards])

  // Reset tasks on new day when modal opens; sync plaza-like count every 3 s while open
  useEffect(() => {
    if (!showTasks) return
    const today = new Date().toDateString()

    // Daily reset check (runs once on open)
    try {
      const raw    = localStorage.getItem('oodle_tasks')
      const stored = raw ? JSON.parse(raw) as DailyTasks : null
      if (!stored || stored.date !== today) {
        const fresh: DailyTasks = { feed: 0, likes: 0, plaza: false, allDoneClaimed: false, date: today }
        setTasks(fresh)
        localStorage.setItem('oodle_tasks', JSON.stringify(fresh))
      }
    } catch { /**/ }

    // Live plaza-like sync
    const syncLikes = () => {
      const likeRaw = localStorage.getItem('oodle_daily_plaza_likes')
      if (!likeRaw) return
      try {
        const likeData = JSON.parse(likeRaw) as { date: string; count: number }
        if (likeData.date === new Date().toDateString()) {
          setTasks((prev: DailyTasks) => {
            if (prev.likes === likeData.count) return prev
            const next = { ...prev, likes: likeData.count }
            localStorage.setItem('oodle_tasks', JSON.stringify(next))
            return next
          })
        }
      } catch { /**/ }
    }

    syncLikes()
    const interval = setInterval(syncLikes, 3000)
    return () => clearInterval(interval)
  }, [showTasks])

  // Show all-done celebration when all tasks complete (and not yet claimed)
  useEffect(() => {
    if (tasks.allDoneClaimed) return
    if (tasks.feed >= 3 && tasks.likes >= 5 && tasks.plaza) {
      setShowAllDone(true)
    }
  }, [tasks])

  // ── Growth system (day-based) ─────────────────────────────
  const [growthPoints, setGrowthPoints] = useState(() => {
    try { return Math.min(100, Math.max(0, parseInt(localStorage.getItem('oodle_growth') ?? '0', 10))) }
    catch { return 0 }
  })
  const petSize = Math.round(PET_SIZE_MIN + (growthPoints / 100) * (PET_SIZE_MAX - PET_SIZE_MIN))

  // ── Day / Night + Weekend ─────────────────────────────────
  const [isNight,   setIsNight]   = useState(() => { const h = new Date().getHours(); return h >= 19 || h < 6 })
  const [isWeekend, setIsWeekend] = useState(() => { const d = new Date().getDay();   return d === 0 || d === 6 })

  type Weather = 'clear' | 'rain' | 'thunder'
  const [weather, setWeather] = useState<Weather>('thunder')
  useEffect(() => {
    const pick = () => {
      const r = Math.random()
      setWeather(r < 0.6 ? 'clear' : r < 0.85 ? 'rain' : 'thunder')
    }
    const id = setInterval(pick, 60000)
    return () => clearInterval(id)
  }, [])

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

    checkPetDead().then(dead => { if (dead) setIsPetDead(true) }).catch(() => {})
  }, [petData])

  // ── Load like balance + poll every 10s + notify on new like ─
  useEffect(() => {
    let prevBalance = 0

    const fetchBalance = async () => {
      const b = await getLikeBalance().catch(() => 0)
      console.log('[likes] balance:', b)
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
          console.log('[likes] realtime update:', newBal)
          setLikeBalance(prev => {
            if (newBal > prev) {
              setBubble({ text: `+${newBal - prev} ❤️ someone liked you!`, id: Date.now() })
            }
            return newBal
          })
        })
        .subscribe((status, err) => {
          if (err) console.error('[likes] realtime subscription error:', err)
          else console.log('[likes] realtime status:', status)
        })
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
      const petCreated = localStorage.getItem('oodle_pet_created_at')
      if (petCreated) {
        const daysSinceCreation = Math.floor((Date.now() - parseInt(petCreated, 10)) / 86400000) + 1
        setDayCount(daysSinceCreation)
        localStorage.setItem('oodle_day_count', String(daysSinceCreation))
      } else if (d) {
        setDayCount(parseInt(d, 10))
      }

      getPetAge().then(age => {
        const streakRaw = localStorage.getItem('oodle_streak')
        let streakDays = 1
        try {
          if (streakRaw) streakDays = (JSON.parse(streakRaw) as { streak: number }).streak ?? 1
        } catch { /* ignore */ }

        const finalAge = Math.max(age ?? 0, streakDays - 1)
        const estimatedCreatedAt = Date.now() - finalAge * 86400000
        localStorage.setItem('oodle_pet_created_at', String(estimatedCreatedAt))
        setDayCount(finalAge + 1)
      }).catch(() => {})

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

      // Death by starvation: track how long hunger has been 0
      if (statsRef.current.hunger <= 0) {
        const zeroSince = localStorage.getItem('oodle_hunger_zero_since')
        if (!zeroSince) {
          localStorage.setItem('oodle_hunger_zero_since', String(Date.now()))
        } else if (Date.now() - parseInt(zeroSince, 10) >= 3 * 86400000) {
          killPet().catch(() => {})
          setIsPetDead(true)
        }
      } else {
        localStorage.removeItem('oodle_hunger_zero_since')
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
      if (Math.random() < 0.5 && !isSleepingRef.current && !isFaintedRef.current) animatorRef.current?.setState('play')
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
      if (statsRef.current.energy > 0 && !isFaintedRef.current && !isDizzyRef.current && !isSleepingRef.current && !isBusyRef.current) {
        const maxX = room.offsetWidth - petSize
        const chasing = bubblesRef.current.length > 0
        if (chasing) {
          const nearest = bubblesRef.current.reduce((a, b) =>
            Math.abs(b.x - walkXRef.current) < Math.abs(a.x - walkXRef.current) ? b : a
          )
          walkDirRef.current = nearest.x > walkXRef.current ? 1 : -1
        }
        const speed = chasing ? 3 : 0.3
        walkXRef.current += speed * walkDirRef.current
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

  // ── Blow bubbles (PLAY activity) ─────────────────────────
  const blowBubbles = useCallback(() => {
    if (blowCooldown || isSleepingRef.current || isFaintedRef.current) return
    setBlowCooldown(true)
    const newBubbles = Array.from({ length: 3 }, (_, i) => ({
      id:  Date.now() + i,
      x:   200 + Math.random() * 400,
      y:   300 + Math.random() * 100,
      vx:  (Math.random() - 0.5) * 3,
      vy:  -1.5 - Math.random(),
    }))
    setBubbles(newBubbles)
    showBubble('Ooh bubbles! 🫧')
    setTimeout(() => setBlowCooldown(false), 8000)
  }, [blowCooldown, showBubble])

  // ── Learn trick (daily talent system — 3-click flow) ─────
  // learningStep: 0=idle 1=phase1 2=await-click2 3=phase2 4=await-click3 5=phase3 6=done
  const handleLearnTrick = useCallback((trickId: string) => {
    if (dailyTalent) {
      showBubble('Already learned today! Come back tomorrow 📅')
      return
    }

    // ── First click: begin phase 1 ───────────────────────
    if (learningStep === 0) {
      setLearningTrick(trickId)
      setLearningStep(1)
      isBusyRef.current = true
      showBubble("I'm learning... 📚")
      setShowTeachMenu(false)
      setShowPlay(false)
      const emojis1: Record<string, string> = { sing: '🎵', dance: '💃', magic: '✨', drawing: '🎨' }
      const floatEmoji1 = emojis1[trickId] ?? '⭐'
      const floatInterval1 = setInterval(() => showFloat(floatEmoji1), 1500)
      setTimeout(() => clearInterval(floatInterval1), 20000)
      learningTimerRef.current = setTimeout(() => {
        setLearningStep(2)
        isBusyRef.current = false
        learningTimerRef.current = null
      }, 20000)
      return
    }

    // Must continue with the same trick
    if (learningTrick !== trickId) return

    // ── Second click: begin phase 2 ──────────────────────
    if (learningStep === 2) {
      setLearningStep(3)
      isBusyRef.current = true
      showBubble('Almost there... 💪')
      const emojis3: Record<string, string> = { sing: '🎵', dance: '💃', magic: '✨', drawing: '🎨' }
      const floatEmoji3 = emojis3[trickId] ?? '⭐'
      const floatInterval3 = setInterval(() => showFloat(floatEmoji3), 1500)
      setTimeout(() => clearInterval(floatInterval3), 20000)
      learningTimerRef.current = setTimeout(() => {
        setLearningStep(4)
        isBusyRef.current = false
        learningTimerRef.current = null
      }, 20000)
      return
    }

    // ── Third click: begin phase 3 → complete ────────────
    if (learningStep === 4) {
      setLearningStep(5)
      isBusyRef.current = true
      showBubble('I got it! ⭐')
      const emojis5: Record<string, string> = { sing: '🎵', dance: '💃', magic: '✨', drawing: '🎨' }
      const floatEmoji5 = emojis5[trickId] ?? '⭐'
      const floatInterval5 = setInterval(() => showFloat(floatEmoji5), 1500)
      setTimeout(() => clearInterval(floatInterval5), 20000)
      learningTimerRef.current = setTimeout(() => {
        const today = new Date().toDateString()
        const talentData = { date: today, talent: trickId }
        localStorage.setItem('oodle_daily_talent', JSON.stringify(talentData))
        saveTalent(trickId).catch(() => {})
        setDailyTalent(talentData)
        setLearningTrick(null)
        setLearningStep(6)
        isBusyRef.current = false
        learningTimerRef.current = null
      }, 20000)
    }
  }, [dailyTalent, learningTrick, learningStep, showBubble, showFloat])

  // ── Bubble physics ────────────────────────────────────────
  useEffect(() => {
    if (bubbles.length === 0) return
    const interval = setInterval(() => {
      setBubbles(prev => {
        const petEl = petWrapperRef.current
        const petX  = petEl ? parseInt(petEl.style.left || '0') : 0
        const petY  = window.innerHeight * 0.78
        return prev
          .map(b => ({ ...b, x: b.x + b.vx, y: b.y + b.vy, vy: b.vy + 0.08 }))
          .filter(b => {
            const dist = Math.sqrt((b.x - petX) ** 2 + (b.y - petY) ** 2)
            if (dist < 60) {
              setStats((s: PetStats) => ({ ...s, happy: Math.min(100, s.happy + 3) }))
              showFloat('💥')
              showBubble('So fun! 😄')
              // Jump animation when very close
              if (dist < 30) {
                const w = petWrapperRef.current
                if (w) {
                  w.style.bottom = 'calc(22% + 20px)'
                  setTimeout(() => { if (w) w.style.bottom = '22%' }, 200)
                }
              }
              return false
            }
            return b.y < 700 && b.x > -50 && b.x < 1600
          })
      })
    }, 80)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubbles.length > 0])

  // ── Random singing when pet is happy ─────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const s = statsRef.current
      if (
        s.happy  >= 70 &&
        s.hunger >= 50 &&
        s.energy >= 30 &&
        !isSleepingRef.current &&
        !isFaintedRef.current &&
        Math.random() < 0.3
      ) {
        showBubble('La la la 🎵')
      }
    }, 60000)
    return () => clearInterval(interval)
  }, [showBubble])

  // ── Mini drawing canvas: fill white on open ──────────────
  useEffect(() => {
    if (!showDrawModal) return
    const canvas = miniCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 192, 192)
  }, [showDrawModal])

  // ── Auto-performance of daily talent (every 45 s) ─────────
  useEffect(() => {
    const interval = setInterval(() => {
      if (!dailyTalent) return
      if (isSleepingRef.current || isFaintedRef.current || isBusyRef.current) return
      if (statsRef.current.happy < 50) return

      const trick = dailyTalent.talent

      if (trick === 'sing') {
        showBubble('🎵 La la la~')
        for (let i = 0; i < 3; i++) setTimeout(() => showFloat('🎵'), i * 400)
      } else if (trick === 'dance') {
        showBubble('💃 Watch me!')
        animatorRef.current?.setState('dance')
      } else if (trick === 'magic') {
        showBubble('✨ Ta-da!')
        const wrapper = petWrapperRef.current
        if (wrapper) {
          wrapper.style.visibility = 'hidden'
          setTimeout(() => { if (wrapper) wrapper.style.visibility = 'visible' }, 1000)
        }
      } else if (trick === 'drawing') {
        showBubble('🎨 I made this!')
        setShowTalentPreview(true)
        setTimeout(() => setShowTalentPreview(false), 3000)
      }
    }, 45000)
    return () => clearInterval(interval)
  }, [dailyTalent, showBubble, showFloat])

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
    if (likeBalance < 10) return
    const ok = await redeemLikesForFood(10)
    if (ok) {
      setBigFood((f: number) => f + 1)
      setLikeBalance(b => b - 10)
      showFloat('🍱')
      showBubble('Got a meal!')
    }
  }, [likeBalance, showFloat, showBubble])

  // ── Feed ──────────────────────────────────────────────────
  const handleFeed = useCallback((size: 'small' | 'big') => {
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
    setTasks((t: DailyTasks) => {
      if (t.feed >= 3) return t
      const next = { ...t, feed: t.feed + 1 }
      localStorage.setItem('oodle_tasks', JSON.stringify(next))
      return next
    })
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
    clickCountRef.current += 1

    // Reset counter after 2 seconds of no clicks
    if (clickResetTimerRef.current) clearTimeout(clickResetTimerRef.current)
    clickResetTimerRef.current = setTimeout(() => { clickCountRef.current = 0 }, 2000)

    if (clickCountRef.current >= 5) {
      showBubble('Hehe! 🤭')
      setStats((prev: PetStats) => ({ ...prev, happy: Math.min(100, prev.happy + 2) }))
      clickCountRef.current = 0
      return
    } else if (clickCountRef.current >= 3) {
      showBubble('Stop it! 😤')
      return
    }

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
    setTasks((t: DailyTasks) => {
      if (t.plaza) return t
      const next = { ...t, plaza: true }
      localStorage.setItem('oodle_tasks', JSON.stringify(next))
      return next
    })
    setDoorPhase('appearing')
  }, [doorPhase])

  const isTransitioning = doorPhase !== 'idle'
  const plazaReady = petSaved && !isTransitioning && !isDizzy && !isFainted && !isSleeping

  return (
    <div className={styles.page}>
      <div className={styles.room} ref={roomRef} style={{ position: 'relative', zIndex: 1 }}>

        {/* Night overlay */}
        {isNight && <div className={styles.nightOverlay} />}

        {/* Window: night sky with stars */}
        {isNight && (
          <div style={{
            position: 'absolute', left: '14%', top: '9%',
            width: '28%', height: '35%',
            background: '#0a1428',
            pointerEvents: 'none', zIndex: 2,
          }}>
            {/* Stars */}
            {['15%','35%','55%','75%','25%','65%','45%','85%','10%','90%'].map((l, i) => (
              <div key={i} style={{
                position: 'absolute', left: l,
                top: ['20%','45%','15%','60%','75%','30%','55%','10%','85%','40%'][i],
                width: 3, height: 3, background: 'white',
                borderRadius: 0,
                opacity: Math.random() > 0.5 ? 1 : 0.6,
              }} />
            ))}
            {/* Moon */}
            <div style={{
              position: 'absolute', right: '15%', top: '15%',
              width: 20, height: 20, background: '#FFFACD',
            }} />
          </div>
        )}

        {/* Window: grey sky on rain/thunder */}
        {(weather === 'rain' || weather === 'thunder') && (
          <div style={{
            position: 'absolute',
            left: '17%', top: '8%',
            width: '22%', height: '44%',
            background: 'rgba(80,90,100,0.45)',
            pointerEvents: 'none', zIndex: 1,
          }} />
        )}

        {/* Window: rain */}
        {(weather === 'rain' || weather === 'thunder') && (
          <div style={{
            position: 'absolute',
            left: '17%', top: '10%',
            width: '22%', height: '38%',
            overflow: 'hidden',
            pointerEvents: 'none', zIndex: 2,
          }}>
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} style={{
                position: 'absolute',
                left: `${(i * 5.2) % 100}%`,
                top: '-10%',
                width: '2px',
                height: '12px',
                background: 'rgba(174,214,241,0.7)',
                animation: `rainDrop ${0.4 + (i % 5) * 0.08}s linear ${(i * 0.07) % 0.5}s infinite`,
                transform: 'rotate(10deg)',
              }} />
            ))}
          </div>
        )}

        {/* Window: lightning bolt + flash */}
        {weather === 'thunder' && (
          <div style={{
            position: 'absolute',
            left: '17%', top: '8%',
            width: '22%', height: '44%',
            overflow: 'hidden',
            pointerEvents: 'none', zIndex: 4,
          }}>
            <div style={{
              position: 'absolute', inset: 0,
              pointerEvents: 'none', zIndex: 3,
              animation: 'thunderFlash 3s ease-in-out infinite',
            }} />
            <svg style={{
              position: 'absolute',
              left: '40%', top: '5%',
              width: '40px', height: '120px',
              animation: 'lightningBolt 3s ease-in-out infinite',
              filter: 'drop-shadow(0 0 8px #FFE87C)',
            }} viewBox="0 0 40 120">
              <polyline points="24,0 10,55 22,55 16,120 34,50 20,50 28,0" fill="#FFE87C" stroke="#FFF176" strokeWidth="1"/>
            </svg>
          </div>
        )}

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
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              className={styles.convertBtn}
              style={{ flex: 1 }}
              onClick={handleRedeemSmall}
              disabled={likeBalance < 5}
            >
              <span style={{ color: '#fff' }}>🍎 SNACK</span>
              <span className={styles.costTag}>5 ❤️</span>
            </button>
            <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '11px', color: smallFood > 0 ? '#FFE600' : '#555', minWidth: '16px', textAlign: 'center' }}>{smallFood}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              className={styles.convertBtn}
              style={{ flex: 1 }}
              onClick={handleRedeemBig}
              disabled={likeBalance < 10}
            >
              <span style={{ color: '#fff' }}>🍱 MEAL</span>
              <span className={styles.costTag}>10 ❤️</span>
            </button>
            <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '11px', color: bigFood > 0 ? '#FFE600' : '#555', minWidth: '16px', textAlign: 'center' }}>{bigFood}</span>
          </div>
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
          {showTalentPreview && (() => {
            const drawingData = localStorage.getItem('oodle_talent_drawing')
            return drawingData ? (
              <div style={{ position: 'absolute', bottom: '115%', left: '50%', transform: 'translateX(-50%)', background: '#fff', border: '2px solid #2C2C2C', boxShadow: '2px 2px 0 #2C2C2C', padding: '4px', zIndex: 12, pointerEvents: 'none' }}>
                <img src={drawingData} style={{ width: 48, height: 48, imageRendering: 'pixelated', display: 'block' }} alt="my drawing" />
              </div>
            ) : null
          })()}
          {bubble && <div className={styles.bubble} key={bubble.id}>{bubble.text}</div>}
          {floatEmojis.map(e => (
            <span key={e.id} className={styles.floatEmoji}>{e.char}</span>
          ))}
        </div>

        {/* Floating bubbles */}
        {bubbles.map(b => (
          <div key={b.id} style={{ position: 'absolute', left: b.x, top: b.y, fontSize: '28px', pointerEvents: 'none', zIndex: 8, transform: 'translateX(-50%)' }}>🫧</div>
        ))}
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
              🔥 STREAK: {isAnonymous ? '--' : `DAY ${streak}`}
            </div>
            <button
              className={styles.morePopupItem}
              onClick={() => { setShowMore(false); setShowRewards(true) }}
            >🎁 REWARDS</button>
            <button
              className={styles.morePopupItem}
              onClick={() => { setShowMore(false); setShowShop(true) }}
            >🛒 SHOP</button>
            <button
              className={`${styles.morePopupItem} ${styles.morePopupItemLast}`}
              onClick={() => { setShowMore(false); setShowTasks(true) }}
            >✅ TASKS</button>
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

        {/* CENTRE: play + feed + plaza */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* PLAY button + popup */}
          <div style={{ position: 'relative' }}>
            {showPlay && (
              <div className={styles.playPopup} onClick={e => e.stopPropagation()}>
                <button className={styles.playPopupItem} onClick={() => { setShowPlay(false); blowBubbles() }}>
                  🫧 BLOW BUBBLES
                </button>
                {/* TEACH TRICK item with submenu */}
                <div style={{ position: 'relative' }}>
                  <button
                    className={styles.playPopupItem}
                    style={{ justifyContent: 'space-between' }}
                    onClick={() => {
                      if (!localStorage.getItem('oodle_teach_trick_seen')) {
                        setShowTeachIntro(true)
                        setShowTeachMenu(false)
                        setShowPlay(false)
                      } else {
                        setShowTeachMenu(v => !v)
                      }
                    }}
                  >
                    <span>🎓 TEACH TRICK</span>
                    <span style={{ fontSize: '6px' }}>▶</span>
                  </button>
                  {showTeachMenu && (
                    <div style={{ position: 'absolute', bottom: '100%', left: '100%', top: 'auto', background: '#FDF6E3', border: '2px solid #2C2C2C', boxShadow: '4px 4px 0 #2C2C2C', minWidth: '180px', zIndex: 31 }}>
                      <div style={{ background: '#2C2C2C', color: '#FFE600', fontFamily: 'var(--font-pixel)', fontSize: '7px', padding: '8px 12px', letterSpacing: '1px', whiteSpace: 'nowrap' }}>
                        🎓 CHOOSE A TRICK
                      </div>
                      {[
                        { id: 'sing',  label: '🎵 SING'       },
                        { id: 'dance', label: '🕺 DANCE'       },
                        { id: 'magic', label: '🪄 MAGIC TRICK' },
                      ].map(trick => {
                        const isThisTrick   = learningTrick === trick.id
                        const isBusy        = isThisTrick && (learningStep === 1 || learningStep === 3 || learningStep === 5)
                        const needsClick2   = isThisTrick && learningStep === 2
                        const needsClick3   = isThisTrick && learningStep === 4
                        const otherLearning = learningTrick !== null && !isThisTrick
                        const isDisabled    = !!dailyTalent || isBusy || otherLearning
                        const btnBg         = (needsClick2 || needsClick3) ? '#FFE600' : '#fff'
                        return (
                          <button
                            key={trick.id}
                            disabled={isDisabled}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', fontFamily: 'var(--font-pixel)', fontSize: '8px', color: '#2C2C2C', background: btnBg, border: 'none', borderBottom: '1px solid #eee', padding: '10px 12px', cursor: isDisabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: (dailyTalent || otherLearning) ? 0.5 : 1 }}
                            onClick={() => handleLearnTrick(trick.id)}
                          >
                            {trick.label}
                            {dailyTalent && (
                              <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '5px', background: '#4CAF50', color: '#fff', padding: '2px 5px' }}>DONE TODAY ✓</span>
                            )}
                            {!dailyTalent && isBusy && (
                              <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '5px', background: '#FF8C00', color: '#fff', padding: '2px 5px' }}>LEARNING... ⏳</span>
                            )}
                            {!dailyTalent && needsClick2 && (
                              <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '5px', background: '#2C2C2C', color: '#FFE600', padding: '2px 5px' }}>CLICK! (2/3)</span>
                            )}
                            {!dailyTalent && needsClick3 && (
                              <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '5px', background: '#2C2C2C', color: '#FFE600', padding: '2px 5px' }}>CLICK! (3/3)</span>
                            )}
                          </button>
                        )
                      })}
                      <button
                        disabled={!!dailyTalent || learningTrick !== null}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', fontFamily: 'var(--font-pixel)', fontSize: '8px', color: '#2C2C2C', background: '#fff', border: 'none', padding: '10px 12px', cursor: (dailyTalent || learningTrick !== null) ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: (dailyTalent || learningTrick !== null) ? 0.5 : 1 }}
                        onClick={() => {
                          if (dailyTalent) { showBubble('Already learned today! Come back tomorrow 📅'); return }
                          if (learningTrick !== null) return
                          setShowDrawModal(true)
                          setShowTeachMenu(false)
                          setShowPlay(false)
                        }}
                      >
                        🎨 TEACH DRAWING
                        {dailyTalent ? (
                          <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '5px', background: '#4CAF50', color: '#fff', padding: '2px 5px' }}>DONE TODAY ✓</span>
                        ) : (
                          <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '5px', background: '#FF8C00', color: '#fff', padding: '2px 5px' }}>SPECIAL</span>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
            <button
              className={`${styles.actionBtn} ${showPlay ? styles.playBtnActive : styles.playBtn}`}
              onClick={e => { e.stopPropagation(); setShowPlay(v => !v) }}
              disabled={isSleeping}
            >
              🎮 PLAY
            </button>
          </div>
          <button
            className={styles.actionBtn}
            onClick={() => handleFeed('small')}
            disabled={smallFood <= 0 || isSleeping}
          >
            🍎 FEED SNACK
          </button>
          <button
            className={styles.actionBtn}
            onClick={() => handleFeed('big')}
            disabled={bigFood <= 0 || isSleeping}
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

      {/* ── REWARDS MODAL ─────────────────────────────────── */}
      {showRewards && (() => {
        const dayIndex   = (streak - 1) % 7           // 0-based index into REWARD_DAYS
        const dayInCycle = dayIndex + 1                // 1-based for display

        const handleClaim = () => {
          const reward = REWARD_DAYS[dayIndex]
          if (reward.snacks > 0) setSmallFood((n: number) => n + reward.snacks)
          if (reward.meals  > 0) setBigFood((n: number)   => n + reward.meals)
          const today = new Date().toDateString()
          localStorage.setItem('oodle_streak', JSON.stringify({ streak, lastClaimDate: today }))
          setStreakClaimedToday(true)
          setRewardMsg(reward.claimMsg)
        }

        return (
          <div onClick={() => setShowRewards(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#FDF6E3', border: '3px solid #2C2C2C', boxShadow: '6px 6px 0 #2C2C2C', maxWidth: '560px', width: '100%', maxHeight: '90vh', overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>
              {/* Header */}
              <div style={{ background: '#2C2C2C', color: '#FFE600', fontFamily: 'var(--font-pixel)', fontSize: '13px', fontWeight: 'normal', textAlign: 'center', padding: '14px', letterSpacing: '2px' }}>
                🔥 DAILY LOGIN REWARD
              </div>
              <button onClick={() => setShowRewards(false)} style={{ position: 'absolute', top: '8px', right: '8px', fontFamily: 'var(--font-pixel)', fontSize: '12px', fontWeight: 'normal', background: 'transparent', border: '2px solid #FFE600', color: '#FFE600', width: '28px', height: '28px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>

              <div style={{ padding: '20px' }}>
                {/* Streak counter */}
                <div style={{ textAlign: 'center', fontFamily: 'var(--font-pixel)', fontSize: '16px', fontWeight: 'normal', color: '#cc2200', marginBottom: '16px', letterSpacing: '1px' }}>
                  🔥 DAY {streak} STREAK!
                </div>

                {/* 7-day grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '20px', overflowX: 'hidden' }}>
                  {REWARD_DAYS.map((day, i) => {
                    const n       = i + 1
                    const isPast  = n < dayInCycle || (n === dayInCycle && streakClaimedToday)
                    const isToday = n === dayInCycle && !streakClaimedToday
                    const isFuture = n > dayInCycle
                    return (
                      <div key={n} style={{ border: `2px solid ${day.rare ? '#9B59B6' : '#2C2C2C'}`, background: isPast ? '#d4f5d4' : isToday ? '#FFE600' : '#fff', padding: '6px 2px', textAlign: 'center', opacity: isFuture ? 0.4 : 1, position: 'relative', minWidth: 0, overflow: 'hidden' }}>
                        <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '9px', fontWeight: 'normal', color: '#888', marginBottom: '3px' }}>DAY {n}</div>
                        <div style={{ fontSize: '14px', lineHeight: 1.2 }}>{day.emoji}</div>
                        <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '12px', fontWeight: 'normal', color: day.rare ? '#9B59B6' : '#555', lineHeight: 1.4, marginTop: '2px', overflowWrap: 'break-word', wordBreak: 'break-word' }}>{day.label}</div>
                        {isPast  && <div style={{ position: 'absolute', top: 1, right: 2, fontSize: '9px', color: '#4CAF50' }}>✓</div>}
                        {isToday && <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '10px', fontWeight: 'normal', color: '#cc2200', marginTop: '2px' }}>TODAY</div>}
                      </div>
                    )
                  })}
                </div>

                {/* Claim area */}
                {rewardMsg ? (
                  <div style={{ textAlign: 'center', fontFamily: 'var(--font-pixel)', fontSize: '10px', fontWeight: 'normal', color: '#4CAF50', padding: '14px', border: '2px solid #4CAF50', lineHeight: 2 }}>
                    ✅ REWARD CLAIMED!<br />{rewardMsg}
                  </div>
                ) : streakClaimedToday ? (
                  <div style={{ textAlign: 'center', fontFamily: 'var(--font-pixel)', fontSize: '12px', fontWeight: 'normal', color: '#888', padding: '14px', border: '2px solid #ddd', lineHeight: 2 }}>
                    ✓ CLAIMED TODAY<br />COME BACK TOMORROW!
                  </div>
                ) : (
                  <button onClick={handleClaim} style={{ width: '100%', fontFamily: 'var(--font-pixel)', fontSize: '10px', fontWeight: 'normal', padding: '14px', background: '#FFE600', color: '#2C2C2C', border: '2px solid #2C2C2C', boxShadow: '4px 4px 0 #2C2C2C', cursor: 'pointer', letterSpacing: '2px' }}>
                    🎁 CLAIM REWARD
                  </button>
                )}

                {/* Warning + login hint */}
                <p style={{ fontFamily: 'var(--font-pixel)', fontSize: '10px', fontWeight: 'normal', color: '#cc2200', textAlign: 'center', marginTop: '12px', lineHeight: 2 }}>⚠ Miss a day and streak resets!</p>
                {isAnonymous && <p style={{ fontFamily: 'var(--font-pixel)', fontSize: '10px', fontWeight: 'normal', color: '#888', textAlign: 'center', marginTop: '4px', lineHeight: 2 }}>* Login with Google to claim rewards</p>}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── SHOP MODAL ──────────────────────────────────────── */}
      {showShop && (() => {
        const isOwned = (id: string) => ownedItems.has(id)

        const handleBuyItem = (item: ShopItem) => {
          if (likeBalance < item.price || isOwned(item.id)) return
          setLikeBalance((prev: number) => prev - item.price)
          const next = new Set([...ownedItems, item.id])
          setOwnedItems(next)
          localStorage.setItem('oodle_owned_items', JSON.stringify(Array.from(next)))
        }

        const handleEquipHat = (id: string) => {
          const next = equippedHat === id ? '' : id
          setEquippedHat(next)
          localStorage.setItem('oodle_equipped_hat', next)
        }

        const handleEquipEye = (id: string) => {
          setEquippedEye(id)
          localStorage.setItem('oodle_eye_style', id)
        }

        const shopTabs: Array<{ id: 'food' | 'hats' | 'glasses' | 'eyes' | 'room'; label: string }> = [
          { id: 'food',    label: '🍖 FOOD'    },
          { id: 'hats',    label: '🎩 HATS'    },
          { id: 'glasses', label: '👓 GLASS'   },
          { id: 'eyes',    label: '👁 EYES'    },
          { id: 'room',    label: '🪴 ROOM'    },
        ]

        const ItemCard = ({ item, equippedId, onEquip }: { item: ShopItem; equippedId?: string; onEquip?: (id: string) => void }) => {
          const owned     = isOwned(item.id)
          const equipped  = equippedId === item.id
          const canAfford = likeBalance >= item.price
          return (
            <div style={{ border: `2px solid ${item.rare ? '#9B59B6' : '#2C2C2C'}`, boxShadow: '2px 2px 0 #2C2C2C', padding: '10px 6px', textAlign: 'center', background: equipped ? '#FFE600' : owned ? '#f0fff0' : '#fff', position: 'relative' }}>
              <div style={{ fontSize: '22px', marginBottom: '4px' }}>{item.emoji}</div>
              <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '13px', color: item.rare ? '#9B59B6' : '#2C2C2C', marginBottom: '6px', lineHeight: 1.4 }}>{item.label}</div>
              {equipped && <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '11px', color: '#4CAF50', marginBottom: '4px' }}>ON</div>}
              {owned && !equipped && onEquip && (
                <button onClick={() => onEquip(item.id)} style={{ fontFamily: 'var(--font-pixel)', fontSize: '11px', padding: '4px 6px', background: '#2C2C2C', color: '#FFE600', border: 'none', cursor: 'pointer', width: '100%' }}>EQUIP</button>
              )}
              {owned && !onEquip && !equipped && <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '11px', color: '#4CAF50' }}>OWNED</div>}
              {!owned && item.price === 0 && <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '11px', color: '#4CAF50' }}>FREE</div>}
              {!owned && item.price > 0 && (
                <button
                  onClick={() => handleBuyItem(item)}
                  disabled={!canAfford}
                  style={{ fontFamily: 'var(--font-pixel)', fontSize: '12px', padding: '4px 6px', background: canAfford ? '#FFE600' : '#eee', color: '#2C2C2C', border: `1px solid ${item.rare ? '#9B59B6' : '#2C2C2C'}`, cursor: canAfford ? 'pointer' : 'not-allowed', width: '100%' }}
                >
                  ❤️ {item.price}
                </button>
              )}
            </div>
          )
        }

        return (
          <div onClick={() => setShowShop(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#FDF6E3', border: '3px solid #2C2C2C', boxShadow: '6px 6px 0 #2C2C2C', maxWidth: '480px', width: '100%', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}>
              {/* Header */}
              <div style={{ background: '#2C2C2C', color: '#FFE600', fontFamily: 'var(--font-pixel)', fontSize: '11px', textAlign: 'center', padding: '14px', letterSpacing: '2px' }}>
                🛒 SHOP
              </div>
              <button onClick={() => setShowShop(false)} style={{ position: 'absolute', top: '8px', right: '8px', fontFamily: 'var(--font-pixel)', fontSize: '12px', background: 'transparent', border: '2px solid #FFE600', color: '#FFE600', width: '28px', height: '28px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>

              {/* Like balance */}
              <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '13px', color: '#cc2200', textAlign: 'center', padding: '10px', background: '#fff8e1', borderBottom: '2px solid #2C2C2C' }}>
                ❤️ BALANCE: {likeBalance} LIKES
              </div>

              {/* Tab bar */}
              <div style={{ display: 'flex', borderBottom: '2px solid #2C2C2C' }}>
                {shopTabs.map(t => (
                  <button key={t.id} onClick={() => setShopTab(t.id)} style={{ flex: 1, fontFamily: 'var(--font-pixel)', fontSize: '11px', padding: '8px 2px', background: shopTab === t.id ? '#FFE600' : '#fff', border: 'none', borderRight: '1px solid #2C2C2C', cursor: 'pointer', color: '#2C2C2C' }}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div style={{ padding: '16px' }}>
                {shopTab === 'food' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {[
                      { label: '🍪 SNACK',     price: 5,  onBuy: () => { if (likeBalance >= 5) { setLikeBalance((p: number) => p - 5); setSmallFood((p: number) => p + 1) } } },
                      { label: '🍖 MEAL',      price: 10, onBuy: () => { if (likeBalance >= 10) { setLikeBalance((p: number) => p - 10); setBigFood((p: number)   => p + 1) } } },
                    ].map(f => (
                      <div key={f.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '2px solid #2C2C2C', boxShadow: '2px 2px 0 #2C2C2C', padding: '12px 14px', background: '#fff' }}>
                        <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '13px', color: '#2C2C2C' }}>{f.label}</span>
                        <button onClick={f.onBuy} disabled={likeBalance < f.price} style={{ fontFamily: 'var(--font-pixel)', fontSize: '12px', padding: '6px 12px', background: likeBalance >= f.price ? '#FFE600' : '#eee', color: '#2C2C2C', border: '2px solid #2C2C2C', boxShadow: likeBalance >= f.price ? '2px 2px 0 #2C2C2C' : 'none', cursor: likeBalance >= f.price ? 'pointer' : 'not-allowed' }}>
                          ❤️ {f.price}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {shopTab === 'hats' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {SHOP_HATS.map(item => <ItemCard key={item.id} item={item} equippedId={equippedHat} onEquip={handleEquipHat} />)}
                  </div>
                )}

                {shopTab === 'glasses' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                    {SHOP_GLASSES.map(item => <ItemCard key={item.id} item={item} equippedId={equippedHat} onEquip={handleEquipHat} />)}
                  </div>
                )}

                {shopTab === 'eyes' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {SHOP_EYES.map(item => <ItemCard key={item.id} item={item} equippedId={equippedEye} onEquip={item.price === 0 || isOwned(item.id) ? handleEquipEye : undefined} />)}
                  </div>
                )}

                {shopTab === 'room' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                    {SHOP_ROOM.map(item => <ItemCard key={item.id} item={item} />)}
                  </div>
                )}
              </div>

              {/* Footer */}
              {(equippedHat || equippedEye) && (
                <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '11px', color: '#555', textAlign: 'center', padding: '10px', borderTop: '2px solid #ddd', lineHeight: 2 }}>
                  {equippedHat && `🎩 ${SHOP_HATS.find(h => h.id === equippedHat)?.label ?? ''} equipped`}
                  {equippedHat && equippedEye && '  ·  '}
                  {equippedEye && `👁 ${SHOP_EYES.find(e => e.id === equippedEye)?.label ?? ''} eyes`}
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── DRAW MODAL ──────────────────────────────────── */}
      {showDrawModal && (() => {
        const CELL = 12
        const GRID = 16
        const COLORS = ['#2C2C2C', '#e74c3c', '#3498db', '#2ecc71', '#FFE600', '#ffffff']

        const drawCell = (e: React.MouseEvent<HTMLCanvasElement>) => {
          const canvas = miniCanvasRef.current
          if (!canvas) return
          const rect = canvas.getBoundingClientRect()
          const x = Math.floor((e.clientX - rect.left) / CELL)
          const y = Math.floor((e.clientY - rect.top)  / CELL)
          if (x < 0 || x >= GRID || y < 0 || y >= GRID) return
          const ctx = canvas.getContext('2d')!
          ctx.fillStyle = miniColor
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL)
        }

        const handleTeachDrawing = () => {
          const canvas = miniCanvasRef.current
          if (!canvas) return
          const dataURL = canvas.toDataURL()
          const today = new Date().toDateString()
          const talentData = { date: today, talent: 'drawing', drawing: dataURL }
          localStorage.setItem('oodle_talent_drawing', dataURL)
          localStorage.setItem('oodle_daily_talent', JSON.stringify(talentData))
          saveTalentDrawing(dataURL).catch(() => {})
          saveTalent('drawing').catch(() => {})
          setDailyTalent(talentData)
          showBubble('I can draw now! 🎨')
          setShowDrawModal(false)
        }

        return (
          <div onClick={() => setShowDrawModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#FDF6E3', border: '3px solid #2C2C2C', boxShadow: '6px 6px 0 #2C2C2C', maxWidth: '320px', width: '100%', position: 'relative' }}>
              <div style={{ background: '#2C2C2C', color: '#FFE600', fontFamily: 'var(--font-pixel)', fontSize: '10px', textAlign: 'center', padding: '14px', letterSpacing: '2px' }}>
                🎨 TEACH MY PET TO DRAW
              </div>
              <button onClick={() => setShowDrawModal(false)} style={{ position: 'absolute', top: '8px', right: '8px', fontFamily: 'var(--font-pixel)', fontSize: '12px', background: 'transparent', border: '2px solid #FFE600', color: '#FFE600', width: '28px', height: '28px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>

              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                {/* Color palette */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  {COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setMiniColor(c)}
                      style={{ width: 24, height: 24, background: c, border: miniColor === c ? '3px solid #2C2C2C' : '2px solid #999', boxShadow: miniColor === c ? '2px 2px 0 #000' : 'none', cursor: 'pointer' }}
                    />
                  ))}
                </div>

                {/* Drawing canvas */}
                <canvas
                  ref={miniCanvasRef}
                  width={192}
                  height={192}
                  style={{ border: '2px solid #2C2C2C', imageRendering: 'pixelated', cursor: 'crosshair', touchAction: 'none' }}
                  onMouseDown={e => { setIsDrawing(true); drawCell(e) }}
                  onMouseMove={e => { if (isDrawing) drawCell(e) }}
                  onMouseUp={() => setIsDrawing(false)}
                  onMouseLeave={() => setIsDrawing(false)}
                />

                <button
                  onClick={handleTeachDrawing}
                  style={{ fontFamily: 'var(--font-pixel)', fontSize: '9px', padding: '12px 24px', background: '#FFE600', color: '#2C2C2C', border: '2px solid #2C2C2C', boxShadow: '4px 4px 0 #2C2C2C', cursor: 'pointer', letterSpacing: '2px', width: '100%' }}
                >
                  🎓 TEACH MY PET
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── TASKS MODAL ─────────────────────────────────── */}
      {showTasks && (() => {
        const allDone = tasks.feed >= 3 && tasks.likes >= 5 && tasks.plaza

        const taskRows: Array<{ label: string; emoji: string; current: number; goal: number; done: boolean }> = [
          { label: 'FEED YOUR PET',   emoji: '🍖', current: tasks.feed,               goal: 3, done: tasks.feed  >= 3 },
          { label: 'LIKE 5 PETS',     emoji: '❤️', current: Math.min(5, tasks.likes),  goal: 5, done: tasks.likes >= 5 },
          { label: 'VISIT THE PLAZA', emoji: '🏙️', current: tasks.plaza ? 1 : 0,      goal: 1, done: tasks.plaza      },
        ]

        const handleClaimAll = () => {
          setSmallFood((n: number) => n + 2)
          setBigFood((n: number)   => n + 1)
          const next = { ...tasks, allDoneClaimed: true }
          setTasks(next)
          localStorage.setItem('oodle_tasks', JSON.stringify(next))
          setShowAllDone(false)
          setShowTasks(false)
          showBubble('All tasks done! +2🍪 +1🍖')
        }

        return (
          <div onClick={() => setShowTasks(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#FDF6E3', border: '3px solid #2C2C2C', boxShadow: '6px 6px 0 #2C2C2C', maxWidth: '380px', width: '100%', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}>
              <div style={{ background: '#2C2C2C', color: '#FFE600', fontFamily: 'var(--font-pixel)', fontSize: '11px', textAlign: 'center', padding: '14px', letterSpacing: '2px' }}>
                ✅ DAILY TASKS
              </div>
              <button onClick={() => setShowTasks(false)} style={{ position: 'absolute', top: '8px', right: '8px', fontFamily: 'var(--font-pixel)', fontSize: '12px', background: 'transparent', border: '2px solid #FFE600', color: '#FFE600', width: '28px', height: '28px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>

              <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {taskRows.map(task => (
                  <div key={task.label} style={{ border: `2px solid ${task.done ? '#4CAF50' : '#2C2C2C'}`, boxShadow: '2px 2px 0 #2C2C2C', padding: '12px 14px', background: task.done ? '#f0fff0' : '#fff' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '7px', color: task.done ? '#4CAF50' : '#2C2C2C', letterSpacing: '1px' }}>
                        {task.emoji} {task.label}
                      </span>
                      <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '7px', color: task.done ? '#4CAF50' : '#888' }}>
                        {task.done ? '✓ DONE' : `${task.current}/${task.goal}`}
                      </span>
                    </div>
                    <div style={{ width: '100%', height: '8px', background: '#eee', border: '1px solid #2C2C2C' }}>
                      <div style={{ height: '100%', width: `${Math.min(100, (task.current / task.goal) * 100)}%`, background: task.done ? '#4CAF50' : '#FFE600' }} />
                    </div>
                  </div>
                ))}

                {/* Bonus row */}
                <div style={{ border: `3px solid ${allDone ? '#FFE600' : '#ddd'}`, boxShadow: allDone ? '3px 3px 0 #2C2C2C' : 'none', padding: '16px', background: allDone ? '#fffde7' : '#f9f9f9', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '8px', color: allDone ? '#cc2200' : '#aaa', marginBottom: '8px', letterSpacing: '1px' }}>
                    🎁 ALL DONE BONUS
                  </div>
                  <div style={{ fontFamily: 'var(--font-retro)', fontSize: '18px', color: '#2C2C2C', marginBottom: '10px', lineHeight: 1.6 }}>
                    +2 🍪 Snacks · +1 🍖 Meal
                  </div>
                  {tasks.allDoneClaimed ? (
                    <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '7px', color: '#4CAF50', padding: '8px', border: '1px solid #4CAF50' }}>✓ CLAIMED TODAY</div>
                  ) : allDone ? (
                    <button onClick={handleClaimAll} style={{ fontFamily: 'var(--font-pixel)', fontSize: '9px', padding: '12px 20px', background: '#FFE600', color: '#2C2C2C', border: '2px solid #2C2C2C', boxShadow: '4px 4px 0 #2C2C2C', cursor: 'pointer', letterSpacing: '2px', width: '100%' }}>
                      🎁 CLAIM REWARD
                    </button>
                  ) : (
                    <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '6px', color: '#aaa' }}>COMPLETE ALL TASKS TO UNLOCK</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── TEACH TRICK INTRO MODAL ─────────────────────── */}
      {showTeachIntro && (
        <div
          onClick={() => setShowTeachIntro(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#FDF6E3', border: '3px solid #2C2C2C', boxShadow: '6px 6px 0 #2C2C2C', maxWidth: '420px', width: '100%', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}
          >
            {/* Header */}
            <div style={{ background: '#2C2C2C', color: '#FFE600', fontFamily: 'var(--font-pixel)', fontSize: '10px', textAlign: 'center', padding: '14px', letterSpacing: '2px' }}>
              🎓 TEACH YOUR PET A TRICK!
            </div>
            <button
              onClick={() => setShowTeachIntro(false)}
              style={{ position: 'absolute', top: '8px', right: '8px', fontFamily: 'var(--font-pixel)', fontSize: '12px', background: 'transparent', border: '2px solid #FFE600', color: '#FFE600', width: '28px', height: '28px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >✕</button>

            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Intro text */}
              <p style={{ fontFamily: 'var(--font-retro)', fontSize: '19px', color: '#555', borderLeft: '3px solid #FFE600', paddingLeft: '10px', margin: 0, lineHeight: 1.5 }}>
                Teach your pet a talent and show it off in the Plaza! Other players will see your pet perform automatically.
              </p>

              {/* 2×2 trick grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {[
                  { emoji: '🎵', name: 'SING',     desc: 'Pet sings La la la~ in plaza',     special: false },
                  { emoji: '🕺', name: 'DANCE',    desc: 'Pet shows off dance moves',         special: false },
                  { emoji: '🪄', name: 'MAGIC',    desc: 'Pet disappears & reappears',        special: false },
                  { emoji: '🎨', name: 'DRAWING ✨', desc: 'Draw something for pet to show', special: true  },
                ].map(t => (
                  <div
                    key={t.name}
                    style={{ border: `2px solid ${t.special ? '#FFE600' : '#2C2C2C'}`, background: t.special ? '#fffde7' : '#fff', padding: '10px 12px' }}
                  >
                    <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '8px', color: '#2C2C2C', marginBottom: '4px' }}>{t.emoji} {t.name}</div>
                    <div style={{ fontFamily: 'var(--font-retro)', fontSize: '15px', color: '#666', lineHeight: 1.4 }}>{t.desc}</div>
                  </div>
                ))}
              </div>

              {/* How-to steps */}
              <div style={{ border: '2px solid #2C2C2C', background: '#fff', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '7px', color: '#2C2C2C', letterSpacing: '1px', marginBottom: '2px' }}>HOW TO TEACH:</div>
                {[
                  { n: '1', text: 'Click a trick to start (20 sec)' },
                  { n: '2', text: 'Click again to continue (20 sec)' },
                  { n: '3', text: 'Click one more time to learn!' },
                ].map(s => (
                  <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '8px', background: '#FFE600', color: '#2C2C2C', padding: '3px 7px', flexShrink: 0 }}>{s.n}</span>
                    <span style={{ fontFamily: 'var(--font-retro)', fontSize: '16px', color: '#444' }}>{s.text}</span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <button
                onClick={() => {
                  localStorage.setItem('oodle_teach_trick_seen', '1')
                  setShowTeachIntro(false)
                  setShowTeachMenu(true)
                  setShowPlay(true)
                }}
                style={{ width: '100%', fontFamily: 'var(--font-pixel)', fontSize: '9px', padding: '14px', background: '#FFE600', color: '#2C2C2C', border: '3px solid #2C2C2C', boxShadow: '4px 4px 0 #2C2C2C', cursor: 'pointer', letterSpacing: '2px' }}
              >
                ✦ LET&apos;S GO! ✦
              </button>

              {/* Fine print */}
              <p style={{ fontFamily: 'var(--font-pixel)', fontSize: '6px', color: '#aaa', textAlign: 'center', margin: 0, lineHeight: 2 }}>
                * One new trick per day · Resets at midnight
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── ALL DONE CELEBRATION ──────────────────────── */}
      {showAllDone && !tasks.allDoneClaimed && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)' }}>
          {CONFETTI.map(c => (
            <div
              key={c.id}
              className={styles.confettiPiece}
              style={{
                left:              `${c.left}%`,
                width:             `${c.size}px`,
                height:            `${c.size}px`,
                background:        c.color,
                animationDuration: `${c.duration}s`,
                animationDelay:    `${c.delay}s`,
              }}
            />
          ))}
          <div style={{ position: 'relative', zIndex: 101, background: '#FDF6E3', border: '4px solid #FFE600', boxShadow: '8px 8px 0 #2C2C2C', maxWidth: '320px', width: '90%', padding: '32px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '13px', color: '#cc2200', letterSpacing: '2px', lineHeight: 2 }}>
              🎉 ALL TASKS DONE!
            </div>
            <div style={{ fontFamily: 'var(--font-retro)', fontSize: '20px', color: '#2C2C2C', lineHeight: 1.8 }}>
              +2 🍪 Snacks<br />+1 🍖 Meal
            </div>
            <button
              onClick={() => {
                setSmallFood((n: number) => n + 2)
                setBigFood((n: number)   => n + 1)
                const next = { ...tasks, allDoneClaimed: true }
                setTasks(next)
                localStorage.setItem('oodle_tasks', JSON.stringify(next))
                setShowAllDone(false)
                showBubble('All tasks done! +2🍪 +1🍖')
              }}
              style={{ fontFamily: 'var(--font-pixel)', fontSize: '10px', padding: '14px 28px', background: '#FFE600', color: '#2C2C2C', border: '3px solid #2C2C2C', boxShadow: '4px 4px 0 #2C2C2C', cursor: 'pointer', letterSpacing: '2px' }}
            >
              AWESOME!
            </button>
            <button
              onClick={() => setShowAllDone(false)}
              style={{ fontFamily: 'var(--font-pixel)', fontSize: '7px', color: '#888', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              REMIND ME LATER
            </button>
          </div>
        </div>
      )}

      {/* ── PET DEATH OVERLAY ─────────────────────────── */}
      {isPetDead && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', textAlign: 'center', padding: '32px' }}>
            <div style={{ fontSize: '80px', lineHeight: 1 }}>🪦</div>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '22px', color: '#e94560', letterSpacing: '4px' }}>R.I.P.</div>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '13px', color: '#eaeaea' }}>{petData.name}</div>
            <div style={{ fontFamily: 'var(--font-retro)', fontSize: '20px', color: '#888' }}>Your pet has passed away...</div>
            <button
              onClick={() => {
                killPet().catch(() => {})
                localStorage.clear()
                location.reload()
              }}
              style={{ fontFamily: 'var(--font-pixel)', fontSize: '11px', padding: '14px 28px', background: '#4ecca3', color: '#000', border: '3px solid #eaeaea', boxShadow: '4px 4px 0 #000', cursor: 'pointer', letterSpacing: '2px', marginTop: '8px' }}
            >
              🌱 Start Over
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
