import { useAuthStore, linkGoogle, signOut } from '../lib/auth'
import styles from './AuthButton.module.css'

export default function AuthButton() {
  const { userId, isAnonymous } = useAuthStore()

  // Don't render until auth is initialised
  if (!userId) return null

  if (isAnonymous) {
    return (
      <button className={styles.btn} onClick={linkGoogle}>
        🔑 LOGIN WITH GOOGLE
      </button>
    )
  }

  return (
    <div className={styles.group}>
      <div className={styles.avatar}>G</div>
      <button className={styles.signOutBtn} onClick={signOut}>SIGN OUT</button>
    </div>
  )
}
