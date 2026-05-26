import { useRef, useState, useEffect, useCallback } from 'react'
import { PetAnimator } from '../engine/PetAnimator'
import type { PetCoords } from '../api/aiRecognize'
import {
  fetchAllPets, getAllLikeCounts, likePet, getTodayLikedPetIds,
  postShout, getActiveShouts, countTodayShouts, likeShout, unlikePet,
  fetchAds, updateGrowth, updateLastSeen,
} from '../lib/petService'
import type { AdRecord } from '../lib/petService'
import { subscribeToNewPets } from '../lib/realtimeService'
import { useAuthStore } from '../lib/auth'
import { supabase } from '../lib/supabase'
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
  const [drawingPerformance, setDrawingPerformance] = useState<{
    petId: string, petX: number, petY: number, dataURL: string
  } | null>(null)

  // Keep petSizeRef in sync — used by spawnPet without causing re-spawn
  useEffect(() => { petSizeRef.current = petSize }, [petSize])
  const [hearts, setHearts]           = useState<HeartAnim[]>([])

  // ── Shout system ──────────────────────────────────────────
  const [shoutInput,   setShoutInput]   = useState('')
  const [shoutLeft,    setShoutLeft]    = useState(dailyShoutLimit)
  const [activeShouts, setActiveShouts] = useState<Record<string, { message: string; shoutId: string }>>({})
  const [likedShouts,  setLikedShouts]  = useState<Set<string>>(new Set())
  const [unlikedPets,  setUnlikedPets]  = useState<Set<string>>(new Set())
  const [isNight]                       = useState(() => { const h = new Date().getHours(); return h >= 22 || h < 6 })
  const [weather, setWeather]           = useState<'clear' | 'rain' | 'thunder'>('clear')

  useEffect(() => {
    document.documentElement.style.backgroundImage = "url('/plaza-bg.svg')"
    document.documentElement.style.backgroundSize = '100vw 100vh'
    document.documentElement.style.backgroundRepeat = 'no-repeat'
    return () => {
      document.documentElement.style.backgroundImage = ''
      document.documentElement.style.backgroundSize = ''
      document.documentElement.style.backgroundRepeat = ''
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setOwnGlowing(false), 8000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const pick = () => {
      const r = Math.random()
      if (r < 0.60) setWeather('clear')
      else if (r < 0.85) setWeather('rain')
      else setWeather('thunder')
    }
    const id = setInterval(pick, 20 * 60 * 1000)
    return () => clearInterval(id)
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
    const talentRaw = localStorage.getItem('oodle_daily_talent')
    let ownTalent: string | undefined
    let ownTalentDrawing: string | undefined
    try {
      if (talentRaw) {
        const t = JSON.parse(talentRaw) as { date: string; talent: string; drawing?: string }
        if (t.date === new Date().toDateString()) {
          ownTalent = t.talent
          ownTalentDrawing = t.drawing
        }
      }
    } catch { /* ignore */ }

    const ownPet: PlazaPet = {
      id:            'own',
      pixelData:     petData.pixelData,
      coords:        petData.coords,
      name:          petData.name,
      createdAt:     new Date().toISOString(),
      isOwn:         true,
      growth_points: parseInt(localStorage.getItem('oodle_growth') ?? '0', 10),
      talent:        ownTalent,
      talent_drawing: ownTalentDrawing,
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
    const interval = setInterval(() => updateLastSeen().catch(() => {}), 60 * 1000)
    return () => {
      clearInterval(interval)
      // Mark as offline immediately when leaving Plaza
      const petId = localStorage.getItem('oodle_pet_supabase_id')
      if (petId) {
        supabase.from('pets').update({ last_seen: new Date(0).toISOString() }).eq('id', petId)
      }
    }
  }, [])

  // ── Auto-performance of other pets' tricks (every 45 s) ──
  const petsRef = useRef<PlazaPet[]>([])
  useEffect(() => { petsRef.current = pets }, [pets])

  useEffect(() => {
    const interval = setInterval(() => {
      const performers = petsRef.current.filter(p => p.talent || p.talent_drawing)
      if (performers.length === 0) return
      const pet = performers[Math.floor(Math.random() * performers.length)]

      let text = ''
      let drawing: string | undefined
      if (pet.talent === 'sing')  text = '🎵 La la la~'
      else if (pet.talent === 'dance') {
        text = '💃 Watch me!'
        const anim = animMap.current.get(pet.id)
        if (anim) anim.setState('dance')
      }
      else if (pet.talent === 'magic') text = '✨ Ta-da!'
      else if (pet.talent === 'drawing' && pet.talent_drawing) {
        const walker = walkerMap.current.get(pet.id)
        const petX = walker ? walker.x : window.innerWidth / 2
        const petY = walker ? walker.y : window.innerHeight / 2
        setDrawingPerformance({ petId: pet.id, petX, petY, dataURL: pet.talent_drawing })
        setPlazaShows(prev => ({ ...prev, [pet.id]: { text: '🎨 Watch me draw!', drawing: pet.talent_drawing } }))
        const anim = animMap.current.get(pet.id)
        if (anim) anim.setState('draw')
        setTimeout(() => {
          setDrawingPerformance(null)
          setPlazaShows(prev => { const next = { ...prev }; delete next[pet.id]; return next })
        }, 5000)
        return
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
  }, [])

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
      <div className={styles.room} ref={roomRef} style={{ position: 'relative', zIndex: 1 }}>
        <svg
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
          preserveAspectRatio="none"
          viewBox="0 0 1920 1080"
          xmlns="http://www.w3.org/2000/svg"
          shapeRendering="crispEdges"
        >
          {/* Sky */}
          <rect id="plaza-sky" width="1920" height="560" fill="#87CEEB"/>
          <rect id="plaza-sky-gradient" y="0" width="1920" height="200" fill="#A8E0F0" opacity="0.5"/>

          {/* Far buildings left */}
          <rect x="0" y="200" width="160" height="440" fill="#8B9DC3" opacity="0.5"/>
          <rect x="20" y="150" width="120" height="70" fill="#8B9DC3" opacity="0.5"/>
          <g id="plaza-bld-win-left" opacity={isNight ? 1 : 0.3}>
            <rect x="30" y="220" width="20" height="20" fill="#FFE87C"/>
            <rect x="64" y="220" width="20" height="20" fill="#C8E6FF"/>
            <rect x="98" y="220" width="20" height="20" fill="#FFE87C"/>
            <rect x="30" y="258" width="20" height="20" fill="#C8E6FF"/>
            <rect x="64" y="258" width="20" height="20" fill="#FFE87C"/>
            <rect x="98" y="258" width="20" height="20" fill="#C8E6FF"/>
            <rect x="30" y="296" width="20" height="20" fill="#FFE87C"/>
            <rect x="64" y="296" width="20" height="20" fill="#C8E6FF"/>
            <rect x="98" y="296" width="20" height="20" fill="#FFE87C"/>
            <rect x="30" y="334" width="20" height="20" fill="#C8E6FF"/>
            <rect x="64" y="334" width="20" height="20" fill="#FFE87C"/>
            <rect x="98" y="334" width="20" height="20" fill="#C8E6FF"/>
          </g>

          {/* Far buildings right */}
          <rect x="1760" y="180" width="160" height="460" fill="#8B9DC3" opacity="0.5"/>
          <rect x="1780" y="130" width="120" height="60" fill="#7A8DB8" opacity="0.5"/>
          <g id="plaza-bld-win-right" opacity={isNight ? 1 : 0.3}>
            <rect x="1772" y="200" width="20" height="20" fill="#FFE87C"/>
            <rect x="1806" y="200" width="20" height="20" fill="#C8E6FF"/>
            <rect x="1840" y="200" width="20" height="20" fill="#FFE87C"/>
            <rect x="1874" y="200" width="20" height="20" fill="#C8E6FF"/>
            <rect x="1772" y="238" width="20" height="20" fill="#C8E6FF"/>
            <rect x="1806" y="238" width="20" height="20" fill="#FFE87C"/>
            <rect x="1840" y="238" width="20" height="20" fill="#C8E6FF"/>
            <rect x="1874" y="238" width="20" height="20" fill="#FFE87C"/>
            <rect x="1772" y="276" width="20" height="20" fill="#FFE87C"/>
            <rect x="1806" y="276" width="20" height="20" fill="#C8E6FF"/>
            <rect x="1840" y="276" width="20" height="20" fill="#FFE87C"/>
            <rect x="1874" y="276" width="20" height="20" fill="#C8E6FF"/>
          </g>

          {/* Mid building left */}
          <rect x="130" y="280" width="220" height="400" fill="#A0B0D0" opacity="0.6"/>
          <rect x="150" y="230" width="180" height="60" fill="#9AA8C8" opacity="0.6"/>
          <g id="plaza-bld-win-mid-left" opacity={isNight ? 1 : 0.3}>
            <rect x="142" y="300" width="24" height="24" fill="#FFE87C"/>
            <rect x="182" y="300" width="24" height="24" fill="#C8E6FF"/>
            <rect x="222" y="300" width="24" height="24" fill="#FFE87C"/>
            <rect x="262" y="300" width="24" height="24" fill="#C8E6FF"/>
            <rect x="142" y="340" width="24" height="24" fill="#C8E6FF"/>
            <rect x="182" y="340" width="24" height="24" fill="#FFE87C"/>
            <rect x="222" y="340" width="24" height="24" fill="#C8E6FF"/>
            <rect x="262" y="340" width="24" height="24" fill="#FFE87C"/>
            <rect x="142" y="380" width="24" height="24" fill="#FFE87C"/>
            <rect x="182" y="380" width="24" height="24" fill="#C8E6FF"/>
            <rect x="222" y="380" width="24" height="24" fill="#FFE87C"/>
            <rect x="262" y="380" width="24" height="24" fill="#C8E6FF"/>
          </g>

          {/* Mid building right */}
          <rect x="1570" y="260" width="240" height="420" fill="#A0B0D0" opacity="0.6"/>
          <rect x="1590" y="210" width="200" height="60" fill="#9AA8C8" opacity="0.6"/>
          <g id="plaza-bld-win-mid-right" opacity={isNight ? 1 : 0.3}>
            <rect x="1582" y="280" width="24" height="24" fill="#C8E6FF"/>
            <rect x="1622" y="280" width="24" height="24" fill="#FFE87C"/>
            <rect x="1662" y="280" width="24" height="24" fill="#C8E6FF"/>
            <rect x="1702" y="280" width="24" height="24" fill="#FFE87C"/>
            <rect x="1742" y="280" width="24" height="24" fill="#C8E6FF"/>
            <rect x="1582" y="320" width="24" height="24" fill="#FFE87C"/>
            <rect x="1622" y="320" width="24" height="24" fill="#C8E6FF"/>
            <rect x="1662" y="320" width="24" height="24" fill="#FFE87C"/>
            <rect x="1702" y="320" width="24" height="24" fill="#C8E6FF"/>
            <rect x="1742" y="320" width="24" height="24" fill="#FFE87C"/>
            <rect x="1582" y="360" width="24" height="24" fill="#C8E6FF"/>
            <rect x="1622" y="360" width="24" height="24" fill="#FFE87C"/>
            <rect x="1662" y="360" width="24" height="24" fill="#C8E6FF"/>
            <rect x="1702" y="360" width="24" height="24" fill="#FFE87C"/>
            <rect x="1742" y="360" width="24" height="24" fill="#C8E6FF"/>
          </g>

          {/* Clouds */}
          <g id="plaza-clouds" opacity={isNight ? 0 : 1}>
            <rect x="220" y="80" width="170" height="40" fill="white" opacity="0.9"/>
            <rect x="212" y="96" width="186" height="40" fill="white" opacity="0.9"/>
            <rect x="236" y="64" width="120" height="34" fill="white" opacity="0.9"/>
            <rect x="760" y="50" width="200" height="44" fill="white" opacity="0.85"/>
            <rect x="752" y="66" width="216" height="44" fill="white" opacity="0.85"/>
            <rect x="776" y="36" width="152" height="36" fill="white" opacity="0.85"/>
            <rect x="1340" y="70" width="180" height="40" fill="white" opacity="0.8"/>
            <rect x="1332" y="86" width="196" height="40" fill="white" opacity="0.8"/>
            <rect x="1352" y="56" width="132" height="34" fill="white" opacity="0.8"/>
          </g>

          {/* Stars */}
          <g id="plaza-stars" opacity={isNight ? 1 : 0}>
            <rect x="100" y="40" width="6" height="6" fill="white"/>
            <rect x="280" y="90" width="4" height="4" fill="white"/>
            <rect x="460" y="30" width="6" height="6" fill="white"/>
            <rect x="620" y="80" width="4" height="4" fill="white"/>
            <rect x="800" y="20" width="6" height="6" fill="white"/>
            <rect x="960" y="70" width="4" height="4" fill="white"/>
            <rect x="1120" y="35" width="6" height="6" fill="white"/>
            <rect x="1300" y="85" width="4" height="4" fill="white"/>
            <rect x="1480" y="25" width="6" height="6" fill="white"/>
            <rect x="1660" y="75" width="4" height="4" fill="white"/>
            <rect x="1820" y="40" width="6" height="6" fill="white"/>
            <rect x="180" y="120" width="4" height="4" fill="white"/>
            <rect x="540" y="110" width="4" height="4" fill="white"/>
            <rect x="900" y="115" width="4" height="4" fill="white"/>
            <rect x="1260" y="108" width="4" height="4" fill="white"/>
            <rect x="1620" y="118" width="4" height="4" fill="white"/>
            <rect x="1880" y="105" width="4" height="4" fill="white"/>
            {/* Moon */}
            <rect id="plaza-moon" x="1640" y="50" width="48" height="48" fill="#FFFACD" opacity="0"/>
          </g>

          {/* Rain — hidden, handled by React overlays */}
          <g id="plaza-rain" opacity={0}>
            <rect x="40" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="120" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="200" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="280" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="360" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="440" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="520" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="600" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="680" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="760" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="840" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="920" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="1000" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="1080" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="1160" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="1240" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="1320" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="1400" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="1480" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="1560" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="1640" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="1720" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="1800" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
            <rect x="1880" y="0" width="4" height="40" fill="#88AACC" opacity="0.5"/>
          </g>

          {/* Back grass */}
          <rect y="556" width="1920" height="110" fill="#4A8F3A"/>
          <rect y="556" width="1920" height="12" fill="#5AAF4A"/>

          {/* Trees left */}
          <rect x="360" y="420" width="34" height="246" fill="#3D5A2B"/>
          <rect x="330" y="310" width="94" height="120" fill="#4D7A3B"/>
          <rect x="344" y="268" width="66" height="54" fill="#5D8A4B"/>
          <rect x="354" y="238" width="46" height="38" fill="#6D9A5B"/>
          <rect x="560" y="400" width="38" height="266" fill="#3D5A2B"/>
          <rect x="526" y="284" width="106" height="130" fill="#4D7A3B"/>
          <rect x="540" y="240" width="78" height="54" fill="#5D8A4B"/>
          <rect x="552" y="208" width="54" height="42" fill="#6D9A5B"/>

          {/* Trees right */}
          <rect x="1300" y="420" width="34" height="246" fill="#3D5A2B"/>
          <rect x="1270" y="310" width="94" height="120" fill="#4D7A3B"/>
          <rect x="1284" y="268" width="66" height="54" fill="#5D8A4B"/>
          <rect x="1294" y="238" width="46" height="38" fill="#6D9A5B"/>
          <rect x="1520" y="400" width="38" height="266" fill="#3D5A2B"/>
          <rect x="1486" y="284" width="106" height="130" fill="#4D7A3B"/>
          <rect x="1500" y="240" width="78" height="54" fill="#5D8A4B"/>
          <rect x="1512" y="208" width="54" height="42" fill="#6D9A5B"/>

          {/* Path */}
          <rect y="660" width="1920" height="134" fill="#C8A87A"/>
          <rect y="660" width="1920" height="8" fill="#D8B88A"/>
          <rect x="0" y="694" width="1920" height="4" fill="#B89860" opacity="0.4"/>
          <rect x="0" y="728" width="1920" height="4" fill="#B89860" opacity="0.4"/>
          <rect x="0" y="762" width="1920" height="4" fill="#B89860" opacity="0.4"/>
          <rect x="192" y="660" width="4" height="134" fill="#B89860" opacity="0.25"/>
          <rect x="384" y="660" width="4" height="134" fill="#B89860" opacity="0.25"/>
          <rect x="576" y="660" width="4" height="134" fill="#B89860" opacity="0.25"/>
          <rect x="768" y="660" width="4" height="134" fill="#B89860" opacity="0.25"/>
          <rect x="960" y="660" width="4" height="134" fill="#B89860" opacity="0.25"/>
          <rect x="1152" y="660" width="4" height="134" fill="#B89860" opacity="0.25"/>
          <rect x="1344" y="660" width="4" height="134" fill="#B89860" opacity="0.25"/>
          <rect x="1536" y="660" width="4" height="134" fill="#B89860" opacity="0.25"/>
          <rect x="1728" y="660" width="4" height="134" fill="#B89860" opacity="0.25"/>

          {/* Fence */}
          <rect y="638" width="1920" height="28" fill="#8B6914"/>
          <rect y="632" width="1920" height="10" fill="#C4920A"/>
          <rect x="0" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="96" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="192" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="288" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="384" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="480" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="576" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="672" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="768" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="864" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="960" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="1056" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="1152" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="1248" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="1344" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="1440" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="1536" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="1632" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="1728" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="1824" y="590" width="18" height="58" fill="#8B6914"/>
          <rect x="1900" y="590" width="18" height="58" fill="#8B6914"/>

          {/* Lamp posts */}
          <rect x="346" y="466" width="18" height="228" fill="#666"/>
          <rect x="328" y="450" width="60" height="22" fill="#888"/>
          <rect x="332" y="424" width="54" height="28" fill="#FFE87C" opacity="0.9"/>
          <rect x="322" y="662" width="58" height="14" fill="#555"/>
          <rect id="plaza-lamp-glow-1" x="296" y="420" width="130" height="80" fill="#FFE87C" opacity={isNight || weather === 'rain' || weather === 'thunder' ? 0.28 : 0}/>
          <rect x="938" y="466" width="18" height="228" fill="#666"/>
          <rect x="920" y="450" width="60" height="22" fill="#888"/>
          <rect x="924" y="424" width="54" height="28" fill="#FFE87C" opacity="0.9"/>
          <rect x="914" y="662" width="58" height="14" fill="#555"/>
          <rect id="plaza-lamp-glow-2" x="888" y="420" width="130" height="80" fill="#FFE87C" opacity={isNight || weather === 'rain' || weather === 'thunder' ? 0.28 : 0}/>
          <rect x="1530" y="466" width="18" height="228" fill="#666"/>
          <rect x="1512" y="450" width="60" height="22" fill="#888"/>
          <rect x="1516" y="424" width="54" height="28" fill="#FFE87C" opacity="0.9"/>
          <rect x="1506" y="662" width="58" height="14" fill="#555"/>
          <rect id="plaza-lamp-glow-3" x="1480" y="420" width="130" height="80" fill="#FFE87C" opacity={isNight || weather === 'rain' || weather === 'thunder' ? 0.28 : 0}/>

          {/* Benches */}
          <rect x="620" y="624" width="168" height="18" fill="#8B6914"/>
          <rect x="616" y="618" width="176" height="10" fill="#C4920A"/>
          <rect x="628" y="642" width="20" height="28" fill="#7A5A10"/>
          <rect x="748" y="642" width="20" height="28" fill="#7A5A10"/>
          <rect x="1124" y="624" width="168" height="18" fill="#8B6914"/>
          <rect x="1120" y="618" width="176" height="10" fill="#C4920A"/>
          <rect x="1132" y="642" width="20" height="28" fill="#7A5A10"/>
          <rect x="1252" y="642" width="20" height="28" fill="#7A5A10"/>

          {/* Flowers */}
          <rect x="454" y="614" width="10" height="10" fill="#E63946"/>
          <rect x="450" y="618" width="18" height="6" fill="#E63946"/>
          <rect x="458" y="600" width="4" height="16" fill="#4A8F3A"/>
          <rect x="840" y="612" width="10" height="10" fill="#FFE600"/>
          <rect x="836" y="616" width="18" height="6" fill="#FFE600"/>
          <rect x="844" y="598" width="4" height="16" fill="#4A8F3A"/>
          <rect x="1090" y="614" width="10" height="10" fill="#A8DADC"/>
          <rect x="1086" y="618" width="18" height="6" fill="#A8DADC"/>
          <rect x="1094" y="600" width="4" height="16" fill="#4A8F3A"/>
          <rect x="1480" y="612" width="10" height="10" fill="#F4A261"/>
          <rect x="1476" y="616" width="18" height="6" fill="#F4A261"/>
          <rect x="1484" y="598" width="4" height="16" fill="#4A8F3A"/>

          {/* Front grass */}
          <rect y="790" width="1920" height="290" fill="#3A7A2A"/>
          <rect y="790" width="1920" height="14" fill="#4A8F3A"/>

          {/* Front flowers */}
          <rect x="140" y="814" width="10" height="10" fill="#E63946"/>
          <rect x="136" y="818" width="18" height="6" fill="#E63946"/>
          <rect x="144" y="800" width="4" height="16" fill="#3A7A2A"/>
          <rect x="480" y="820" width="10" height="10" fill="#FFE600"/>
          <rect x="476" y="824" width="18" height="6" fill="#FFE600"/>
          <rect x="484" y="806" width="4" height="16" fill="#3A7A2A"/>
          <rect x="960" y="814" width="10" height="10" fill="#A8DADC"/>
          <rect x="956" y="818" width="18" height="6" fill="#A8DADC"/>
          <rect x="964" y="800" width="4" height="16" fill="#3A7A2A"/>
          <rect x="1440" y="820" width="10" height="10" fill="#E63946"/>
          <rect x="1436" y="824" width="18" height="6" fill="#E63946"/>
          <rect x="1444" y="806" width="4" height="16" fill="#3A7A2A"/>
          <rect x="1780" y="814" width="10" height="10" fill="#FFE600"/>
          <rect x="1776" y="818" width="18" height="6" fill="#FFE600"/>
          <rect x="1784" y="800" width="4" height="16" fill="#3A7A2A"/>
        </svg>

        <div className={styles.petCount}>🐾 {pets.length} PETS HERE</div>

        {/* Grey sky on rain/thunder */}
        {(weather === 'rain' || weather === 'thunder') && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(60,70,80,0.35)',
            pointerEvents: 'none', zIndex: 2,
          }} />
        )}

        {/* Rain falling from sky */}
        {(weather === 'rain' || weather === 'thunder') && (
          <div style={{
            position: 'absolute', inset: 0,
            overflow: 'hidden',
            pointerEvents: 'none', zIndex: 3,
          }}>
            {Array.from({ length: 60 }).map((_, i) => (
              <div key={i} style={{
                position: 'absolute',
                left: `${(i * 1.7) % 100}%`,
                top: '-5%',
                width: '2px',
                height: '18px',
                background: 'rgba(174,214,241,0.6)',
                animation: `plazaRainDrop ${0.5 + (i % 6) * 0.07}s linear ${(i * 0.05) % 0.6}s infinite`,
                transform: 'rotate(12deg)',
              }} />
            ))}
          </div>
        )}

        {/* Thunder flash overlay */}
        {weather === 'thunder' && (
          <div style={{
            position: 'absolute', inset: 0,
            pointerEvents: 'none', zIndex: 6,
            animation: 'thunderFlash 4s ease-in-out infinite',
          }} />
        )}

        {/* Sky: lightning bolt */}
        {weather === 'thunder' && (
          <svg style={{
            position: 'absolute',
            left: '48%', top: '3%',
            width: '60px', height: '180px',
            pointerEvents: 'none', zIndex: 5,
            animation: 'lightningBolt 4s ease-in-out infinite',
            filter: 'drop-shadow(0 0 12px #FFE87C)',
          }} viewBox="0 0 40 120">
            <polyline points="24,0 10,55 22,55 16,120 34,50 20,50 28,0" fill="#FFE87C" stroke="#FFF176" strokeWidth="1"/>
          </svg>
        )}

        {/* Night overlay */}
        {isNight && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(10,20,60,0.45)',
            pointerEvents: 'none', zIndex: 2,
          }} />
        )}

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

        {drawingPerformance && (
          <div style={{
            position: 'absolute',
            left: drawingPerformance.petX + 20,
            bottom: '22%',
            transform: 'translateY(-40px)',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            animation: 'drawingAppear 0.3s ease-out',
          }}>
            <div style={{
              background: '#FDF6E3',
              border: '3px solid #2C2C2C',
              boxShadow: '4px 4px 0 #2C2C2C',
              padding: 4,
            }}>
              <img
                src={drawingPerformance.dataURL}
                style={{
                  width: 80, height: 80,
                  imageRendering: 'pixelated',
                  display: 'block',
                  animation: 'drawingReveal 2s steps(16) ease-in forwards',
                }}
              />
            </div>
            <div style={{
              fontFamily: 'var(--font-pixel)', fontSize: '6px',
              color: '#2C2C2C', background: '#FFE600',
              padding: '2px 6px', border: '1px solid #2C2C2C',
            }}>MY ART</div>
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
                  <button
                    className={styles.likeBtn}
                    style={{ background: unlikedPets.has(selectedPet.id) ? '#ccc' : '#e94560', color: '#fff', marginTop: '6px' }}
                    onClick={async () => {
                      if (unlikedPets.has(selectedPet.id)) return
                      await unlikePet(selectedPet.id)
                      setUnlikedPets(prev => new Set([...prev, selectedPet.id]))
                    }}
                    disabled={unlikedPets.has(selectedPet.id)}
                  >
                    {unlikedPets.has(selectedPet.id) ? '👎 REPORTED' : '👎 REPORT'}
                  </button>
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
