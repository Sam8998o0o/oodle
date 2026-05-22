import { useState, useEffect, useRef } from 'react'
import { PetAnimator } from '../engine/PetAnimator'
import type { PetData } from '../App'
import styles from './ArrestedScene.module.css'

interface ArrestedSceneProps {
  petData: PetData
  onSubscribeClick: () => void
  onLoginClick: () => void
  isLoggedIn: boolean
}

export default function ArrestedScene({ petData, onSubscribeClick, onLoginClick, isLoggedIn }: ArrestedSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef   = useRef<PetAnimator | null>(null)
  const [shake, setShake] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const animator = new PetAnimator(canvas, {
      imageDataURL: petData.pixelData,
      coords:       petData.coords,
      size:         80,
      eyeStyle:     'eye_x',
    })
    animator.setState('sad')
    animator.start()
    animRef.current = animator
    return () => animator.stop()
  }, [petData])

  // Shake cage every few seconds
  useEffect(() => {
    const id = setInterval(() => {
      setShake(true)
      setTimeout(() => setShake(false), 500)
    }, 3000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <h1 className={styles.title}>OODLE</h1>

        <div className={styles.warningBox}>
          <span className={styles.warningIcon}>⚠️</span>
          <p className={styles.warningText}>FREE TRIAL ENDED</p>
          <span className={styles.warningIcon}>⚠️</span>
        </div>

        <p className={styles.desc}>Your pet has been taken away by the authorities!</p>

        {/* Cage */}
        <div className={`${styles.cage} ${shake ? styles.cageShake : ''}`}>
          {/* Bars */}
          {[0,1,2,3,4,5].map(i => (
            <div key={i} className={styles.bar} style={{ left: `${i * 18}%` }} />
          ))}
          {/* Pet inside */}
          <div className={styles.petInCage}>
            <canvas ref={canvasRef} width={80} height={80} style={{ imageRendering: 'pixelated' }} />
          </div>
          {/* Lock */}
          <div className={styles.lock}>🔒</div>
        </div>

        <p className={styles.petName}>{petData.name}</p>
        <p className={styles.sub}>Subscribe to set your pet free!</p>

        {/* Benefits */}
        <div className={styles.benefits}>
          <div className={styles.benefit}>✓ Keep your pet forever</div>
          <div className={styles.benefit}>✓ AI Generate your pet</div>
          <div className={styles.benefit}>✓ All eye styles unlocked</div>
          <div className={styles.benefit}>✓ 30 shouts/day</div>
        </div>

        <p className={styles.price}>$4.99 / MONTH</p>

        {isLoggedIn ? (
          <button className={styles.ctaBtn} onClick={onSubscribeClick}>
            🔓 FREE MY PET!
          </button>
        ) : (
          <>
            <button className={styles.ctaBtn} onClick={onLoginClick}>
              🔑 LOGIN TO SUBSCRIBE
            </button>
            <p className={styles.hint}>Login with Google first, then subscribe</p>
          </>
        )}

        <p className={styles.restore} onClick={onSubscribeClick}>
          Already subscribed? Restore
        </p>
      </div>
    </div>
  )
}
