import { useState, useEffect } from 'react'
import { useAuthStore, signOut } from '../lib/auth'
import { supabase } from '../lib/supabase'
import styles from './AuthButton.module.css'

export default function AuthButton() {
  const { userId } = useAuthStore()
  const [displayName, setDisplayName] = useState('G')

  useEffect(() => {
    if (!userId) return
    supabase.auth.getUser().then(({ data: { user } }) => {
      const name = user?.user_metadata?.full_name
        ?? user?.user_metadata?.name
        ?? user?.email?.split('@')[0]
        ?? 'G'
      setDisplayName(name.length > 10 ? name.slice(0, 10) : name)
    }).catch(() => {})
  }, [userId])

  if (!userId) return null

  return (
    <div className={styles.group}>
      <div className={styles.avatar}>{displayName}</div>
      <button className={styles.signOutBtn} onClick={signOut}>SIGN OUT</button>
    </div>
  )
}
