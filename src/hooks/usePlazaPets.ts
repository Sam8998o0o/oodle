import { useState, useEffect, useRef, useCallback } from 'react'
import type { RefObject, Dispatch, SetStateAction } from 'react'
import { PetAnimator } from '../engine/PetAnimator'
import type { PetCoords } from '../api/aiRecognize'
import {
  fetchAllPets, getAllLikeCounts, pingOnline, updateGrowth,
} from '../lib/petService'
import { subscribeToNewPets } from '../lib/realtimeService'
import { useAuthStore } from '../lib/auth'
import { supabase } from '../lib/supabase'

const PET_SIZE    = 120
const LEFT_BOUND  = 80
const RIGHT_PAD   = 80
const WALK_Y_MIN  = 0.68
const WALK_Y_MAX  = 0.88
const WALK_SKY_MIN = 0.05
const WALK_SKY_MAX = 0.38

const DEFAULT_COORDS: PetCoords = {
  eyes:     [{ x: 0.35, y: 0.28 }, { x: 0.65, y: 0.28 }],
  legs:     [],
  center:   { x: 0.5, y: 0.5 },
  has_eyes: false,
  has_legs: false,
}

export interface PlazaPet {
  id:             string
  pixelData:      string
  coords:         PetCoords
  name:           string
  createdAt:      string
  isOwn:          boolean
  growth_points:  number
  talent?:        string
  talent_drawing?: string
  accessory?:     string | null
}

export interface PlazaShow {
  text:     string
  drawing?: string
}

export interface DrawingPerformance {
  petId:   string
  petX:    number
  petY:    number
  dataURL: string
}

interface Walker {
  x:      number
  y:      number
  dir:    number
  dirY:   number
  speed:  number
  speedY: number
}

function growthToSize(gp: number): number {
  return Math.round(60 + (Math.min(100, Math.max(0, gp)) / 100) * 100)
}

function mergePets(existing: PlazaPet[], incoming: PlazaPet[]): PlazaPet[] {
  const map = new Map<string, PlazaPet>()
  for (const p of existing) map.set(p.id, p)
  for (const p of incoming) map.set(p.id, p)
  return Array.from(map.values())
}

export interface UsePlazaPetsResult {
  pets:                  PlazaPet[]
  setPets:               Dispatch<SetStateAction<PlazaPet[]>>
  wrapperMap:            RefObject<Map<string, HTMLDivElement>>
  canvasMap:             RefObject<Map<string, HTMLCanvasElement>>
  animMap:               RefObject<Map<string, PetAnimator>>
  walkerMap:             RefObject<Map<string, Walker>>
  performingPets:        RefObject<Set<string>>
  plazaShows:            Record<string, PlazaShow>
  setPlazaShows:         Dispatch<SetStateAction<Record<string, PlazaShow>>>
  drawingPerformance:    DrawingPerformance | null
  setDrawingPerformance: Dispatch<SetStateAction<DrawingPerformance | null>>
  ownGlowing:            boolean
  likes:                 Record<string, number>
  setLikes:              Dispatch<SetStateAction<Record<string, number>>>
  spawnPet:              (pet: PlazaPet) => void
}

export function usePlazaPets(
  petData:   { pixelData: string; coords: PetCoords; name: string },
  petSize:   number,
  roomRef:   RefObject<HTMLDivElement | null>,
): UsePlazaPetsResult {

  const wrapperMap     = useRef(new Map<string, HTMLDivElement>())
  const canvasMap      = useRef(new Map<string, HTMLCanvasElement>())
  const animMap        = useRef(new Map<string, PetAnimator>())
  const walkerMap      = useRef(new Map<string, Walker>())
  const rafRef         = useRef(0)
  const petSizeRef     = useRef(petSize)
  const performingPets = useRef<Set<string>>(new Set())
  const spawnQueue     = useRef<PlazaPet[]>([])
  const propellerHats  = useRef<Set<string>>(new Set())
  const petsRef        = useRef<PlazaPet[]>([])

  const [pets,                setPets]                = useState<PlazaPet[]>([])
  const [likes,               setLikes]               = useState<Record<string, number>>({})
  const [ownGlowing,          setOwnGlowing]          = useState(true)
  const [plazaShows,          setPlazaShows]          = useState<Record<string, PlazaShow>>({})
  const [drawingPerformance,  setDrawingPerformance]  = useState<DrawingPerformance | null>(null)

  // Keep refs in sync
  useEffect(() => { petSizeRef.current = petSize }, [petSize])
  useEffect(() => { petsRef.current = pets }, [pets])

  // Own-pet glow fades after 8s
  useEffect(() => {
    const t = setTimeout(() => setOwnGlowing(false), 8000)
    return () => clearTimeout(t)
  }, [])

  // ── Spawn a pet into the walk system ──────────────────
  const spawnPet = useCallback((pet: PlazaPet) => {
    const alreadySpawned = animMap.current.has(pet.id)

    if (alreadySpawned) {
      if (!pet.isOwn) return
      const canvas  = canvasMap.current.get(pet.id)
      const newSize = petSizeRef.current
      if (canvas && canvas.width === newSize) return
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
      spawnQueue.current.push(pet)
      return
    }

    const room = roomRef.current
    if (!room) { spawnQueue.current.push(pet); return }
    const rW = room.offsetWidth
    const rH = room.offsetHeight
    if (rW === 0 || rH === 0) { spawnQueue.current.push(pet); return }

    const size = pet.isOwn ? petSizeRef.current : growthToSize(pet.growth_points)
    canvas.width  = size
    canvas.height = size
    wrapper.style.width  = `${size}px`
    wrapper.style.height = `${size + 20}px`

    const eyeStyle = localStorage.getItem('oodle_eye_style') ?? 'eye_round'
    const animator = new PetAnimator(canvas, {
      imageDataURL: pet.pixelData,
      coords:       pet.coords,
      size,
      eyeStyle,
    })
    animator.setState('walk')
    animator.start()
    animMap.current.set(pet.id, animator)

    if (pet.accessory === 'propeller') propellerHats.current.add(pet.id)
    else propellerHats.current.delete(pet.id)

    const isFlying   = pet.accessory === 'propeller'
    const yMin       = isFlying ? WALK_SKY_MIN : WALK_Y_MIN
    const yMax       = isFlying ? WALK_SKY_MAX : WALK_Y_MAX
    const rightBound = rW - RIGHT_PAD - size
    const yRatio     = yMin + Math.random() * (yMax - yMin)
    const y          = yRatio * rH - size
    const x          = LEFT_BOUND + Math.random() * (rightBound - LEFT_BOUND)
    const dir        = Math.random() < 0.5 ? 1 : -1
    const dirY       = Math.random() < 0.5 ? 1 : -1
    const speed      = isFlying ? 0.5 + Math.random() * 0.8 : 0.4 + Math.random() * 0.7
    const speedY     = isFlying ? 0.15 + Math.random() * 0.25 : 0.1 + Math.random() * 0.2

    const w: Walker = { x, y, dir, dirY, speed, speedY }
    walkerMap.current.set(pet.id, w)
    wrapper.style.left          = `${x}px`
    wrapper.style.top           = `${y}px`
    canvas.style.transform      = dir === -1 ? 'scaleX(-1)' : 'none'
    canvas.style.imageRendering = 'pixelated'
  }, [roomRef])

  // Re-spawn own pet when petSize changes (growth system) — after spawnPet is declared
  useEffect(() => {
    const ownPet = petsRef.current.find(p => p.isOwn)
    if (ownPet) spawnPet(ownPet)
  }, [petSize, spawnPet])

  // ── Walk loop — starts once on mount, never stops ─────
  useEffect(() => {
    const room = roomRef.current!

    const tick = () => {
      const rW = room.offsetWidth
      const rH = room.offsetHeight

      if (spawnQueue.current.length > 0) {
        const remaining: PlazaPet[] = []
        for (const pet of spawnQueue.current) {
          const canvas  = canvasMap.current.get(pet.id)
          const wrapper = wrapperMap.current.get(pet.id)
          if (canvas && wrapper && rW > 0) spawnPet(pet)
          else remaining.push(pet)
        }
        spawnQueue.current = remaining
      }

      walkerMap.current.forEach((w, id) => {
        if (performingPets.current.has(id)) return
        const wr = wrapperMap.current.get(id)
        const cv = canvasMap.current.get(id)
        if (!wr || !cv) return

        const sz        = cv.width > 0 ? cv.width : (id === 'own' ? petSizeRef.current : PET_SIZE)
        const ownRight  = rW - RIGHT_PAD - sz
        const isFlying  = propellerHats.current.has(id)
        const ownTop    = (isFlying ? WALK_SKY_MIN : WALK_Y_MIN) * rH - sz
        const ownBottom = (isFlying ? WALK_SKY_MAX : WALK_Y_MAX) * rH - sz

        const nextX = w.x + w.speed * w.dir
        if (nextX >= ownRight)    w.dir = -1
        else if (nextX <= LEFT_BOUND) w.dir = 1
        else w.x = nextX

        const nextY = w.y + w.speedY * w.dirY
        if (nextY >= ownBottom) w.dirY = -1
        else if (nextY <= ownTop) w.dirY = 1
        else w.y = nextY

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
  }, [spawnPet, roomRef])

  // ── Spawn / clean up when pets list changes ───────────
  useEffect(() => {
    for (const pet of pets) spawnPet(pet)
    const currentIds = new Set(pets.map(p => p.id))
    animMap.current.forEach((anim, id) => {
      if (!currentIds.has(id)) {
        anim.stop()
        animMap.current.delete(id)
        walkerMap.current.delete(id)
        const wrapper = wrapperMap.current.get(id)
        if (wrapper) wrapper.style.display = 'none'
      }
    })
  }, [pets, spawnPet])

  // ── Load pets ─────────────────────────────────────────
  useEffect(() => {
    const talentRaw = localStorage.getItem('oodle_daily_talent')
    let ownTalent: string | undefined
    let ownTalentDrawing: string | undefined
    try {
      if (talentRaw) {
        const t = JSON.parse(talentRaw) as { date: string; talent: string; drawing?: string }
        // No date restriction — pet keeps their most recently learned talent permanently
        ownTalent = t.talent || (t.drawing ? 'drawing' : undefined)
        if (ownTalent === 'drawing') {
          // oodle_talent_drawing persists across days; fall back to today's inline copy
          ownTalentDrawing = localStorage.getItem('oodle_talent_drawing') ?? t.drawing ?? undefined
        }
      }
    } catch { /* ignore */ }

    const ownPet: PlazaPet = {
      id:             'own',
      pixelData:      petData.pixelData,
      coords:         petData.coords,
      name:           petData.name,
      createdAt:      new Date().toISOString(),
      isOwn:          true,
      growth_points:  parseInt(localStorage.getItem('oodle_growth') ?? '0', 10),
      talent:         ownTalent,
      talent_drawing: ownTalentDrawing,
      accessory:      localStorage.getItem('oodle_accessory') ?? null,
    }
    setPets([ownPet])

    // Sync latest talent to Supabase on Plaza enter so other users always see
    // the most recent trick (guards against saveTalent failing at learn-time)
    const syncPetId = localStorage.getItem('oodle_pet_supabase_id')
    if (syncPetId && ownTalent) {
      const update: Record<string, string> = { talent: ownTalent }
      if (ownTalent === 'drawing' && ownTalentDrawing) update.talent_drawing = ownTalentDrawing
      supabase.from('pets').update(update).eq('id', syncPetId).then(() => {})
    }

    const loadFromSupabase = async () => {
      const [records, likeCounts] = await Promise.all([
        fetchAllPets(),
        getAllLikeCounts(),
      ])
      const ownSupabaseId = localStorage.getItem('oodle_pet_supabase_id')
      const ownUserId     = useAuthStore.getState().userId
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
          growth_points:  r.growth_points ?? 0,
          talent:         r.talent,
          talent_drawing: r.talent_drawing,
          accessory:      r.accessory ?? null,
        }))
      setPets(prev => mergePets(prev, [ownPet, ...others]))
      setLikes(likeCounts)
    }

    loadFromSupabase()
    updateGrowth().catch(() => {})
  }, [petData])

  // ── Online presence heartbeat ─────────────────────────
  useEffect(() => {
    pingOnline()
    const id = setInterval(pingOnline, 10_000)
    return () => clearInterval(id)
  }, [])

  // ── Auto-performance of tricks (every 45 s) ───────────
  useEffect(() => {
    const interval = setInterval(() => {
      const performers = petsRef.current.filter(p => p.talent || p.talent_drawing)
      if (performers.length === 0) return
      const pet = performers[Math.floor(Math.random() * performers.length)]

      let text = ''
      let drawing: string | undefined

      if (pet.talent === 'sing') {
        performingPets.current.add(pet.id)
        setPlazaShows(prev => ({ ...prev, [pet.id]: { text: '🎵 La la la~' } }))
        setTimeout(() => {
          setPlazaShows(prev => { const next = { ...prev }; delete next[pet.id]; return next })
          performingPets.current.delete(pet.id)
        }, 10000)
        return
      } else if (pet.talent === 'dance') {
        text = '💃 Watch me!'
        animMap.current.get(pet.id)?.setState('dance')
      } else if (pet.talent === 'magic') {
        const anim   = animMap.current.get(pet.id)
        const walker = walkerMap.current.get(pet.id)
        if (!walker) return
        performingPets.current.add(pet.id)
        if (anim) anim.setState('idle')
        const canvas = canvasMap.current.get(pet.id)
        if (canvas) canvas.style.opacity = '0'
        setTimeout(() => {
          const newX = Math.random() * (window.innerWidth - 100)
          walker.x   = newX
          const wrapper = wrapperMap.current.get(pet.id)
          if (wrapper) wrapper.style.left = `${newX}px`
          if (canvas) canvas.style.opacity = '1'
          if (anim) anim.setState('walk')
          setTimeout(() => {
            setPlazaShows(prev => ({ ...prev, [pet.id]: { text: '✨ Ta-da Magic!' } }))
            setTimeout(() => {
              setPlazaShows(prev => { const next = { ...prev }; delete next[pet.id]; return next })
              performingPets.current.delete(pet.id)
            }, 3000)
          }, 500)
        }, 4000)
        return
      } else if (pet.talent === 'drawing' && pet.talent_drawing) {
        const walker = walkerMap.current.get(pet.id)
        const petX   = walker ? walker.x : window.innerWidth / 2
        const petY   = walker ? walker.y : window.innerHeight / 2
        setDrawingPerformance({ petId: pet.id, petX, petY, dataURL: pet.talent_drawing })
        setPlazaShows(prev => ({ ...prev, [pet.id]: { text: '🎨 Watch me draw!', drawing: pet.talent_drawing } }))
        const anim = animMap.current.get(pet.id)
        if (anim) anim.setState('draw')
        performingPets.current.add(pet.id)
        setTimeout(() => {
          setDrawingPerformance(null)
          setPlazaShows(prev => { const next = { ...prev }; delete next[pet.id]; return next })
          animMap.current.get(pet.id)?.setState('walk')
          performingPets.current.delete(pet.id)
        }, 8000)
        return
      } else if (pet.talent_drawing) {
        text    = '🎨 I made this!'
        drawing = pet.talent_drawing
      }

      if (!text) return
      performingPets.current.add(pet.id)
      setPlazaShows(prev => ({ ...prev, [pet.id]: { text, drawing } }))
      setTimeout(() => {
        setPlazaShows(prev => { const next = { ...prev }; delete next[pet.id]; return next })
        performingPets.current.delete(pet.id)
      }, 4000)
    }, 45000)
    return () => clearInterval(interval)
  }, [])

  // ── Poll for new pets every 10 s ──────────────────────
  useEffect(() => {
    const poll = setInterval(async () => {
      const records       = await fetchAllPets()
      const ownSupabaseId = localStorage.getItem('oodle_pet_supabase_id')
      const ownUserId     = useAuthStore.getState().userId
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
            growth_points:  r.growth_points ?? 0,
            talent:         r.talent,
            talent_drawing: r.talent_drawing,
            accessory:      r.accessory ?? null,
          }))
        const ownPet = prev.find(p => p.isOwn)
        return ownPet ? [ownPet, ...newOthers] : newOthers
      })
      getAllLikeCounts().then(counts => setLikes(counts)).catch(() => {})
    }, 10000)
    return () => clearInterval(poll)
  }, [])

  // ── Realtime new pets ─────────────────────────────────
  useEffect(() => {
    const ownSupabaseId = localStorage.getItem('oodle_pet_supabase_id')
    const ownUserId     = useAuthStore.getState().userId
    const unsubscribe   = subscribeToNewPets(newPet => {
      if (newPet.id === ownSupabaseId)         return
      if (newPet.user_id === ownUserId)        return
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
          growth_points:  newPet.growth_points ?? 0,
          talent:         newPet.talent,
          talent_drawing: newPet.talent_drawing,
          accessory:      newPet.accessory ?? null,
        }]
      })
    })
    return unsubscribe
  }, [petData.pixelData])

  return {
    pets, setPets,
    wrapperMap, canvasMap, animMap, walkerMap,
    performingPets,
    plazaShows,  setPlazaShows,
    drawingPerformance, setDrawingPerformance,
    ownGlowing,
    likes, setLikes,
    spawnPet,
  }
}
