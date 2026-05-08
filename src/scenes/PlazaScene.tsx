import { useRef, useState, useEffect, useCallback } from 'react'
import { PetAnimator } from '../engine/PetAnimator'
import type { PetCoords } from '../api/aiRecognize'
import { fetchAllPets, getAllLikeCounts, likePet } from '../lib/petService'
import { subscribeToNewPets } from '../lib/realtimeService'
import styles from './PlazaScene.module.css'

const PET_SIZE   = 120
const LEFT_BOUND = 80
const RIGHT_PAD  = 80
const WALK_Y_MIN = 0.68   // top of walkable ground area
const WALK_Y_MAX = 0.88   // bottom of walkable ground area

// No obstacle zones — pets walk freely across the plaza

const DEFAULT_COORDS: PetCoords = {
  eyes:     [{ x: 0.35, y: 0.28 }, { x: 0.65, y: 0.28 }],
  legs:     [],
  center:   { x: 0.5, y: 0.5 },
  has_eyes: false,
  has_legs: false,
}

interface PlazaSceneProps {
  petData: { pixelData: string; coords: PetCoords; name: string }
  onGoToRoom: () => void
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

export default function PlazaScene({ petData, onGoToRoom }: PlazaSceneProps) {
  const roomRef    = useRef<HTMLDivElement>(null)

  // DOM refs — keyed by pet id
  const wrapperMap = useRef(new Map<string, HTMLDivElement>())
  const canvasMap  = useRef(new Map<string, HTMLCanvasElement>())

  // Pure JS state — never triggers React re-render
  const animMap    = useRef(new Map<string, PetAnimator>())
  const walkerMap  = useRef(new Map<string, Walker>())
  const rafRef     = useRef(0)

  // Queue of pets waiting to be spawned (DOM not ready yet when pets state updates)
  const spawnQueue = useRef<PlazaPet[]>([])

  const [pets, setPets]               = useState<PlazaPet[]>([])
  const [selectedPet, setSelectedPet] = useState<PlazaPet | null>(null)
  const [likes, setLikes]             = useState<Record<string, number>>({})
  const [ownGlowing, setOwnGlowing]   = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setOwnGlowing(false), 8000)
    return () => clearTimeout(t)
  }, [])

  // ── Spawn a pet into the walk system ──────────────────────
  const spawnPet = useCallback((pet: PlazaPet) => {
    if (animMap.current.has(pet.id)) return   // already spawned

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
    const animator  = new PetAnimator(canvas, {
      imageDataURL: pet.pixelData,
      coords:       pet.coords,
      size:         PET_SIZE,
      eyeStyle,
    })
    animator.setState('walk')
    animator.start()
    animMap.current.set(pet.id, animator)

    const rightBound = rW - RIGHT_PAD - PET_SIZE
    const yRatio     = WALK_Y_MIN + Math.random() * (WALK_Y_MAX - WALK_Y_MIN)
    const y          = yRatio * rH - PET_SIZE
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
      const rightBound = rW - RIGHT_PAD - PET_SIZE

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
      const topBound    = WALK_Y_MIN * rH - PET_SIZE
      const bottomBound = WALK_Y_MAX * rH - PET_SIZE

      walkerMap.current.forEach((w, id) => {
        const wr = wrapperMap.current.get(id)
        const cv = canvasMap.current.get(id)
        if (!wr || !cv) return

        // X movement
        const nextX = w.x + w.speed * w.dir
        if (nextX >= rightBound) { w.dir = -1 }
        else if (nextX <= LEFT_BOUND) { w.dir = 1 }
        else { w.x = nextX }

        // Y movement
        const nextY = w.y + w.speedY * w.dirY
        if (nextY >= bottomBound) { w.dirY = -1 }
        else if (nextY <= topBound) { w.dirY = 1 }
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
        .filter(r => r.id !== ownSupabaseId)
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
    setLikes(prev => {
      const updated = { ...prev, [petId]: (prev[petId] ?? 0) + 1 }
      localStorage.setItem('oodle_likes', JSON.stringify(updated))
      return updated
    })
    likePet(petId).catch(() => {})
  }, [])

  return (
    <div className={styles.page}>
      <div className={styles.room} ref={roomRef}>
        <button className={styles.backBtn} onClick={onGoToRoom}>← MY ROOM</button>
        <div className={styles.petCount}>🐾 {pets.length} PETS HERE</div>

        {pets.map(pet => (
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
                // Try spawn now that DOM is available
                spawnPet(pet)
              } else {
                wrapperMap.current.delete(pet.id)
              }
            }}
            onClick={() => setSelectedPet(pet)}
          >
            <div className={styles.nameTag}>{pet.name}</div>
            <canvas
              ref={el => {
                if (el) {
                  canvasMap.current.set(pet.id, el)
                  spawnPet(pet)
                } else {
                  canvasMap.current.delete(pet.id)
                }
              }}
              width={PET_SIZE}
              height={PET_SIZE}
              className={styles.petCanvas}
            />
          </div>
        ))}

        {selectedPet && (
          <>
            <div className={styles.overlay} onClick={() => setSelectedPet(null)} />
            <div className={styles.card}>
              <button className={styles.closeBtn} onClick={() => setSelectedPet(null)}>✕</button>
              <div className={styles.cardName}>{selectedPet.name}</div>
              <div className={styles.cardRow}>Owner: Anonymous</div>
              <div className={styles.cardRow}>Joined: {formatDate(selectedPet.createdAt)}</div>
              <div className={styles.cardRow}>❤️ {likes[selectedPet.id] ?? 0} likes</div>
              {!selectedPet.isOwn && (
                <button
                  className={styles.likeBtn}
                  onClick={() => handleLike(selectedPet.id)}
                >
                  ❤️ LIKE
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
