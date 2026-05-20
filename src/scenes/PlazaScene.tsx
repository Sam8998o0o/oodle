import { useRef, useState, useEffect, useCallback } from 'react'
import { PetAnimator } from '../engine/PetAnimator'
import type { PetCoords } from '../api/aiRecognize'
import {
  fetchAllPets, getAllLikeCounts, likePet, getTodayLikedPetIds,
  postShout, getActiveShouts, countTodayShouts, likeShout,
  fetchAds,
} from '../lib/petService'
import type { AdRecord } from '../lib/petService'
import { subscribeToNewPets } from '../lib/realtimeService'
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

const SHOUT_DAILY_LIMIT = 10
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
  petSize:    number
}

interface PlazaPet {
  id: string
  pixelData: string
  coords: PetCoords
  name: string
  createdAt: string
  isOwn: boolean
}

interface StoredPet {
  id: string
  pixelData: string
  name?: string
  createdAt?: string
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

export default function PlazaScene({ petData, onGoToRoom, petSize }: PlazaSceneProps) {
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
  const [doorPhase, setDoorPhase]     = useState<DoorPhase>('idle')
  const [showAdModal, setShowAdModal] = useState(false)
  const [adPlan, setAdPlan]           = useState('1 month')
  const [adForm, setAdForm]           = useState({ company: '', email: '', bannerText: '', subText: '', logoUrl: '', destUrl: '' })
  const [adSubmitted, setAdSubmitted] = useState(false)
  const [adSubmitting, setAdSubmitting] = useState(false)

  // Keep petSizeRef in sync — used by spawnPet without causing re-spawn
  useEffect(() => { petSizeRef.current = petSize }, [petSize])
  const [hearts, setHearts]           = useState<HeartAnim[]>([])

  // ── Shout system ──────────────────────────────────────────
  const [shoutInput,   setShoutInput]   = useState('')
  const [shoutLeft,    setShoutLeft]    = useState(SHOUT_DAILY_LIMIT)
  const [activeShouts, setActiveShouts] = useState<Record<string, { message: string; shoutId: string }>>({})
  const [likedShouts,  setLikedShouts]  = useState<Set<string>>(new Set())

  useEffect(() => {
    const t = setTimeout(() => setOwnGlowing(false), 8000)
    return () => clearTimeout(t)
  }, [])

  // ── Load ads from Supabase ────────────────────────────────
  useEffect(() => {
    fetchAds().then(data => {
      if (data.length > 0) setAds(data)
    }).catch(() => {})
  }, [])

  const AD_CONFIGS = [
    { top: '8%',  duration: 20, delay: 0  },
    { top: '22%', duration: 26, delay: 10 },
    { top: '36%', duration: 22, delay: 18 },
  ]

  // ── Shout: load today's count on mount ────────────────────
  useEffect(() => {
    countTodayShouts()
      .then(n => setShoutLeft(SHOUT_DAILY_LIMIT - n))
      .catch(() => {})
  }, [])

  // ── Like: load today's liked pets on mount ────────────────
  useEffect(() => {
    getTodayLikedPetIds().then(ids => {
      setTodayLikedPets(ids)
      setLikeLeft(Math.max(0, LIKE_DAILY_LIMIT - ids.size))
    }).catch(() => {})
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

    const eyeStyle  = localStorage.getItem('oodle_eye_style') ?? 'eye_round'
    const size      = pet.isOwn ? petSizeRef.current : PET_SIZE
    canvas.width    = size
    canvas.height   = size
    wrapper.style.width  = `${size}px`
    wrapper.style.height = `${size + 20}px`
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
  }, [])

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
        const sz         = id === 'own' ? petSizeRef.current : PET_SIZE
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
      id:        'own',
      pixelData: petData.pixelData,
      coords:    petData.coords,
      name:      petData.name,
      createdAt: new Date().toISOString(),
      isOwn:     true,
    }
    setPets([ownPet])

    const loadFromLocalStorage = () => {
      try {
        const raw = localStorage.getItem('oodle_pets')
        if (!raw) return
        const stored = JSON.parse(raw) as StoredPet[]
        const ownLocalId = localStorage.getItem('oodle_pet_local_id')
        const others: PlazaPet[] = stored
          .filter(p => p.id !== ownLocalId)
          .map((p, i) => ({
            id:        p.id,
            pixelData: p.pixelData,
            coords:    DEFAULT_COORDS,
            name:      p.name ?? `Pet #${i + 1}`,
            createdAt: p.createdAt ?? new Date().toISOString(),
            isOwn:     false,
          }))
        setPets(prev => mergePets(prev, [ownPet, ...others]))
      } catch { /* ignore */ }
      try {
        const rawLikes = localStorage.getItem('oodle_likes')
        if (rawLikes) setLikes(JSON.parse(rawLikes) as Record<string, number>)
      } catch { /* ignore */ }
    }

    const loadFromSupabase = async () => {
      const [records, likeCounts] = await Promise.all([
        fetchAllPets(),
        getAllLikeCounts(),
      ])
      if (records.length === 0) { loadFromLocalStorage(); return }
      const ownSupabaseId = localStorage.getItem('oodle_pet_supabase_id')
      const others: PlazaPet[] = records
        .filter(r => r.id !== ownSupabaseId && r.pixel_data !== petData.pixelData)
        .map(r => ({
          id:        r.id,
          pixelData: r.pixel_data,
          coords:    r.coords ?? DEFAULT_COORDS,
          name:      r.name,
          createdAt: r.created_at,
          isOwn:     false,
        }))
      setPets(prev => mergePets(prev, [ownPet, ...others]))
      setLikes(likeCounts)
    }

    loadFromSupabase().catch(() => loadFromLocalStorage())
  }, [petData])

  // ── Realtime ──────────────────────────────────────────────
  useEffect(() => {
    const ownSupabaseId = localStorage.getItem('oodle_pet_supabase_id')
    const unsubscribe = subscribeToNewPets(newPet => {
      if (newPet.id === ownSupabaseId) return
      if (newPet.pixel_data === petData.pixelData) return
      setPets(prev => {
        if (prev.some(p => p.id === newPet.id)) return prev
        return [...prev, {
          id:        newPet.id,
          pixelData: newPet.pixel_data,
          coords:    newPet.coords ?? DEFAULT_COORDS,
          name:      newPet.name,
          createdAt: newPet.created_at,
          isOwn:     false,
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
  }, [likedShouts])

  return (
    <div className={styles.page}>
      <div className={styles.room} ref={roomRef}>
        <div className={styles.petCount}>🐾 {pets.length} PETS HERE</div>

        {/* ── Airplane ad banners ── */}
        <div className={styles.skyLayer}>
          {ads.map((ad, i) => {
            const cfg = AD_CONFIGS[i % AD_CONFIGS.length]
            return (
              <div
                key={ad.id}
                className={`${styles.flyLTR} ${styles.airplane}`}
                style={{
                  position: 'absolute',
                  top: cfg.top,
                  display: 'flex',
                  alignItems: 'center',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  animationDuration: `${cfg.duration}s`,
                  animationDelay: `${cfg.delay}s`,
                }}
                onClick={() => { if (!ad.logo_url) setShowAdModal(true); else window.open(ad.url, '_blank', 'noopener') }}
              >
                {/* Plane leads on left */}
                <svg width="110" height="55" viewBox="0 0 530 220" style={{ imageRendering: 'pixelated', flexShrink: 0, transform: 'scaleX(-1)' }} xmlns="http://www.w3.org/2000/svg">
                  <g transform="translate(80,20)">
                    <rect x="0"   y="24"  width="32" height="48" fill="#cc2222"/>
                    <rect x="8"   y="16"  width="24" height="8"  fill="#cc2222"/>
                    <rect x="16"  y="8"   width="16" height="8"  fill="#cc2222"/>
                    <rect x="24"  y="0"   width="8"  height="8"  fill="#cc2222"/>
                    <rect x="0"   y="128" width="8"  height="8"  fill="#cc2222"/>
                    <rect x="0"   y="120" width="16" height="8"  fill="#cc2222"/>
                    <rect x="0"   y="112" width="32" height="8"  fill="#cc2222"/>
                    <rect x="0"   y="104" width="40" height="8"  fill="#cc2222"/>
                    <rect x="0"   y="72"  width="400" height="40" fill="#c8c8c8"/>
                    <rect x="392" y="76"  width="24" height="32" fill="#d4d4d4"/>
                    <rect x="408" y="80"  width="16" height="24" fill="#dcdcdc"/>
                    <rect x="416" y="84"  width="16" height="16" fill="#e4e4e4"/>
                    <rect x="424" y="88"  width="8"  height="8"  fill="#ececec"/>
                    <rect x="240" y="64"  width="80" height="8"  fill="#b8b8b8"/>
                    <rect x="200" y="56"  width="120" height="8"  fill="#c0c0c0"/>
                    <rect x="160" y="48"  width="128" height="8"  fill="#c4c4c4"/>
                    <rect x="120" y="40"  width="120" height="8"  fill="#c8c8c8"/>
                    <rect x="88"  y="32"  width="96"  height="8"  fill="#cccccc"/>
                    <rect x="72"  y="24"  width="56"  height="8"  fill="#cccccc"/>
                    <rect x="240" y="112" width="80" height="8"  fill="#b8b8b8"/>
                    <rect x="200" y="120" width="120" height="8"  fill="#c0c0c0"/>
                    <rect x="160" y="128" width="128" height="8"  fill="#c4c4c4"/>
                    <rect x="120" y="136" width="120" height="8"  fill="#c8c8c8"/>
                    <rect x="88"  y="144" width="96"  height="8"  fill="#cccccc"/>
                    <rect x="72"  y="152" width="56"  height="8"  fill="#cccccc"/>
                    <rect x="168" y="120" width="72" height="16" fill="#aaaaaa"/>
                    <rect x="176" y="136" width="56" height="8"  fill="#999999"/>
                    <rect x="184" y="144" width="40" height="8"  fill="#888888"/>
                    <rect x="320" y="80"  width="16" height="16" fill="#7799cc"/>
                    <rect x="296" y="80"  width="16" height="16" fill="#7799cc"/>
                    <rect x="272" y="80"  width="16" height="16" fill="#7799cc"/>
                    <rect x="320" y="80"  width="6"  height="6"  fill="#aabbee"/>
                    <rect x="296" y="80"  width="6"  height="6"  fill="#aabbee"/>
                    <rect x="272" y="80"  width="6"  height="6"  fill="#aabbee"/>
                    <rect x="0"   y="72"  width="400" height="2"  fill="#aaaaaa"/>
                    <rect x="0"   y="110" width="400" height="2"  fill="#999999"/>
                  </g>
                </svg>
                {/* Rope */}
                <div className={styles.adRope} />
                {/* Banner trails on left */}
                <div className={styles.adBanner} onClick={() => {
                  if (!ad.logo_url) { setShowAdModal(true) }
                  else { window.open(ad.url, '_blank', 'noopener') }
                }}>
                  {ad.logo_url && <img src={ad.logo_url} className={styles.adLogo} alt="" />}
                  <div>
                    <div className={styles.adText}>{ad.text}</div>
                    {ad.sub_text && <div className={styles.adTextSmall}>{ad.sub_text}</div>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Ad purchase modal ── */}
        {showAdModal && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
            onClick={() => { setShowAdModal(false); setAdSubmitted(false) }}
          >
            <div
              style={{ background: '#FDF6E3', border: '3px solid #2C2C2C', boxShadow: '8px 8px 0 #2C2C2C', padding: '28px 28px 24px', width: '100%', maxWidth: '420px', maxHeight: '92vh', overflowY: 'auto' }}
              onClick={e => e.stopPropagation()}
            >
              {adSubmitted ? (
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
                  <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '12px', marginBottom: '12px', letterSpacing: '2px' }}>REQUEST RECEIVED!</div>
                  <div style={{ fontFamily: 'var(--font-retro)', fontSize: '17px', color: '#666', marginBottom: '24px', lineHeight: '1.5' }}>We will contact you within 24 hours to confirm payment and activate your ad.</div>
                  <button
                    style={{ fontFamily: 'var(--font-pixel)', fontSize: '10px', padding: '12px 28px', background: '#FFE600', border: '2px solid #2C2C2C', boxShadow: '3px 3px 0 #2C2C2C', cursor: 'pointer', letterSpacing: '1px' }}
                    onClick={() => { setShowAdModal(false); setAdSubmitted(false) }}
                  >CLOSE</button>
                </div>
              ) : (
                <>
                  {/* Header */}
                  <div style={{ borderBottom: '2px solid #2C2C2C', paddingBottom: '16px', marginBottom: '20px' }}>
                    <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '8px', letterSpacing: '3px', color: '#888', marginBottom: '8px' }}>OODLE PLAZA</div>
                    <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '16px', marginBottom: '6px' }}>✈️  ADVERTISE HERE</div>
                    <div style={{ fontFamily: 'var(--font-retro)', fontSize: '16px', color: '#666', lineHeight: '1.5' }}>Fly your brand across the plaza — seen by all players daily.</div>
                  </div>

                  {/* Plan selector */}
                  <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '9px', color: '#444', marginBottom: '10px', letterSpacing: '1px' }}>SELECT PLAN</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '24px' }}>
                    {[
                      { dur: '1 WEEK', price: 'RM 29', note: 'one-time' },
                      { dur: '1 MONTH', price: 'RM 89', note: 'best value' },
                      { dur: '3 MONTHS', price: 'RM 199', note: 'save 25%' },
                    ].map(p => (
                      <div key={p.dur}
                        onClick={() => setAdPlan(p.dur)}
                        style={{ border: adPlan === p.dur ? '2px solid #2C2C2C' : '2px solid #ccc', padding: '12px 6px', textAlign: 'center', cursor: 'pointer', background: adPlan === p.dur ? '#FFE600' : '#fff' }}>
                        <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '7px', color: '#888', marginBottom: '6px' }}>{p.dur}</div>
                        <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '12px', color: '#2C2C2C', marginBottom: '4px' }}>{p.price}</div>
                        <div style={{ fontFamily: 'var(--font-retro)', fontSize: '12px', color: '#888' }}>{p.note}</div>
                      </div>
                    ))}
                  </div>

                  {/* Fields */}
                  {([
                    { label: 'Company Name', key: 'company', ph: 'Acme Sdn Bhd', type: 'text', req: true },
                    { label: 'Contact Email', key: 'email', ph: 'hello@company.com', type: 'email', req: true },
                    { label: 'Banner Text', key: 'bannerText', ph: 'SHOPEE MY  (max 20 chars)', type: 'text', req: true },
                    { label: 'Sub Text', key: 'subText', ph: 'shopee.com.my  (max 30 chars)', type: 'text', req: false },
                    { label: 'Logo URL', key: 'logoUrl', ph: 'https://...logo.png', type: 'url', req: false },
                    { label: 'Website URL', key: 'destUrl', ph: 'https://yoursite.com', type: 'url', req: true },
                  ] as { label: string; key: keyof typeof adForm; ph: string; type: string; req: boolean }[]).map(f => (
                    <div key={f.key} style={{ marginBottom: '14px' }}>
                      <div style={{ fontFamily: 'var(--font-pixel)', fontSize: '8px', color: '#444', marginBottom: '6px', letterSpacing: '1px' }}>
                        {f.label}{f.req && <span style={{ color: '#e94560' }}> *</span>}
                      </div>
                      <input
                        type={f.type}
                        maxLength={f.key === 'bannerText' ? 20 : f.key === 'subText' ? 30 : undefined}
                        placeholder={f.ph}
                        value={adForm[f.key]}
                        onChange={e => setAdForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                        style={{ width: '100%', fontFamily: 'var(--font-retro)', fontSize: '16px', padding: '10px 12px', border: '2px solid #2C2C2C', background: '#fff', outline: 'none', boxSizing: 'border-box' as const }}
                      />
                    </div>
                  ))}

                  <div style={{ height: '8px' }} />
                  <button
                    disabled={adSubmitting}
                    onClick={async () => {
                      if (!adForm.company || !adForm.email || !adForm.bannerText || !adForm.destUrl) {
                        alert('Please fill in all required fields (*).')
                        return
                      }
                      setAdSubmitting(true)
                      try {
                        await fetch('https://api.web3forms.com/submit', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            access_key: 'YOUR_WEB3FORMS_KEY',
                            subject: `[Oodle Ad] ${adForm.company} — ${adPlan}`,
                            company: adForm.company,
                            email: adForm.email,
                            plan: adPlan,
                            banner_text: adForm.bannerText,
                            sub_text: adForm.subText,
                            logo_url: adForm.logoUrl,
                            website: adForm.destUrl,
                          }),
                        })
                      } catch { /* ignore */ }
                      setAdSubmitting(false)
                      setAdSubmitted(true)
                      setAdForm({ company: '', email: '', bannerText: '', subText: '', logoUrl: '', destUrl: '' })
                    }}
                    style={{ width: '100%', fontFamily: 'var(--font-pixel)', fontSize: '10px', padding: '14px', background: adSubmitting ? '#ccc' : '#FFE600', color: '#2C2C2C', border: '2px solid #2C2C2C', boxShadow: '4px 4px 0 #2C2C2C', cursor: adSubmitting ? 'not-allowed' : 'pointer', letterSpacing: '2px' }}
                  >
                    {adSubmitting ? 'SENDING...' : 'SUBMIT REQUEST →'}
                  </button>
                  <div style={{ fontFamily: 'var(--font-retro)', fontSize: '13px', color: '#888', textAlign: 'center', marginTop: '10px' }}>
                    We will contact you within 24 hours to confirm payment.
                  </div>
                </>
              )}
            </div>
          </div>
        )}

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


              <canvas
                ref={el => {
                  if (el) {
                    canvasMap.current.set(pet.id, el)
                    spawnPet(pet)
                  } else {
                    canvasMap.current.delete(pet.id)
                  }
                }}
                width={pet.isOwn ? petSize : PET_SIZE}
                height={pet.isOwn ? petSize : PET_SIZE}
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
            SHOUT {SHOUT_DAILY_LIMIT - shoutLeft}/{SHOUT_DAILY_LIMIT}
          </span>
        </div>
      </div>
    </div>
  )
}
