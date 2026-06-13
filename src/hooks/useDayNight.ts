import { useState, useEffect } from 'react'
import { getPetAge } from '../lib/petService'

export type WeatherType = 'clear' | 'rain' | 'thunder'

export interface DayNightResult {
  isNight:   boolean
  isBedtime: boolean
  isWeekend: boolean
  dayCount:  number
  setDayCount: React.Dispatch<React.SetStateAction<number>>
  weather:   WeatherType
}

function nowIsNight()    { const h = new Date().getHours(); return h >= 19 || h < 6  }
function nowIsBedtime()  { const h = new Date().getHours(); return h >= 22 || h < 6  }
function nowIsWeekend()  { const d = new Date().getDay();   return d === 0 || d === 6 }

export function useDayNight(): DayNightResult {
  const [isNight,   setIsNight]   = useState(nowIsNight)
  const [isBedtime, setIsBedtime] = useState(nowIsBedtime)
  const [isWeekend, setIsWeekend] = useState(nowIsWeekend)
  const [weather,   setWeather]   = useState<WeatherType>('clear')
  const [dayCount,  setDayCount]  = useState(1)

  // ── Time check (every minute) ───────────────────────────
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const h   = now.getHours()
      const d   = now.getDay()
      setIsNight(h >= 19 || h < 6)
      setIsBedtime(h >= 22 || h < 6)
      setIsWeekend(d === 0 || d === 6)
    }
    const id = setInterval(tick, 60000)
    return () => clearInterval(id)
  }, [])

  // ── Weather (changes every 20 min) ──────────────────────
  useEffect(() => {
    const pick = () => {
      const r = Math.random()
      if      (r < 0.60) setWeather('clear')
      else if (r < 0.85) setWeather('rain')
      else               setWeather('thunder')
    }
    const id = setInterval(pick, 20 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  // ── Day count (from localStorage / Supabase petAge) ────
  useEffect(() => {
    try {
      const d          = localStorage.getItem('oodle_day_count')
      const petCreated = localStorage.getItem('oodle_pet_created_at')
      if (petCreated) {
        const days = Math.floor((Date.now() - parseInt(petCreated, 10)) / 86_400_000) + 1
        setDayCount(days)
        localStorage.setItem('oodle_day_count', String(days))
      } else if (d) {
        setDayCount(parseInt(d, 10))
      }
    } catch { /* ignore */ }

    getPetAge().then(age => {
      if (age == null) return
      const streakRaw = localStorage.getItem('oodle_streak')
      let streakDays = 1
      try {
        if (streakRaw) streakDays = (JSON.parse(streakRaw) as { streak: number }).streak ?? 1
      } catch { /* ignore */ }
      const finalAge           = Math.max(age, streakDays - 1)
      const estimatedCreatedAt = Date.now() - finalAge * 86_400_000
      localStorage.setItem('oodle_pet_created_at', String(estimatedCreatedAt))
      setDayCount(finalAge + 1)
    }).catch(() => {})
  }, [])

  // ── Persist dayCount ────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('oodle_day_count', String(dayCount))
  }, [dayCount])

  return { isNight, isBedtime, isWeekend, dayCount, setDayCount, weather }
}
