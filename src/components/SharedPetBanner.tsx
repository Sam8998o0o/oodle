import { useEffect, useRef, useState } from 'react'
import { PetAnimator } from '../engine/PetAnimator'
import { getPetById, likePet } from '../lib/petService'
import { initAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import type { PetRecord } from '../lib/petService'
import type { PetCoords } from '../api/aiRecognize'
import styles from './SharedPetBanner.module.css'

const DEFAULT_COORDS: PetCoords = {
  eyes:     [{ x: 0.35, y: 0.28 }, { x: 0.65, y: 0.28 }],
  legs:     [{ x: 0.25, y: 0.85 }, { x: 0.75, y: 0.85 }],
  center:   { x: 0.5, y: 0.5 },
  has_eyes: false,
  has_legs: false,
}

interface SharedPetBannerProps {
  petId: string
}

export default function SharedPetBanner({ petId }: SharedPetBannerProps) {
  const [pet,       setPet]       = useState<PetRecord | null>(null)
  const [likeCount, setLikeCount] = useState(0)
  const [liked,     setLiked]     = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef   = useRef<PetAnimator | null>(null)

  useEffect(() => {
    getPetById(petId)
      .then(p => {
        if (!p) return
        setPet(p)
        supabase
          .from('likes')
          .select('*', { count: 'exact', head: true })
          .eq('pet_id', petId)
          .then(({ count }) => setLikeCount(count ?? 0), () => {})
      })
      .catch(() => {})
  }, [petId])

  useEffect(() => {
    if (!pet || !canvasRef.current) return
    const size   = window.innerWidth < 600 ? 32 : 48
    const canvas = canvasRef.current
    canvas.width  = size
    canvas.height = size
    const anim = new PetAnimator(canvas, {
      imageDataURL: pet.pixel_data,
      coords:       pet.coords ?? DEFAULT_COORDS,
      size,
    })
    anim.setState('idle')
    anim.start()
    animRef.current = anim
    return () => anim.stop()
  }, [pet])

  const handleLike = async () => {
    if (liked) return
    await initAuth()
    await likePet(petId)
    setLiked(true)
    setLikeCount(n => n + 1)
  }

  if (!pet) return null

  const dayCount = Math.max(1, Math.floor(
    (Date.now() - new Date(pet.created_at).getTime()) / 86_400_000,
  ))

  return (
    <div className={styles.banner}>
      <canvas ref={canvasRef} className={styles.petCanvas} />
      <div className={styles.info}>
        <div className={styles.name}>{pet.name}</div>
        <div className={styles.meta}>DAY {dayCount} &nbsp;·&nbsp; ❤ {likeCount}</div>
        <div className={styles.invite}>{pet.name} invited you to draw your own pet!</div>
      </div>
      <button
        className={styles.likeBtn}
        onClick={handleLike}
        disabled={liked}
      >
        {liked ? 'LIKED ✓' : '❤️ LIKE'}
      </button>
    </div>
  )
}
