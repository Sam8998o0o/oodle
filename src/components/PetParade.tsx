import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { PetAnimator } from '../engine/PetAnimator'
import { fetchParadePets, thumbsUpPet } from '../lib/petService'
import { initAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import type { PetRecord } from '../lib/petService'
import type { PetCoords } from '../api/aiRecognize'
import styles from './PetParade.module.css'

const DEFAULT_COORDS: PetCoords = {
  eyes:     [{ x: 0.35, y: 0.28 }, { x: 0.65, y: 0.28 }],
  legs:     [{ x: 0.25, y: 0.85 }, { x: 0.75, y: 0.85 }],
  center:   { x: 0.5, y: 0.5 },
  has_eyes: false,
  has_legs: false,
}

const IS_MOBILE = typeof window !== 'undefined' && window.innerWidth < 600
const MAX_PETS  = IS_MOBILE ? 6 : 10
const PET_SIZE  = IS_MOBILE ? 40 : 48

interface PosState {
  x:     number
  dir:   1 | -1
  speed: 1 | 2
}

interface BubbleData {
  petId:     string
  likeCount: number
  liked:     boolean
}

export default function PetParade() {
  const [pets, setPets]     = useState<PetRecord[]>([])
  const [bubble, setBubble] = useState<BubbleData | null>(null)

  const stripRef       = useRef<HTMLDivElement>(null)
  const wrapperRefs    = useRef<(HTMLDivElement | null)[]>([])
  const canvasRefs     = useRef<(HTMLCanvasElement | null)[]>([])
  const animatorsRef   = useRef<(PetAnimator | null)[]>([])
  const posRef         = useRef<PosState[]>([])
  const rafRef         = useRef(0)
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => { if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current) }
  }, [])

  useEffect(() => {
    fetchParadePets(MAX_PETS)
      .then(data => setPets(data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (pets.length === 0) return
    const strip = stripRef.current
    if (!strip) return

    const sw   = strip.offsetWidth
    const maxX = Math.max(0, sw - PET_SIZE)

    posRef.current = pets.map((_, i) => ({
      x:     Math.floor((sw / pets.length) * i),
      dir:   (Math.random() < 0.5 ? 1 : -1) as 1 | -1,
      speed: (1 + Math.round(Math.random())) as 1 | 2,
    }))

    pets.forEach((pet, i) => {
      const canvas = canvasRefs.current[i]
      if (!canvas) return
      const days = Math.max(1, Math.floor((Date.now() - new Date(pet.created_at).getTime()) / 86_400_000))
      const scale = days <= 10 ? 0.7 : days <= 20 ? 0.85 : 1.0
      const size = Math.round(PET_SIZE * scale)
      canvas.width  = size
      canvas.height = size
      const anim = new PetAnimator(canvas, {
        imageDataURL: pet.pixel_data,
        coords:       pet.coords ?? DEFAULT_COORDS,
        size,
      })
      anim.setState('walk')
      anim.start()
      animatorsRef.current[i] = anim
      const wrapper = wrapperRefs.current[i]
      if (wrapper) wrapper.style.left = `${posRef.current[i].x}px`
    })

    const tick = () => {
      posRef.current.forEach((pos, i) => {
        pos.x += pos.speed * pos.dir
        if (pos.x <= 0)    { pos.x = 0;    pos.dir =  1 }
        if (pos.x >= maxX) { pos.x = maxX; pos.dir = -1 }
        const wrapper = wrapperRefs.current[i]
        const canvas  = canvasRefs.current[i]
        if (wrapper) wrapper.style.left = `${pos.x}px`
        if (canvas)  canvas.style.transform = pos.dir === -1 ? 'scaleX(-1)' : ''
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      animatorsRef.current.forEach(a => a?.stop())
      animatorsRef.current = []
      wrapperRefs.current  = []
      canvasRefs.current   = []
    }
  }, [pets])

  const openBubble = async (petId: string) => {
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
    if (bubble?.petId === petId) { setBubble(null); return }

    let likeCount = 0
    await supabase
      .from('likes')
      .select('*', { count: 'exact', head: true })
      .eq('pet_id', petId)
      .then(({ count }) => { likeCount = count ?? 0 }, () => {})

    setBubble({ petId, likeCount, liked: false })
    bubbleTimerRef.current = setTimeout(() => setBubble(null), 2000)
  }

  const handleLike = async (e: MouseEvent<HTMLButtonElement>, petId: string) => {
    e.stopPropagation()
    if (bubble?.liked) return
    await initAuth()
    await thumbsUpPet(petId)
    setBubble(prev => prev ? { ...prev, liked: true, likeCount: prev.likeCount + 1 } : prev)
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
    bubbleTimerRef.current = setTimeout(() => setBubble(null), 2000)
  }

  if (pets.length === 0) return null

  return (
    <div className={styles.strip} ref={stripRef}>
      <div className={styles.label}>PETS MADE BY PLAYERS ↓</div>
      <div className={styles.ground} />
      {pets.map((pet, i) => {
        const dayCount = Math.max(1, Math.floor(
          (Date.now() - new Date(pet.created_at).getTime()) / 86_400_000,
        ))
        const isActive = bubble?.petId === pet.id
        return (
          <div
            key={pet.id}
            className={styles.petWrapper}
            ref={el => { wrapperRefs.current[i] = el }}
            onClick={() => openBubble(pet.id)}
          >
            {isActive && bubble && (
              <div className={styles.bubble}>
                <div className={styles.bubbleText}>
                  {pet.name} · DAY {dayCount} · ❤️ {bubble.likeCount}
                </div>
                <button
                  className={styles.likeBtn}
                  disabled={bubble.liked}
                  onClick={e => handleLike(e, pet.id)}
                >
                  {bubble.liked ? 'LIKED ✓' : '❤️ LIKE'}
                </button>
              </div>
            )}
            <div className={styles.petName}>{pet.name}</div>
            <canvas
              ref={el => { canvasRefs.current[i] = el }}
              className={styles.petCanvas}
            />
          </div>
        )
      })}
    </div>
  )
}
