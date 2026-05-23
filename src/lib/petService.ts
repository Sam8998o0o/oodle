import { supabase } from './supabase'
import { useAuthStore } from './auth'
import type { PetCoords } from '../api/aiRecognize'

// ── Types ─────────────────────────────────────────────────
export interface PetRecord {
  id:         string
  user_id:    string
  name:       string
  pixel_data: string
  coords:     PetCoords | null
  created_at: string
  is_online:  boolean
}

// localStorage key used to avoid re-inserting the same pet
const LOCAL_PET_ID_KEY = 'oodle_pet_supabase_id'

// ── savePet ───────────────────────────────────────────────
// Inserts the user's pet into Supabase once.
// Subsequent calls (e.g. after a page refresh) are no-ops
// because the id is cached in localStorage.
// Returns the Supabase pet id, or null on failure.
export async function savePet(pet: {
  name:      string
  pixelData: string
  coords:    PetCoords
}): Promise<string | null> {
  const userId = useAuthStore.getState().userId
  if (!userId) return null

  // Idempotency: don't insert a second time for the same browser session
  const cached = localStorage.getItem(LOCAL_PET_ID_KEY)
  if (cached) return cached

  const { data, error } = await supabase
    .from('pets')
    .insert({
      user_id:    userId,
      name:       pet.name,
      pixel_data: pet.pixelData,
      coords:     pet.coords,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[petService] savePet failed:', error.message)
    return null
  }

  const id = data?.id ?? null
  if (id) localStorage.setItem(LOCAL_PET_ID_KEY, id)
  return id
}

// ── setOnline ────────────────────────────────────────────
// Marks the current user's pet as online or offline in Supabase.
export async function setOnline(online: boolean): Promise<void> {
  const petId = localStorage.getItem('oodle_pet_supabase_id')
  if (!petId) return
  const { error } = await supabase
    .from('pets')
    .update({ is_online: online })
    .eq('id', petId)
  if (error) console.error('[petService] setOnline failed:', error.message)
}

// ── fetchAllPets ──────────────────────────────────────────
// Returns up to 50 recent pets from Supabase.
// Returns [] on failure (caller should fall back to localStorage).
export async function fetchAllPets(): Promise<PetRecord[]> {
  const { data, error } = await supabase
    .from('pets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[petService] fetchAllPets failed:', error.message)
    return []
  }

  return (data ?? []) as PetRecord[]
}

// ── getAllLikeCounts ───────────────────────────────────────
// Returns a map of petId → like count for all pets.
// Returns {} on failure.
export async function getAllLikeCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('likes')
    .select('pet_id')

  if (error) {
    console.error('[petService] getAllLikeCounts failed:', error.message)
    return {}
  }

  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    counts[row.pet_id as string] = (counts[row.pet_id as string] ?? 0) + 1
  }
  return counts
}

// ── likePet ───────────────────────────────────────────────
// Inserts a like row. Silently ignores duplicates (UNIQUE constraint).
export async function likePet(petId: string): Promise<void> {
  const userId = useAuthStore.getState().userId
  if (!userId) return

  const { error } = await supabase
    .from('likes')
    .insert({ pet_id: petId, user_id: userId })

  // error code 23505 = unique_violation → user already liked this pet → fine
  if (error && error.code !== '23505') {
    console.error('[petService] likePet failed:', error.message)
  }
}

// ── countTodayLikes ───────────────────────────────────────
// Returns how many distinct pets the current user has liked today.
export async function countTodayLikes(): Promise<number> {
  const userId = useAuthStore.getState().userId
  if (!userId) return 0

  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const { count, error } = await supabase
    .from('likes')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', startOfDay.toISOString())

  if (error) {
    console.error('[petService] countTodayLikes failed:', error.message)
    return 0
  }
  return count ?? 0
}

// ── getTodayLikedPetIds ───────────────────────────────────
// Returns the set of pet ids the current user has liked today.
export async function getTodayLikedPetIds(): Promise<Set<string>> {
  const userId = useAuthStore.getState().userId
  if (!userId) return new Set()

  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const { data, error } = await supabase
    .from('likes')
    .select('pet_id')
    .eq('user_id', userId)
    .gte('created_at', startOfDay.toISOString())

  if (error) {
    console.error('[petService] getTodayLikedPetIds failed:', error.message)
    return new Set()
  }
  return new Set((data ?? []).map(r => r.pet_id as string))
}

// ══════════════════════════════════════════════════════════
// Shout system
// ══════════════════════════════════════════════════════════

export interface ShoutRecord {
  id:         string
  pet_id:     string
  user_id:    string
  message:    string
  created_at: string
}

// ── postShout ─────────────────────────────────────────────
// Creates a shout for the given pet. Returns the new shout id, or null on error.
export async function postShout(petId: string, message: string): Promise<string | null> {
  const userId = useAuthStore.getState().userId
  if (!userId) return null

  const { data, error } = await supabase
    .from('shouts')
    .insert({ pet_id: petId, user_id: userId, message })
    .select('id')
    .single()

  if (error) {
    console.error('[petService] postShout failed:', error.message)
    return null
  }
  return data?.id ?? null
}

// ── getActiveShouts ───────────────────────────────────────
// Returns all shouts created in the last 30 seconds, newest first.
// One row per shout — caller groups by pet_id.
export async function getActiveShouts(): Promise<ShoutRecord[]> {
  const cutoff = new Date(Date.now() - 30_000).toISOString()

  const { data, error } = await supabase
    .from('shouts')
    .select('*')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[petService] getActiveShouts failed:', error.message)
    return []
  }
  return (data ?? []) as ShoutRecord[]
}

// ── countTodayShouts ──────────────────────────────────────
// Returns how many shouts the current user has posted today (midnight-based).
export async function countTodayShouts(): Promise<number> {
  const userId = useAuthStore.getState().userId
  if (!userId) return 0

  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const { count, error } = await supabase
    .from('shouts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', startOfDay.toISOString())

  if (error) {
    console.error('[petService] countTodayShouts failed:', error.message)
    return 0
  }
  return count ?? 0
}

// ── likeShout ─────────────────────────────────────────────
// Calls the like_shout RPC which records the like and credits
// the pet owner's like_balance atomically.
export async function likeShout(shoutId: string): Promise<void> {
  const userId = useAuthStore.getState().userId
  if (!userId) return

  const { error } = await supabase.rpc('like_shout', {
    p_shout_id: shoutId,
    p_liker_id: userId,
  })

  if (error) {
    console.error('[petService] likeShout failed:', error.message)
  }
}

// ══════════════════════════════════════════════════════════
// Like-balance economy (food redemption)
// ══════════════════════════════════════════════════════════

// ── getLikeBalance ────────────────────────────────────────
// Returns the current user's like balance (0 if no row exists yet).
export async function getLikeBalance(): Promise<number> {
  const userId = useAuthStore.getState().userId
  if (!userId) return 0

  const { data, error } = await supabase
    .from('like_balance')
    .select('balance')
    .eq('user_id', userId)
    .single()

  if (error) {
    // PGRST116 = no rows → user has never received a like yet
    if (error.code !== 'PGRST116') {
      console.error('[petService] getLikeBalance failed:', error.message)
    }
    return 0
  }
  return (data?.balance ?? 0) as number
}

// ── redeemLikesForFood ────────────────────────────────────
// Calls the redeem_likes RPC to atomically deduct p_cost from
// the user's balance. Returns true on success, false if balance
// is insufficient or the RPC fails.
export async function redeemLikesForFood(cost: 5 | 20): Promise<boolean> {
  const userId = useAuthStore.getState().userId
  if (!userId) return false

  const { data, error } = await supabase.rpc('redeem_likes', {
    p_user_id: userId,
    p_cost:    cost,
  })

  if (error) {
    console.error('[petService] redeemLikesForFood failed:', error.message)
    return false
  }
  return (data as boolean) ?? false
}

// ══════════════════════════════════════════════════════════
// Subscription
// ══════════════════════════════════════════════════════════

export async function checkSubscription(): Promise<boolean> {
  const userId = useAuthStore.getState().userId
  if (!userId) return false
  try {
    const { data, error } = await supabase.rpc('check_subscription', { p_user_id: userId })
    if (error) return false
    return (data as boolean) ?? false
  } catch {
    return false
  }
}

export interface AdRecord {
  id:       string
  text:     string
  sub_text: string
  logo_url: string | null
  url:      string
  duration: number
}

export async function fetchAds(): Promise<AdRecord[]> {
  const { data, error } = await supabase
    .from('ads')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
  if (error) return []
  return (data ?? []) as AdRecord[]
}

export async function getPetAge(): Promise<number | null> {
  const petId = localStorage.getItem('oodle_pet_supabase_id')
  if (!petId) return null
  try {
    const { data, error } = await supabase
      .from('pets')
      .select('created_at')
      .eq('id', petId)
      .single()
    if (error || !data) return null
    return Math.floor((Date.now() - new Date((data as { created_at: string }).created_at).getTime()) / 86400000)
  } catch {
    return null
  }
}
