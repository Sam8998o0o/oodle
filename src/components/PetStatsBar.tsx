import StatBar from '../ui/StatBar'
import styles from './PetStatsBar.module.css'

interface PetStatsBarsProps {
  hunger: number
  happy:  number
  energy: number
}

export default function PetStatsBar({ hunger, happy, energy }: PetStatsBarsProps) {
  return (
    <div className={styles.hud}>
      <StatBar label="🍖" value={hunger} color="var(--color-hunger)" maxWidth={80} />
      <StatBar label="💛" value={happy}  color="var(--color-happy)"  maxWidth={80} />
      <StatBar label="⚡" value={energy} color="var(--color-energy)" maxWidth={80} />
    </div>
  )
}
