import { useRef, useEffect } from 'react'
import { PetAnimator } from '../engine/PetAnimator'
import type { PetCoords } from '../api/aiRecognize'
import { checkSubscription } from '../lib/petService'
import { createCheckoutSession } from '../lib/stripe'
import styles from './PaywallScene.module.css'

interface PaywallSceneProps {
  petData: { pixelData: string; coords: PetCoords; name: string } | null
  isLoggedIn: boolean
  userId: string | null
  onSubscribed: () => void
  onLoginAndSubscribe: () => void
}

const DEFAULT_COORDS: PetCoords = {
  eyes:     [{ x: 0.35, y: 0.28 }, { x: 0.65, y: 0.28 }],
  legs:     [],
  center:   { x: 0.5, y: 0.5 },
  has_eyes: false,
  has_legs: false,
}

export default function PaywallScene({
  petData,
  isLoggedIn,
  userId,
  onSubscribed,
  onLoginAndSubscribe,
}: PaywallSceneProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const animatorRef = useRef<PetAnimator | null>(null)

  useEffect(() => {
    if (!petData || !canvasRef.current) return
    const eyeStyle = localStorage.getItem('oodle_eye_style') ?? 'eye_round'
    const animator = new PetAnimator(canvasRef.current, {
      imageDataURL: petData.pixelData,
      coords:       petData.coords ?? DEFAULT_COORDS,
      size:         120,
      eyeStyle,
    })
    animatorRef.current = animator
    animator.setState('sad')
    animator.start()
    return () => animator.stop()
  }, [petData])

  const handleSubscribe = async () => {
    if (isLoggedIn && userId) {
      const url = await createCheckoutSession(userId)
      if (url) window.location.href = url
    } else {
      onLoginAndSubscribe()
    }
  }

  const handleRestore = async () => {
    const ok = await checkSubscription()
    if (ok) onSubscribed()
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>YOUR PET MISSES YOU</h1>

        {petData && (
          <div className={styles.petPreview}>
            <canvas
              ref={canvasRef}
              width={120}
              height={120}
              className={styles.petCanvas}
            />
          </div>
        )}

        <p className={styles.subtitle}>14-day free trial ended</p>

        <ul className={styles.benefits}>
          <li>✓ Keep your pet alive forever</li>
          <li>✓ AI Generate your pet (Gemini)</li>
          <li>✓ All eye styles unlocked</li>
          <li>✓ 30 shouts/day (vs 10 free)</li>
          <li>✓ More features coming soon</li>
        </ul>

        <div className={styles.price}>$4.99 / MONTH</div>

        <button className={styles.subscribeBtn} onClick={handleSubscribe}>
          SUBSCRIBE NOW
        </button>

        <p className={styles.restoreRow}>
          Already subscribed?{' '}
          <button className={styles.restoreBtn} onClick={handleRestore}>
            RESTORE
          </button>
        </p>
      </div>
    </div>
  )
}
