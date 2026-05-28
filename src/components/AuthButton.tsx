import { useAuthStore, signOut } from '../lib/auth'
import styles from './AuthButton.module.css'

export default function AuthButton() {
  const { userId } = useAuthStore()

  // Not signed in — hide button (game requires Google sign-in to proceed)
  if (!userId) return null

  return (
    <div className={styles.group}>
      <div className={styles.avatar}>G</div>
      <button className={styles.signOutBtn} onClick={signOut}>SIGN OUT</button>
    </div>
  )
}
