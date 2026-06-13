import { useState, useEffect, useCallback } from 'react'
import { postShout, getActiveShouts, countTodayShouts, likeShout } from '../lib/petService'

const SHOUT_DURATION_MS = 15_000

export interface ActiveShout {
  message: string
  shoutId: string
}

export interface UseShoutResult {
  shoutInput:    string
  setShoutInput: React.Dispatch<React.SetStateAction<string>>
  shoutLeft:     number
  activeShouts:  Record<string, ActiveShout>
  likedShouts:   Set<string>
  handleShout:   () => Promise<void>
  handleLikeShout: (shoutId: string) => void
}

export function useShouts(dailyShoutLimit: number): UseShoutResult {
  const [shoutInput,   setShoutInput]   = useState('')
  const [shoutLeft,    setShoutLeft]    = useState(dailyShoutLimit)
  const [activeShouts, setActiveShouts] = useState<Record<string, ActiveShout>>({})
  const [likedShouts,  setLikedShouts]  = useState<Set<string>>(new Set())

  // ── Load today's shout count on mount ─────────────────
  useEffect(() => {
    countTodayShouts()
      .then(n => setShoutLeft(dailyShoutLimit - n))
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Poll active shouts every 5 s ──────────────────────
  useEffect(() => {
    const poll = async () => {
      const shouts = await getActiveShouts().catch(() => [])
      const ownSupabaseId = localStorage.getItem('oodle_pet_supabase_id')
      const byPet: Record<string, ActiveShout> = {}
      for (const s of shouts) {
        const key = s.pet_id === ownSupabaseId ? 'own' : s.pet_id
        if (!byPet[key]) byPet[key] = { message: s.message, shoutId: s.id }
      }
      setActiveShouts(prev => {
        const ownShout    = prev['own']
        const serverHasOwn = !!byPet['own']
        if (ownShout && !serverHasOwn && ownShout.shoutId.startsWith('local_')) {
          return { ...byPet, ['own']: ownShout }
        }
        return byPet
      })
    }
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [])

  const handleShout = useCallback(async () => {
    const message = shoutInput.trim()
    if (!message || shoutLeft <= 0) return

    setShoutInput('')
    setShoutLeft(n => n - 1)

    const localShoutId = `local_${Date.now()}`
    setActiveShouts(prev => ({ ...prev, ['own']: { message, shoutId: localShoutId } }))

    setTimeout(() => {
      setActiveShouts(prev => {
        const current = prev['own']
        if (!current || current.shoutId !== localShoutId) return prev
        const next = { ...prev }
        delete next['own']
        return next
      })
    }, SHOUT_DURATION_MS)

    const supabaseId = localStorage.getItem('oodle_pet_supabase_id')
    if (supabaseId) {
      const shoutId = await postShout(supabaseId, message).catch(() => null)
      if (shoutId) {
        setActiveShouts(prev => {
          const current = prev['own']
          if (!current) return prev
          return { ...prev, ['own']: { message, shoutId } }
        })
      }
    }
  }, [shoutInput, shoutLeft])

  const handleLikeShout = useCallback((shoutId: string) => {
    if (likedShouts.has(shoutId)) return
    setLikedShouts(prev => new Set([...prev, shoutId]))
    likeShout(shoutId).catch(() => {})

    const todayKey = new Date().toDateString()
    const raw      = localStorage.getItem('oodle_daily_plaza_likes') ?? '{"date":"","count":0}'
    const likeData = JSON.parse(raw) as { date: string; count: number }
    if (likeData.date === todayKey) likeData.count += 1
    else { likeData.date = todayKey; likeData.count = 1 }
    localStorage.setItem('oodle_daily_plaza_likes', JSON.stringify(likeData))
  }, [likedShouts])

  return {
    shoutInput, setShoutInput,
    shoutLeft,
    activeShouts,
    likedShouts,
    handleShout,
    handleLikeShout,
  }
}
