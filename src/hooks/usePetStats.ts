import { useState, useEffect, useRef, useCallback } from 'react'
import type { RefObject, Dispatch, SetStateAction } from 'react'
import { PetAnimator } from '../engine/PetAnimator'
import { getLikeBalance, redeemLikesForFood, getShoutOwner } from '../lib/petService'
import { useAuthStore } from '../lib/auth'
import { supabase } from '../lib/supabase'
import type { PetStats } from './useOfflineDecay'
import type { FaintStage } from './useOfflineDecay'

export type { PetStats }

const SMALL_HUNGER    = 10
const BIG_HUNGER      = 20
const STARVING_THRESHOLD = 20

const FEED_LINES = ['Yummy!', 'Thank you!', 'So good!']
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

interface UsePetStatsInput {
  initialStats:             PetStats
  initialOfflineFaintStage: FaintStage
  isWeekend:                boolean
  animatorRef:              RefObject<PetAnimator | null>
  isSleepingRef:            RefObject<boolean>
  setIsSleeping:            Dispatch<SetStateAction<boolean>>
  roomRef:                  RefObject<HTMLDivElement | null>
  petWrapperRef:            RefObject<HTMLDivElement | null>
  walkRafRef:               RefObject<number>
  petSize:                  number
  showBubble:               (text: string) => void
  showFloat:                (char: string) => void
}

export interface UsePetStatsResult {
  stats:                PetStats
  setStats:             Dispatch<SetStateAction<PetStats>>
  statsRef:             RefObject<PetStats>
  likeBalance:          number
  setLikeBalance:       Dispatch<SetStateAction<number>>
  smallFood:            number
  setSmallFood:         Dispatch<SetStateAction<number>>
  bigFood:              number
  setBigFood:           Dispatch<SetStateAction<number>>
  todayEats:            number
  setTodayEats:         Dispatch<SetStateAction<number>>
  isFainted:            boolean
  setIsFainted:         Dispatch<SetStateAction<boolean>>
  isFaintedRef:         RefObject<boolean>
  offlineFaintStage:    FaintStage
  setOfflineFaintStage: Dispatch<SetStateAction<FaintStage>>
  offlineFaintStageRef: RefObject<FaintStage>
  handleFeed:           (size: 'small' | 'big') => void
  handleRedeemSmall:    () => Promise<void>
  handleRedeemBig:      () => Promise<void>
}

export function usePetStats({
  initialStats,
  initialOfflineFaintStage,
  isWeekend,
  animatorRef,
  isSleepingRef,
  setIsSleeping,
  roomRef,
  petWrapperRef,
  walkRafRef,
  petSize,
  showBubble,
  showFloat,
}: UsePetStatsInput): UsePetStatsResult {

  const [stats, setStats] = useState<PetStats>(initialStats)
  const statsRef = useRef<PetStats>(initialStats)

  const [likeBalance,  setLikeBalance]  = useState(0)
  const [smallFood,    setSmallFood]    = useState(() => {
    try { const fs = localStorage.getItem('oodle_food_state'); if (fs) return JSON.parse(fs).smallFood ?? 0; return 1 } catch { return 1 }
  })
  const [bigFood,   setBigFood]   = useState(() => {
    try { const fs = localStorage.getItem('oodle_food_state'); if (fs) return JSON.parse(fs).bigFood ?? 0; return 1 } catch { return 1 }
  })
  const [todayEats, setTodayEats] = useState(0)

  const [isFainted,     setIsFainted]     = useState(() =>
    initialOfflineFaintStage === 'down' || initialOfflineFaintStage === 'sitting'
  )
  const isFaintedRef = useRef(isFainted)

  const [offlineFaintStage, setOfflineFaintStage] = useState<FaintStage>(initialOfflineFaintStage)
  const offlineFaintStageRef = useRef<FaintStage>(offlineFaintStage)

  // ── Keep refs in sync ─────────────────────────────────
  useEffect(() => { statsRef.current = stats }, [stats])
  useEffect(() => { offlineFaintStageRef.current = offlineFaintStage }, [offlineFaintStage])

  // ── Persist stats ─────────────────────────────────────
  useEffect(() => { localStorage.setItem('oodle_stats', JSON.stringify(stats)) }, [stats])

  // ── Persist food state ────────────────────────────────
  useEffect(() => {
    localStorage.setItem('oodle_food_state', JSON.stringify({
      smallFood, bigFood, todayEats,
      eatDate: new Date().toDateString(),
    }))
  }, [smallFood, bigFood, todayEats])

  // ── Load food state from localStorage on mount ───────
  useEffect(() => {
    try {
      const fs = localStorage.getItem('oodle_food_state')
      if (!fs) return
      const fp = JSON.parse(fs) as { smallFood?: number; bigFood?: number; todayEats?: number; eatDate?: string }
      const today = new Date().toDateString()
      setTodayEats(fp.eatDate === today ? (fp.todayEats ?? 0) : 0)
    } catch { /* ignore */ }
  }, [])

  // ── Stat decay (halved on weekends) ──────────────────
  useEffect(() => {
    const interval = isWeekend ? 60000 : 30000
    const decay = setInterval(() => {
      if (isSleepingRef.current) {
        setStats(s => ({
          hunger: Math.max(0, s.hunger - 0.04),
          happy:  Math.max(0, s.happy  - 0.03),
          energy: s.energy,
        }))
      } else {
        setStats(s => ({
          hunger: Math.max(0, s.hunger - 0.08),
          happy:  Math.max(0, s.happy  - 0.06),
          energy: Math.max(0, s.energy - 0.11),
        }))
      }

      // Death by starvation: track how long hunger has been 0
      if (statsRef.current.hunger <= 0) {
        const zeroSince = localStorage.getItem('oodle_hunger_zero_since')
        if (!zeroSince) {
          localStorage.setItem('oodle_hunger_zero_since', String(Date.now()))
        }
        // Note: actual kill is handled in RoomScene savePet effect
      } else {
        localStorage.removeItem('oodle_hunger_zero_since')
      }
    }, interval)
    return () => clearInterval(decay)
  }, [isWeekend, isSleepingRef])

  // ── Auto sleep (energy-based) ─────────────────────────
  useEffect(() => {
    const check = setInterval(() => {
      const s        = statsRef.current
      const animator = animatorRef.current
      if (!animator) return
      if (isFaintedRef.current) return

      if (!isSleepingRef.current && s.energy <= 0) {
        isSleepingRef.current = true
        setIsSleeping(true)
        animator.setState('sleep')
        setTimeout(() => {
          const r = roomRef.current
          const w = petWrapperRef.current
          if (r && w && r.offsetWidth > 0) {
            const cx = Math.round((r.offsetWidth - petSize) / 2)
            w.style.left = `${cx}px`
          }
        }, 200)
        showBubble('Zzz... 💤')
      } else if (isSleepingRef.current && s.energy < 100) {
        if (s.hunger > 20 && s.happy > 20) {
          showBubble('Zzz... 💤')
        }
        setStats(prev => ({ ...prev, energy: Math.min(100, prev.energy + 0.14) }))
      } else if (isSleepingRef.current && s.energy >= 100) {
        isSleepingRef.current = false
        setIsSleeping(false)
        animator.setState('walk')
      }
    }, 5000)
    return () => clearInterval(check)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animatorRef, isFaintedRef, isSleepingRef, petSize, roomRef, petWrapperRef, setIsSleeping, showBubble])

  // ── Faint detection (online: hunger drops to 0) ───────
  useEffect(() => {
    if (stats.hunger <= 0 && !isFaintedRef.current) {
      isFaintedRef.current = true
      setIsFainted(true)
      if (walkRafRef.current) cancelAnimationFrame(walkRafRef.current)
      const room    = roomRef.current
      const wrapper = petWrapperRef.current
      if (room && wrapper) {
        const centerX = Math.round((room.offsetWidth - petSize) / 2)
        wrapper.style.left = `${centerX}px`
      }
      animatorRef.current?.setState('faint')
      showBubble('So hungry... 😵')
    }
  }, [stats.hunger, showBubble, petSize, animatorRef, roomRef, petWrapperRef, walkRafRef])

  // ── Keep faint state on animator (in case animator reinits) ─
  useEffect(() => {
    if (isFainted) {
      animatorRef.current?.setState('faint')
    }
  }, [isFainted, animatorRef])

  // ── Like balance: initial fetch on mount ────
  useEffect(() => {
    getLikeBalance().then(b => setLikeBalance(b)).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Shout-like notifications ──────────────────────────
  useEffect(() => {
    const userId = useAuthStore.getState().userId
    if (!userId) return

    const channel = supabase
      .channel('shout-likes-notify-' + userId)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'shout_likes',
      }, (payload: { new: Record<string, unknown> }) => {
        const row = payload.new as { shout_id: string; user_id: string }
        // Don't notify if the current user liked their own shout
        if (row.user_id === userId) return
        void getShoutOwner(row.shout_id).then(owner => {
          if (owner === userId) showBubble('Someone liked your shout! 💬❤️')
        })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Feed ─────────────────────────────────────────────
  const handleFeed = useCallback((size: 'small' | 'big') => {
    if (size === 'small') {
      if (smallFood <= 0) { showBubble('Redeem likes for snacks! ❤️'); return }
      setSmallFood((f: number) => f - 1)
      setStats(s => ({ ...s, hunger: Math.min(100, s.hunger + SMALL_HUNGER) }))
    } else {
      if (bigFood <= 0) { showBubble('Redeem likes for meals! ❤️'); return }
      setBigFood((f: number) => f - 1)
      setStats(s => ({ ...s, hunger: Math.min(100, s.hunger + BIG_HUNGER) }))
    }
    setTodayEats(n => n + 1)
    showFloat('🍖')

    // Offline-faint two-feed recovery
    if (isFaintedRef.current && offlineFaintStageRef.current === 'down') {
      setOfflineFaintStage('sitting')
      offlineFaintStageRef.current = 'sitting'
      localStorage.setItem('oodle_offline_faint_stage', 'sitting')
      animatorRef.current?.setState('idle')
      showBubble('Still weak... feed me again 🥺')
      return
    }
    if (isFaintedRef.current && offlineFaintStageRef.current === 'sitting') {
      setOfflineFaintStage('none')
      offlineFaintStageRef.current = 'none'
      localStorage.removeItem('oodle_offline_faint_stage')
      isFaintedRef.current = false
      setIsFainted(false)
    }

    showBubble(pick(FEED_LINES))
    if (!isSleepingRef.current) animatorRef.current?.setState('eat')

    // Recover from online faint (one feed)
    if (isFaintedRef.current) {
      isFaintedRef.current = false
      setIsFainted(false)
      animatorRef.current?.setState('walk')
    }
    setTimeout(() => { if (!isSleepingRef.current) animatorRef.current?.setState('walk') }, 2000)
  }, [smallFood, bigFood, showFloat, showBubble, animatorRef, isSleepingRef])

  // ── Like → food redemption ────────────────────────────
  const handleRedeemSmall = useCallback(async () => {
    if (likeBalance < 5) return
    const ok = await redeemLikesForFood(5)
    if (ok) {
      setSmallFood((f: number) => f + 1)
      setLikeBalance((b: number) => b - 5)
      showFloat('🍎')
      showBubble('Got a snack!')
    }
  }, [likeBalance, showFloat, showBubble])

  const handleRedeemBig = useCallback(async () => {
    if (likeBalance < 10) return
    const ok = await redeemLikesForFood(10)
    if (ok) {
      setBigFood((f: number) => f + 1)
      setLikeBalance((b: number) => b - 10)
      showFloat('🍱')
      showBubble('Got a meal!')
    }
  }, [likeBalance, showFloat, showBubble])

  return {
    stats,          setStats,        statsRef,
    likeBalance,    setLikeBalance,
    smallFood,      setSmallFood,
    bigFood,        setBigFood,
    todayEats,      setTodayEats,
    isFainted,      setIsFainted,    isFaintedRef,
    offlineFaintStage, setOfflineFaintStage, offlineFaintStageRef,
    handleFeed,
    handleRedeemSmall,
    handleRedeemBig,
  }
}

// Re-export for callers that destructure STARVING_THRESHOLD
export { STARVING_THRESHOLD }
