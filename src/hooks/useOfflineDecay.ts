import { useState } from 'react'

export interface PetStats {
  hunger: number
  happy:  number
  energy: number
}

export type FaintStage = 'down' | 'sitting' | 'none'

// ── Offline decay constants (catch-up calc only) ────────────────────────────
const SLEEP_START_HOUR             = 22
const SLEEP_END_HOUR               = 8
const OFFLINE_SLEEP_RECOVERY_PER_H = 10
const OFFLINE_AWAKE_DRAIN_PER_H    = 8
const OFFLINE_ENERGY_FLOOR         = 30
const OFFLINE_ENERGY_CAP           = 100
const OFFLINE_HUNGER_DECAY_PER_H   = 3
const OFFLINE_HUNGER_FLOOR         = 5
const OFFLINE_FAINT_MIN_HOURS      = 48
const OFFLINE_HAPPY_DECAY_PER_H    = 2
const OFFLINE_HAPPY_FLOOR          = 20
const OFFLINE_MAX_HOURS            = 96
const RIP_THRESHOLD_HOURS          = 96

export interface OfflineDecayResult {
  initialStats:          PetStats
  offlineFaintStage:     FaintStage
  shouldShowWelcomeBack: boolean
}

function readFaintStage(): FaintStage {
  const raw = localStorage.getItem('oodle_offline_faint_stage')
  if (raw === 'down')    return 'down'
  if (raw === 'sitting') return 'sitting'
  return 'none'
}

function computeOfflineDecay(): OfflineDecayResult {
  try {
    const s        = localStorage.getItem('oodle_stats')
    const lastSeen = localStorage.getItem('oodle_last_seen')
    localStorage.setItem('oodle_last_seen', String(Date.now()))

    if (!s) {
      return { initialStats: { hunger: 80, happy: 80, energy: 80 }, offlineFaintStage: readFaintStage(), shouldShowWelcomeBack: false }
    }
    const p = JSON.parse(s) as PetStats
    if (!lastSeen) {
      return { initialStats: p, offlineFaintStage: readFaintStage(), shouldShowWelcomeBack: false }
    }

    const offlineMs    = Date.now() - parseInt(lastSeen, 10)
    const offlineHours = Math.min(OFFLINE_MAX_HOURS, offlineMs / 3_600_000)
    if (offlineHours < 1 / 60) {
      return { initialStats: p, offlineFaintStage: readFaintStage(), shouldShowWelcomeBack: false }
    }

    // Stash offline hours for welcome-back effect cleanup
    localStorage.setItem('oodle_offline_hours_on_return', String(offlineHours))

    if (offlineHours >= RIP_THRESHOLD_HOURS) {
      localStorage.setItem('oodle_rip_triggered', 'true')
    }

    let { hunger, happy, energy } = p
    const startMs    = parseInt(lastSeen, 10)
    const totalHours = Math.floor(offlineHours)

    // ENERGY: walk through each offline hour by local clock
    for (let h = 0; h < totalHours; h++) {
      const localHour = new Date(startMs + h * 3_600_000).getHours()
      const isSleepH  = localHour >= SLEEP_START_HOUR || localHour < SLEEP_END_HOUR
      energy = isSleepH
        ? Math.min(100, energy + OFFLINE_SLEEP_RECOVERY_PER_H)
        : Math.max(0,   energy - OFFLINE_AWAKE_DRAIN_PER_H)
    }
    energy = Math.max(OFFLINE_ENERGY_FLOOR, Math.min(OFFLINE_ENERGY_CAP, energy))
    hunger = Math.max(OFFLINE_HUNGER_FLOOR, hunger - offlineHours * OFFLINE_HUNGER_DECAY_PER_H)
    happy  = Math.max(OFFLINE_HAPPY_FLOOR,  happy  - offlineHours * OFFLINE_HAPPY_DECAY_PER_H)

    if (offlineHours >= OFFLINE_FAINT_MIN_HOURS && hunger <= OFFLINE_HUNGER_FLOOR) {
      localStorage.setItem('oodle_offline_faint_stage', 'down')
    }

    const offlineFaintStage = readFaintStage()
    const shouldShowWelcomeBack = offlineHours >= 6 && offlineFaintStage === 'none'

    return { initialStats: { hunger, happy, energy }, offlineFaintStage, shouldShowWelcomeBack }
  } catch {
    return { initialStats: { hunger: 80, happy: 80, energy: 80 }, offlineFaintStage: readFaintStage(), shouldShowWelcomeBack: false }
  }
}

export function useOfflineDecay(): OfflineDecayResult {
  const [result] = useState(computeOfflineDecay)
  return result
}
