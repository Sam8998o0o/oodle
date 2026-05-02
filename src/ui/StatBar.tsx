import styles from './StatBar.module.css'

interface StatBarProps {
  label: string
  value: number
  color: string
  maxWidth?: number
}

export default function StatBar({ label, value, color, maxWidth = 80 }: StatBarProps) {
  const clamped = Math.max(0, Math.min(100, value))

  const fillColor =
    clamped >= 70 ? color :
    clamped >= 40 ? '#F0C040' :
    '#FF5A5F'

  const blinking = clamped < 20

  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div className={styles.track} style={{ width: maxWidth }}>
        <div
          className={`${styles.fill} ${blinking ? styles.blink : ''}`}
          style={{ width: `${clamped}%`, backgroundColor: fillColor }}
        />
        {[25, 50, 75].map(pct => (
          <div
            key={pct}
            className={styles.tick}
            style={{ left: `${pct}%` }}
          />
        ))}
      </div>
      <span className={styles.number}>{Math.round(clamped)}</span>
    </div>
  )
}
