import { useRef, useState, useEffect, useCallback } from 'react'
import { PetAnimator } from '../engine/PetAnimator'
import type { PetCoords } from '../api/aiRecognize'
import {
  fetchAllPets, getAllLikeCounts, likePet, getTodayLikedPetIds,
  postShout, getActiveShouts, countTodayShouts, likeShout,
  fetchAds, updateGrowth, updateLastSeen,
} from '../lib/petService'
import type { AdRecord } from '../lib/petService'
import { subscribeToNewPets } from '../lib/realtimeService'
import { useAuthStore } from '../lib/auth'
import styles from './PlazaScene.module.css'

// ── Default ads (shown when no advertisers in Supabase) ───
const DEFAULT_ADS: AdRecord[] = [
  { id: 'd1', text: 'ADVERTISE HERE',   sub_text: 'contact@oodle.game',    logo_url: null, url: 'mailto:contact@oodle.game', duration: 22 },
  { id: 'd2', text: 'YOUR BRAND HERE',  sub_text: 'oodle.game/advertise',  logo_url: null, url: 'mailto:contact@oodle.game', duration: 28 },
  { id: 'd3', text: 'REACH PET OWNERS', sub_text: 'click to advertise',    logo_url: null, url: 'mailto:contact@oodle.game', duration: 32 },
]

type DoorPhase = 'idle' | 'appearing' | 'opening' | 'walking' | 'done'

// ── Pixel heart (11×9 dot matrix) ─────────────────────────
const HEART_DOTS: [number, number][] = [
  [0,1],[0,2],[0,5],[0,6],
  [1,0],[1,1],[1,2],[1,3],[1,4],[1,5],[1,6],[1,7],
  [2,0],[2,1],[2,2],[2,3],[2,4],[2,5],[2,6],[2,7],[2,8],
  [3,0],[3,1],[3,2],[3,3],[3,4],[3,5],[3,6],[3,7],[3,8],
  [4,0],[4,1],[4,2],[4,3],[4,4],[4,5],[4,6],[4,7],[4,8],
  [5,1],[5,2],[5,3],[5,4],[5,5],[5,6],[5,7],
  [6,2],[6,3],[6,4],[6,5],[6,6],
  [7,3],[7,4],[7,5],
  [8,4],
]
const HEART_PX = 4

interface HeartAnim { id: number; x: number; y: number }

function PixelHeart({ id, x, y }: HeartAnim) {
  return (
    <div
      key={id}
      className={styles.pixelHeart}
      style={{ left: x, top: y }}
    >
      <svg
        width={9 * HEART_PX + HEART_PX}
        height={9 * HEART_PX}
        style={{ display: 'block', imageRendering: 'pixelated' }}
      >
        {HEART_DOTS.map(([r, c]) => (
          <rect
            key={`${r}-${c}`}
            x={c * HEART_PX}
            y={r * HEART_PX}
            width={HEART_PX}
            height={HEART_PX}
            fill="#e94560"
          />
        ))}
      </svg>
    </div>
  )
}

const PET_SIZE   = 120
const LEFT_BOUND = 80
const RIGHT_PAD  = 80
const WALK_Y_MIN = 0.68   // top of walkable ground area
const WALK_Y_MAX = 0.88   // bottom of walkable ground area

// No obstacle zones — pets walk freely across the plaza

const LIKE_DAILY_LIMIT  = 10
const SHOUT_DURATION_MS = 15_000

const DEFAULT_COORDS: PetCoords = {
  eyes:     [{ x: 0.35, y: 0.28 }, { x: 0.65, y: 0.28 }],
  legs:     [],
  center:   { x: 0.5, y: 0.5 },
  has_eyes: false,
  has_legs: false,
}

interface PlazaSceneProps {
  petData:    { pixelData: string; coords: PetCoords; name: string }
  onGoToRoom: () => void
  isPremium: boolean
  petSize: number
}

interface PlazaPet {
  id:             string
  pixelData:      string
  coords:         PetCoords
  name:           string
  createdAt:      string
  isOwn:          boolean
  growth_points:  number
  talent?:        string
  talent_drawing?: string
}

// Maps growth_points (0-100) to canvas size (60-160 px)
function growthToSize(gp: number): number {
  return Math.round(60 + (Math.min(100, Math.max(0, gp)) / 100) * 100)
}

interface Walker {
  x: number
  y: number
  dir: number      // horizontal: 1 = right, -1 = left
  dirY: number     // vertical:   1 = down,  -1 = up
  speed: number
  speedY: number
}

function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString() } catch { return '---' }
}

function mergePets(existing: PlazaPet[], incoming: PlazaPet[]): PlazaPet[] {
  const map = new Map<string, PlazaPet>()
  for (const p of existing) map.set(p.id, p)
  for (const p of incoming) map.set(p.id, p)
  return Array.from(map.values())
}

export default function PlazaScene({ petData, onGoToRoom, isPremium, petSize }: PlazaSceneProps) {
  const dailyShoutLimit = isPremium ? 30 : 10
  const roomRef    = useRef<HTMLDivElement>(null)

  // DOM refs — keyed by pet id
  const wrapperMap = useRef(new Map<string, HTMLDivElement>())
  const canvasMap  = useRef(new Map<string, HTMLCanvasElement>())

  // Pure JS state — never triggers React re-render
  const animMap    = useRef(new Map<string, PetAnimator>())
  const walkerMap  = useRef(new Map<string, Walker>())
  const rafRef     = useRef(0)
  const petSizeRef = useRef(petSize)

  // Queue of pets waiting to be spawned (DOM not ready yet when pets state updates)
  const spawnQueue = useRef<PlazaPet[]>([])

  const [pets, setPets]               = useState<PlazaPet[]>([])
  const [ads,  setAds]                = useState<AdRecord[]>(DEFAULT_ADS)
  const [selectedPet, setSelectedPet] = useState<PlazaPet | null>(null)
  const [likes, setLikes]             = useState<Record<string, number>>({})
  const [likeLeft, setLikeLeft]       = useState(LIKE_DAILY_LIMIT)
  const [todayLikedPets, setTodayLikedPets] = useState<Set<string>>(new Set())
  const [ownGlowing, setOwnGlowing]   = useState(true)
  const [plazaShows, setPlazaShows]   = useState<Record<string, { text: string; drawing?: string }>>({})
  const [doorPhase, setDoorPhase]     = useState<DoorPhase>('idle')
  const [showAdModal, setShowAdModal] = useState(false)
  const [adForm, setAdForm]           = useState({ company: '', email: '', bannerText: '', website: '', logoUrl: '', plan: '7days' })
  const [adSubmitting, setAdSubmitting] = useState(false)
  const [adSubmitted, setAdSubmitted]   = useState(false)

  // Keep petSizeRef in sync — used by spawnPet without causing re-spawn
  useEffect(() => { petSizeRef.current = petSize }, [petSize])
  const [hearts, setHearts]           = useState<HeartAnim[]>([])

  // ── Shout system ──────────────────────────────────────────
  const [shoutInput,   setShoutInput]   = useState('')
  const [shoutLeft,    setShoutLeft]    = useState(dailyShoutLimit)
  const [activeShouts, setActiveShouts] = useState<Record<string, { message: string; shoutId: string }>>({})
  const [likedShouts,  setLikedShouts]  = useState<Set<string>>(new Set())

  useEffect(() => {
    const t = setTimeout(() => setOwnGlowing(false), 8000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    fetchAds().then(data => {
      if (data.length > 0) setAds(data)
      else setAds(DEFAULT_ADS)
    }).catch(() => setAds(DEFAULT_ADS))
  }, [])

  // ── Shout: load today's count on mount ────────────────────
  useEffect(() => {
    countTodayShouts()
      .then(n => setShoutLeft(dailyShoutLimit - n))
      .catch(() => {})
  }, [])

  // ── Like: load today's liked pets on mount ────────────────
  useEffect(() => {
    getTodayLikedPetIds().then(ids => {
      setTodayLikedPets(ids)
      setLikeLeft(Math.max(0, LIKE_DAILY_LIMIT - ids.size))
    }).catch(() => {})
  }, [])

  // ── Clear stale localStorage on Plaza mount ────────────────
  useEffect(() => {
    localStorage.removeItem('oodle_pets')
  }, [])

  // ── Shout: poll active shouts every 5 s ───────────────────
  useEffect(() => {
    const poll = async () => {
      const shouts = await getActiveShouts().catch(() => [])
      const ownSupabaseId = localStorage.getItem('oodle_pet_supabase_id')
      const byPet: Record<string, { message: string; shoutId: string }> = {}
      for (const s of shouts) {
        const key = s.pet_id === ownSupabaseId ? 'own' : s.pet_id
        if (!byPet[key]) {
          byPet[key] = { message: s.message, shoutId: s.id }
        }
      }
      // Preserve local own shout if it hasn't synced to Supabase yet
      // (local shout ids start with 'local_', Supabase ids are UUIDs)
      setActiveShouts(prev => {
        const ownShout = prev['own']
        const serverHasOwn = !!byPet['own']
        if (ownShout && !serverHasOwn && ownShout.shoutId.startsWith('local_')) {
          // Keep local shout until server picks it up
          return { ...byPet, ['own']: ownShout }
        }
        return byPet
      })
    }
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [])

  // ── Plaza → Room door transition ──────────────────────────
  useEffect(() => {
    if (doorPhase === 'appearing') {
      const t = setTimeout(() => setDoorPhase('opening'), 50)
      return () => clearTimeout(t)
    }

    if (doorPhase === 'opening') {
      const t = setTimeout(() => setDoorPhase('walking'), 600)
      return () => clearTimeout(t)
    }

    if (doorPhase === 'walking') {
      const wrapper = wrapperMap.current.get('own')
      const canvas  = canvasMap.current.get('own')
      const room    = roomRef.current
      if (!wrapper || !room) { setDoorPhase('done'); return }

      // *** Stop walk loop from fighting us ***
      walkerMap.current.delete('own')

      // Stop pet just in front of the door (right edge of door + small gap)
      const doorRightEdge = room.offsetWidth * 0.08 + 140
      const targetX = doorRightEdge

      // Face left toward door
      if (canvas) canvas.style.transform = 'scaleX(-1)'

      let rafId = 0
      const walk = () => {
        const current = parseFloat(wrapper.style.left) || 0
        const dx = targetX - current
        if (Math.abs(dx) < 3) {
          wrapper.style.opacity = '0'
          setTimeout(() => setDoorPhase('done'), 400)
          return
        }
        wrapper.style.left = `${current + Math.sign(dx) * 3}px`
        rafId = requestAnimationFrame(walk)
      }
      rafId = requestAnimationFrame(walk)
      return () => cancelAnimationFrame(rafId)
    }

    if (doorPhase === 'done') {
      onGoToRoom()
    }
  }, [doorPhase, onGoToRoom])

  // ── Spawn a pet into the walk system ──────────────────────
  const spawnPet = useCallback((pet: PlazaPet) => {
    const alreadySpawned = animMap.current.has(pet.id)

    if (alreadySpawned) {
      if (!pet.isOwn) return  // others: skip

      // Own pet: only re-spawn animator if size changed, keep position
      const canvas = canvasMap.current.get(pet.id)
      const newSize = petSizeRef.current
      if (canvas && canvas.width === newSize) return  // size unchanged, skip

      // Stop old animator, rebuild with new size, keep walker position intact
      animMap.current.get(pet.id)?.stop()
      animMap.current.delete(pet.id)
      if (canvas) {
        canvas.width  = newSize
        canvas.height = newSize
        const eyeStyle = localStorage.getItem('oodle_eye_style') ?? 'eye_round'
        const animator = new PetAnimator(canvas, {
          imageDataURL: pet.pixelData,
          coords:       pet.coords,
          size:         newSize,
          eyeStyle,
        })
        animator.setState('walk')
        animator.start()
        animMap.current.set(pet.id, animator)
        const wrapper = wrapperMap.current.get(pet.id)
        if (wrapper) {
          wrapper.style.width  = `${newSize}px`
          wrapper.style.height = `${newSize + 20}px`
        }
      }
      return
    }

    const canvas  = canvasMap.current.get(pet.id)
    const wrapper = wrapperMap.current.get(pet.id)
    if (!canvas || !wrapper) {
      // DOM not ready yet — queue for later
      spawnQueue.current.push(pet)
      return
    }

    const room = roomRef.current!
    const rW   = room.offsetWidth
    const rH   = room.offsetHeight
    if (rW === 0 || rH === 0) {
      spawnQueue.current.push(pet)
      return
    }

    const size = pet.isOwn ? petSizeRef.current : growthToSize(pet.growth_points)
    canvas.width  = size
    canvas.height = size
    wrapper.style.width  = `${size}px`
    wrapper.style.height = `${size + 20}px`

    const eyeStyle  = localStorage.getItem('oodle_eye_style') ?? 'eye_round'
    const animator  = new PetAnimator(canvas, {
      imageDataURL: pet.pixelData,
      coords:       pet.coords,
      size,
      eyeStyle,
    })
    animator.setState('walk')
    animator.start()
    animMap.current.set(pet.id, animator)

    const rightBound = rW - RIGHT_PAD - size
    const yRatio     = WALK_Y_MIN + Math.random() * (WALK_Y_MAX - WALK_Y_MIN)
    const y          = yRatio * rH - size
    const x          = LEFT_BOUND + Math.random() * (rightBound - LEFT_BOUND)
    const dir        = Math.random() < 0.5 ? 1 : -1
    const dirY       = Math.random() < 0.5 ? 1 : -1
    const speed      = 0.4 + Math.random() * 0.7
    const speedY     = 0.1 + Math.random() * 0.2   // slower vertical movement

    const w: Walker = { x, y, dir, dirY, speed, speedY }
    walkerMap.current.set(pet.id, w)
    wrapper.style.left          = `${x}px`
    wrapper.style.top           = `${y}px`
    canvas.style.transform      = dir === -1 ? 'scaleX(-1)' : 'none'
    canvas.style.imageRendering = 'pixelated'
  }, [petSize])

  // ── Walk loop — starts once on mount, never stops ─────────
  useEffect(() => {
    const room = roomRef.current!

    const tick = () => {
      const rW         = room.offsetWidth
      const rH         = room.offsetHeight

      // Drain spawn queue — try pets that were queued before DOM was ready
      if (spawnQueue.current.length > 0) {
        const remaining: PlazaPet[] = []
        for (const pet of spawnQueue.current) {
          const canvas  = canvasMap.current.get(pet.id)
          const wrapper = wrapperMap.current.get(pet.id)
          if (canvas && wrapper && rW > 0) {
            spawnPet(pet)
          } else {
            remaining.push(pet)
          }
        }
        spawnQueue.current = remaining
      }

      // Move all walkers
      walkerMap.current.forEach((w, id) => {
        const wr = wrapperMap.current.get(id)
        const cv = canvasMap.current.get(id)
        if (!wr || !cv) return

        // Use actual canvas size for own pet bounds
        const sz         = cv.width > 0 ? cv.width : (id === 'own' ? petSizeRef.current : PET_SIZE)
        const ownRight   = rW - RIGHT_PAD - sz
        const ownTop     = WALK_Y_MIN * rH - sz
        const ownBottom  = WALK_Y_MAX * rH - sz

        // X movement
        const nextX = w.x + w.speed * w.dir
        if (nextX >= ownRight)   { w.dir = -1 }
        else if (nextX <= LEFT_BOUND) { w.dir = 1 }
        else { w.x = nextX }

        // Y movement
        const nextY = w.y + w.speedY * w.dirY
        if (nextY >= ownBottom) { w.dirY = -1 }
        else if (nextY <= ownTop) { w.dirY = 1 }
        else { w.y = nextY }

        wr.style.left      = `${w.x}px`
        wr.style.top       = `${w.y}px`
        cv.style.transform = w.dir === -1 ? 'scaleX(-1)' : 'none'
      })

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      animMap.current.forEach(a => a.stop())
      animMap.current.clear()
      walkerMap.current.clear()
      spawnQueue.current = []
    }
  }, [spawnPet])  // spawnPet is stable (useCallback with no deps)

  // ── When pets list changes, spawn new ones ────────────────
  useEffect(() => {
    for (const pet of pets) {
      spawnPet(pet)
    }
  }, [pets, spawnPet])

  // ── Load pets ─────────────────────────────────────────────
  useEffect(() => {
    const ownPet: PlazaPet = {
      id:            'own',
      pixelData:     petData.pixelData,
      coords:        petData.coords,
      name:          petData.name,
      createdAt:     new Date().toISOString(),
      isOwn:         true,
      growth_points: parseInt(localStorage.getItem('oodle_growth') ?? '0', 10),
    }
    setPets([ownPet])

    const loadFromSupabase = async () => {
      const [records, likeCounts] = await Promise.all([
        fetchAllPets(),
        getAllLikeCounts(),
      ])
      const ownSupabaseId = localStorage.getItem('oodle_pet_supabase_id')
      const ownUserId = useAuthStore.getState().userId
      const others: PlazaPet[] = records
        .filter(r =>
          r.id !== ownSupabaseId &&
          r.user_id !== ownUserId &&
          r.pixel_data !== petData.pixelData
        )
        .map(r => ({
          id:             r.id,
          pixelData:      r.pixel_data,
          coords:         r.coords ?? DEFAULT_COORDS,
          name:           r.name,
          createdAt:      r.created_at,
          isOwn:          false,
          growth_points:  r.growth_points  ?? 0,
          talent:         r.talent,
          talent_drawing: r.talent_drawing,
        }))
      setPets(prev => mergePets(prev, [ownPet, ...others]))
      setLikes(likeCounts)
    }

    loadFromSupabase()
    updateGrowth().catch(() => {})
  }, [petData])

  // ── Last-seen heartbeat — keep pet visible in Plaza ───────
  useEffect(() => {
    updateLastSeen().catch(() => {})
    const interval = setInterval(() => updateLastSeen().catch(() => {}), 3 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  // ── Auto-performance of other pets' tricks (every 45 s) ──
  useEffect(() => {
    const interval = setInterval(() => {
      const performers = pets.filter(p => !p.isOwn && (p.talent || p.talent_drawing))
      if (performers.length === 0) return
      const pet = performers[Math.floor(Math.random() * performers.length)]

      let text = ''
      let drawing: string | undefined
      if (pet.talent === 'sing')  text = '🎵 La la la~'
      else if (pet.talent === 'dance') text = '💃 Watch me!'
      else if (pet.talent === 'magic') text = '✨ Ta-da!'
      else if (pet.talent === 'drawing' && pet.talent_drawing) {
        text    = '🎨 I made this!'
        drawing = pet.talent_drawing
      } else if (pet.talent_drawing) {
        text    = '🎨 I made this!'
        drawing = pet.talent_drawing
      }
      if (!text) return

      setPlazaShows(prev => ({ ...prev, [pet.id]: { text, drawing } }))
      setTimeout(() => setPlazaShows(prev => {
        const next = { ...prev }
        delete next[pet.id]
        return next
      }), 4000)
    }, 45000)
    return () => clearInterval(interval)
  }, [pets])

  // ── Poll for new pets every 15 s ──────────────────────────
  useEffect(() => {
    const poll = setInterval(async () => {
      const records = await fetchAllPets()
      const ownSupabaseId = localStorage.getItem('oodle_pet_supabase_id')
      const ownUserId = useAuthStore.getState().userId
      setPets(prev => {
        const newOthers = records
          .filter(r => r.id !== ownSupabaseId && r.user_id !== ownUserId)
          .map(r => ({
            id:             r.id,
            pixelData:      r.pixel_data,
            coords:         r.coords ?? DEFAULT_COORDS,
            name:           r.name,
            createdAt:      r.created_at,
            isOwn:          false,
            growth_points:  r.growth_points  ?? 0,
            talent:         r.talent,
            talent_drawing: r.talent_drawing,
          }))
        const ownPet = prev.find(p => p.isOwn)
        return ownPet ? [ownPet, ...newOthers] : newOthers
      })
    }, 15000)
    return () => clearInterval(poll)
  }, [])

  // ── Realtime ──────────────────────────────────────────────
  useEffect(() => {
    const ownSupabaseId = localStorage.getItem('oodle_pet_supabase_id')
    const ownUserId = useAuthStore.getState().userId
    const unsubscribe = subscribeToNewPets(newPet => {
      if (newPet.id === ownSupabaseId) return
      if (newPet.user_id === ownUserId) return
      if (newPet.pixel_data === petData.pixelData) return
      setPets(prev => {
        if (prev.some(p => p.id === newPet.id)) return prev
        return [...prev, {
          id:             newPet.id,
          pixelData:      newPet.pixel_data,
          coords:         newPet.coords ?? DEFAULT_COORDS,
          name:           newPet.name,
          createdAt:      newPet.created_at,
          isOwn:          false,
          growth_points:  newPet.growth_points  ?? 0,
          talent:         newPet.talent,
          talent_drawing: newPet.talent_drawing,
        }]
      })
    })
    return unsubscribe
  }, [petData.pixelData])

  // ── Like ──────────────────────────────────────────────────
  const handleLike = useCallback((petId: string) => {
    // Already liked this pet today
    if (todayLikedPets.has(petId)) return
    // Daily like quota exhausted
    if (likeLeft <= 0) return

    // Optimistic UI update
    setLikes(prev => {
      const updated = { ...prev, [petId]: (prev[petId] ?? 0) + 1 }
      localStorage.setItem('oodle_likes', JSON.stringify(updated))
      return updated
    })
    setTodayLikedPets(prev => new Set(prev).add(petId))
    setLikeLeft(n => n - 1)

    likePet(petId).catch(() => {})

    // Track daily plaza likes for the Daily Tasks system
    const todayKey  = new Date().toDateString()
    const likeData  = JSON.parse(localStorage.getItem('oodle_daily_plaza_likes') ?? '{"date":"","count":0}') as { date: string; count: number }
    if (likeData.date === todayKey) {
      likeData.count += 1
    } else {
      likeData.date  = todayKey
      likeData.count = 1
    }
    localStorage.setItem('oodle_daily_plaza_likes', JSON.stringify(likeData))

    // Spawn pixel heart
    const canvas = canvasMap.current.get(petId)
    if (canvas) {
      const rect = canvas.getBoundingClientRect()
      const heart: HeartAnim = {
        id: Date.now(),
        x:  rect.left + rect.width  / 2,
        y:  rect.top,
      }
      setHearts(prev => [...prev, heart])
      setTimeout(() => setHearts(prev => prev.filter(h => h.id !== heart.id)), 1400)
    }
  }, [todayLikedPets, likeLeft])

  // ── Shout handlers ────────────────────────────────────────
  const handleShout = useCallback(async () => {
    const message = shoutInput.trim()
    if (!message || shoutLeft <= 0) return

    setShoutInput('')
    setShoutLeft(n => n - 1)

    // Show bubble locally immediately regardless of Supabase
    const localShoutId = `local_${Date.now()}`
    setActiveShouts(prev => ({ ...prev, ['own']: { message, shoutId: localShoutId } }))

    // Auto-remove after SHOUT_DURATION_MS
    setTimeout(() => {
      setActiveShouts(prev => {
        const current = prev['own']
        if (!current || current.shoutId !== localShoutId) return prev
        const next = { ...prev }
        delete next['own']
        return next
      })
    }, SHOUT_DURATION_MS)

    // Try to persist to Supabase (best-effort)
    const supabaseId = localStorage.getItem('oodle_pet_supabase_id')
    if (supabaseId) {
      const shoutId = await postShout(supabaseId, message).catch(() => null)
      // Update shoutId to the real one so other users' polls pick it up
      if (shoutId) {
        setActiveShouts(prev => {
          const current = prev['own']
          if (!current) return prev
          return { ...prev, ['own']: { message, shoutId } }
        })
      }
    }
  }, [shoutInput, shoutLeft])

  const handleLikeShout = useCallback((shoutId: string) => {
    if (likedShouts.has(shoutId)) return
    setLikedShouts(prev => new Set([...prev, shoutId]))
    likeShout(shoutId).catch(() => {})

    // Track daily plaza likes for the Daily Tasks system
    const todayKey  = new Date().toDateString()
    const likeData  = JSON.parse(localStorage.getItem('oodle_daily_plaza_likes') ?? '{"date":"","count":0}') as { date: string; count: number }
    if (likeData.date === todayKey) {
      likeData.count += 1
    } else {
      likeData.date  = todayKey
      likeData.count = 1
    }
    localStorage.setItem('oodle_daily_plaza_likes', JSON.stringify(likeData))
  }, [likedShouts])

  return (
    <div className={styles.page}>
      <div className={styles.room} ref={roomRef}>
        <div className={styles.petCount}>🐾 {pets.length} PETS HERE</div>

        {/* ── Airplane ads ── */}
        <div className={styles.skyLayer}>
          {ads.map((ad, i) => {
            const directions = ['ltr', 'rtl', 'ltr'] as const
            const tops       = ['12%', '28%', '42%']
            const delays     = [0, 8, 16]
            const dir        = directions[i % directions.length]
            const top        = tops[i % tops.length]
            const delay      = delays[i % delays.length]
            return (
              <div
                key={ad.id}
                className={`${styles.airplane} ${dir === 'ltr' ? styles.flyLTR : styles.flyRTL}`}
                style={{ top, animationDuration: `${ad.duration}s`, animationDelay: `${delay}s` }}
                onClick={() => window.open(ad.url, '_blank', 'noopener')}
              >
                <>
                  <svg width="120" height="75" viewBox="0 0 80 50" xmlns="http://www.w3.org/2000/svg" style={{ imageRendering: 'pixelated', display: 'block', flexShrink: 0, transform: 'scaleX(-1)' }}>
                    {/* Body */}
                    <rect x="10" y="18" width="50" height="14" fill="#cc2200"/>
                    {/* Nose */}
                    <rect x="60" y="20" width="12" height="10" fill="#cc2200"/>
                    <rect x="70" y="22" width="8" height="6" fill="#aa1100"/>
                    {/* Top wing */}
                    <rect x="20" y="6" width="36" height="8" fill="#cc2200"/>
                    <rect x="20" y="6" width="36" height="2" fill="#ff4422"/>
                    {/* Bottom wing */}
                    <rect x="24" y="32" width="28" height="6" fill="#cc2200"/>
                    {/* Tail */}
                    <rect x="8" y="12" width="10" height="8" fill="#cc2200"/>
                    <rect x="6" y="32" width="10" height="6" fill="#cc2200"/>
                    {/* Cockpit */}
                    <rect x="36" y="14" width="14" height="10" fill="#88ccff"/>
                    <rect x="37" y="15" width="12" height="8" fill="#aaddff"/>
                    {/* Propeller */}
                    <rect x="76" y="14" width="4" height="22" fill="#554433"/>
                    <rect x="74" y="22" width="8" height="6" fill="#776655"/>
                    {/* Outlines */}
                    <rect x="10" y="18" width="50" height="14" fill="none" stroke="#2C2C2C" strokeWidth="1"/>
                    <rect x="20" y="6" width="36" height="8" fill="none" stroke="#2C2C2C" strokeWidth="1"/>
                    <rect x="24" y="32" width="28" height="6" fill="none" stroke="#2C2C2C" strokeWidth="1"/>
                    {/* Wing struts */}
                    <rect x="28" y="14" width="2" height="18" fill="#2C2C2C"/>
                    <rect x="42" y="14" width="2" height="18" fill="#2C2C2C"/>
                  </svg>
                  <div className={styles.adRope} />
                  <div
                    className={styles.adBanner}
                    onClick={['ADVERTISE HERE', 'YOUR BRAND HERE', 'REACH PET OWNERS'].includes(ad.text) ? (e) => { e.stopPropagation(); setShowAdModal(true) } : undefined}
                    style={['ADVERTISE HERE', 'YOUR BRAND HERE', 'REACH PET OWNERS'].includes(ad.text) ? { cursor: 'pointer' } : undefined}
                  >
                    {ad.logo_url && <img src={ad.logo_url} className={styles.adLogo} alt="" />}
                    <div>
                      <div className={styles.adText}>{ad.text}</div>
                      {ad.sub_text && <div className={styles.adTextSmall}>{ad.sub_text}</div>}
                    </div>
                  </div>
                </>
              </div>
            )
          })}
        </div>

        {/* Door overlay — appears during transition back to room */}
        {doorPhase !== 'idle' && (
          <div className={styles.doorContainer}>
            <div className={`${styles.doorFrame} ${styles.doorFrameVisible}`}>
              <div className={`${styles.doorLeft}  ${doorPhase === 'opening' || doorPhase === 'walking' || doorPhase === 'done' ? styles.doorLeftOpen  : ''}`} />
              <div className={`${styles.doorRight} ${doorPhase === 'opening' || doorPhase === 'walking' || doorPhase === 'done' ? styles.doorRightOpen : ''}`} />
              <div className={styles.doorTop}>← MY ROOM</div>
            </div>
          </div>
        )}

        {pets.map(pet => {
          const shout = activeShouts[pet.id]
          return (
            <div
              key={pet.id}
              className={[
                styles.petSlot,
                pet.isOwn ? styles.ownPet : '',
                pet.isOwn && ownGlowing ? styles.ownPetGlow : '',
              ].join(' ')}
              ref={el => {
                if (el) {
                  wrapperMap.current.set(pet.id, el)
                  spawnPet(pet)
                } else {
                  wrapperMap.current.delete(pet.id)
                }
              }}
              onClick={() => setSelectedPet(pet)}
            >
              {/* Speech bubble */}
              {shout && (
                <div className={styles.speechBubble}>
                  {shout.message}
                  {!pet.isOwn && (
                    <button
                      className={styles.bubbleLikeBtn}
                      disabled={likedShouts.has(shout.shoutId)}
                      onClick={e => { e.stopPropagation(); handleLikeShout(shout.shoutId) }}
                    >
                      {likedShouts.has(shout.shoutId) ? '❤️ LIKED' : '❤️ LIKE'}
                    </button>
                  )}
                </div>
              )}

              {/* Performance bubble (talent show) */}
              {(() => {
                const show = plazaShows[pet.id]
                if (!show) return null
                return (
                  <div className={styles.speechBubble} style={{ zIndex: 9 }}>
                    {show.text}
                    {show.drawing && (
                      <img
                        src={show.drawing}
                        style={{ width: 48, height: 48, imageRendering: 'pixelated', display: 'block', margin: '4px auto 0' }}
                        alt="drawing"
                      />
                    )}
                  </div>
                )
              })()}

              <canvas
                ref={el => {
                  if (el) {
                    canvasMap.current.set(pet.id, el)
                    spawnPet(pet)
                  } else {
                    canvasMap.current.delete(pet.id)
                  }
                }}
                width={pet.isOwn ? petSize : growthToSize(pet.growth_points)}
                height={pet.isOwn ? petSize : growthToSize(pet.growth_points)}
                className={styles.petCanvas}
              />
            </div>
          )
        })}

        {selectedPet && (
          <>
            <div className={styles.overlay} onClick={() => setSelectedPet(null)} />
            <div className={styles.card}>
              <button className={styles.closeBtn} onClick={() => setSelectedPet(null)}>✕</button>
              <div className={styles.cardName}>{selectedPet.name}</div>
              <div className={styles.cardRow}>Artist: {selectedPet.name}</div>
              <div className={styles.cardRow}>Joined: {formatDate(selectedPet.createdAt)}</div>
              <div className={styles.cardRow}>❤️ {likes[selectedPet.id] ?? 0} likes</div>
              {!selectedPet.isOwn && (
                <>
                  <button
                    className={styles.likeBtn}
                    onClick={() => handleLike(selectedPet.id)}
                    disabled={todayLikedPets.has(selectedPet.id) || likeLeft <= 0}
                  >
                    {todayLikedPets.has(selectedPet.id) ? '✓ LIKED' : '❤️ LIKE'}
                  </button>
                  <div className={styles.likeQuota}>
                    {likeLeft > 0
                      ? `${likeLeft}/${LIKE_DAILY_LIMIT} likes left today`
                      : 'Come back tomorrow!'}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Pixel hearts */}
      {hearts.map(h => <PixelHeart key={h.id} id={h.id} x={h.x} y={h.y} />)}

      {/* ── Advertise modal ──────────────────────────────── */}
      {showAdModal && (
        <div
          onClick={() => { setShowAdModal(false); setAdSubmitted(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#FDF6E3', border: '3px solid #2C2C2C', boxShadow: '6px 6px 0 #2C2C2C', padding: '28px', maxWidth: '420px', width: '100%', position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}
          >
            {/* Close button */}
            <button
              onClick={() => { setShowAdModal(false); setAdSubmitted(false) }}
              style={{ position: 'absolute', top: '12px', right: '12px', fontFamily: 'var(--font-pixel)', fontSize: '14px', background: '#fff', border: '2px solid #2C2C2C', boxShadow: '2px 2px 0 #2C2C2C', width: '28px', height: '28px', cursor: 'pointer', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            >✕</button>

            {/* Title */}
            <div style={{ background: '#2C2C2C', color: '#FFE600', fontFamily: 'var(--font-pixel)', fontSize: '11px', textAlign: 'center', padding: '12px', letterSpacing: '2px', marginBottom: '16px' }}>
              ✦ ADVERTISE HERE ✦
            </div>

            {/* Description */}
            <p style={{ fontFamily: 'var(--font-retro)', fontSize: '15px', color: '#555', borderLeft: '3px solid #FFE600', paddingLeft: '10px', marginBottom: '20px', lineHeight: 1.6 }}>
              Promote your brand to Oodle players! Your banner ad flies across the plaza sky — seen by every player who visits.
            </p>

            {adSubmitted ? (
              <div style={{ textAlign: 'center', fontFamily: 'var(--font-pixel)', fontSize: '9px', color: '#4CAF50', padding: '20px', border: '2px solid #4CAF50', lineHeight: 2 }}>
                ✅ Submitted!<br />We will contact you within 24 hours.
              </div>
            ) : (
              <>
                {/* Form fields */}
                {(
                  [
                    { label: 'COMPANY NAME *',  key: 'company',    type: 'text',  hint: '' },
                    { label: 'EMAIL *',         key: 'email',      type: 'email', hint: '' },
                    { label: 'BANNER TEXT *',   key: 'bannerText', type: 'text',  hint: 'MAX 20 CHARS', maxLength: 20 },
                    { label: 'WEBSITE URL *',   key: 'website',    type: 'text',  hint: '' },
                    { label: 'LOGO URL',        key: 'logoUrl',    type: 'text',  hint: 'OPTIONAL' },
                  ] as { label: string; key: keyof typeof adForm; type: string; hint: string; maxLength?: number }[]
                ).map(f => (
                  <div key={f.key} style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                      <label style={{ fontFamily: 'var(--font-pixel)', fontSize: '9px', color: '#2C2C2C', letterSpacing: '1px' }}>{f.label}</label>
                      {f.hint && <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '7px', color: '#888' }}>{f.hint}</span>}
                    </div>
                    <input
                      type={f.type}
                      maxLength={f.maxLength}
                      value={adForm[f.key]}
                      onChange={e => setAdForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      style={{ width: '100%', fontFamily: 'var(--font-retro)', fontSize: '15px', padding: '10px 12px', border: '2px solid #2C2C2C', boxShadow: '2px 2px 0 #2C2C2C', outline: 'none', background: '#fff', boxSizing: 'border-box' }}
                    />
                  </div>
                ))}

                {/* Plan selection */}
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '7px', color: '#2C2C2C', letterSpacing: '1px', marginBottom: '8px' }}>SELECT PLAN</div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {([
                      { value: '7days',  label: '7 DAYS',  price: 'RM 39' },
                      { value: '14days', label: '14 DAYS', price: 'RM 69' },
                      { value: '1month', label: '1 MONTH', price: 'RM 129' },
                    ] as { value: string; label: string; price: string }[]).map(p => (
                      <button
                        key={p.value}
                        onClick={() => setAdForm(prev => ({ ...prev, plan: p.value }))}
                        style={{ flex: 1, padding: '10px 4px', border: '2px solid #2C2C2C', boxShadow: adForm.plan === p.value ? '2px 2px 0 #2C2C2C' : '2px 2px 0 #2C2C2C', background: adForm.plan === p.value ? '#FFE600' : '#fff', cursor: 'pointer', fontFamily: 'var(--font-pixel)', fontSize: '7px', lineHeight: 2, transform: adForm.plan === p.value ? 'translate(2px,2px)' : 'none', outline: adForm.plan === p.value ? '2px solid #2C2C2C' : 'none', outlineOffset: '2px' }}
                      >
                        {p.label}<br />{p.price}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Submit */}
                <button
                  disabled={adSubmitting || !adForm.company || !adForm.email || !adForm.bannerText || !adForm.website}
                  onClick={async () => {
                    setAdSubmitting(true)
                    try {
                      await fetch('https://api.web3forms.com/submit', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          access_key: 'YOUR_WEB3FORMS_KEY',
                          subject: `[Oodle Ad] ${adForm.company} — ${adForm.plan}`,
                          company: adForm.company,
                          email: adForm.email,
                          banner_text: adForm.bannerText,
                          website: adForm.website,
                          logo_url: adForm.logoUrl,
                          plan: adForm.plan,
                        }),
                      })
                      setAdSubmitted(true)
                    } catch {
                      // fail silently, still show success to avoid friction
                      setAdSubmitted(true)
                    } finally {
                      setAdSubmitting(false)
                    }
                  }}
                  style={{ width: '100%', fontFamily: 'var(--font-pixel)', fontSize: '10px', padding: '16px', background: adSubmitting ? '#ccc' : '#FFE600', color: '#2C2C2C', border: '3px solid #2C2C2C', boxShadow: '5px 5px 0 #2C2C2C', cursor: adSubmitting ? 'not-allowed' : 'pointer', letterSpacing: '2px', marginBottom: '12px' }}
                >
                  {adSubmitting ? 'SENDING...' : 'SUBMIT ENQUIRY'}
                </button>

                {/* Footer */}
                <p style={{ fontFamily: 'var(--font-retro)', fontSize: '13px', color: '#555', textAlign: 'center', lineHeight: 1.8, margin: 0 }}>
                  We will contact you within 24 hours to arrange payment.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Bottom action bar */}
      <div className={styles.actionBar}>
        <button
          className={`${styles.actionBtn} ${styles.roomBtn}`}
          onClick={() => { if (doorPhase === 'idle') setDoorPhase('appearing') }}
          disabled={doorPhase !== 'idle'}
        >
          {doorPhase === 'idle' ? '← MY ROOM' : 'GOING...'}
        </button>

        <div className={styles.shoutBox}>
          <input
            className={styles.shoutInput}
            value={shoutInput}
            maxLength={30}
            placeholder="Let your pet speak..."
            onChange={e => setShoutInput(e.target.value.slice(0, 30))}
            onKeyDown={e => { if (e.key === 'Enter') handleShout() }}
          />
          <button
            className={styles.actionBtn}
            onClick={handleShout}
            disabled={shoutLeft <= 0 || shoutInput.trim() === ''}
          >
            SHOUT
          </button>
          <span className={styles.shoutCount}>
            SHOUT {dailyShoutLimit - shoutLeft}/{dailyShoutLimit}
          </span>
        </div>
      </div>
    </div>
  )
}
