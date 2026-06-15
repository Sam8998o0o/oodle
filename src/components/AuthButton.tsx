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
      const name = user?.email?.split('@')[0] ?? ''
      if (name) setDisplayName(name.length > 8 ? name.slice(0, 8) : name)
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
