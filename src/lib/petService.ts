import { supabase } from './supabase'
import { useAuthStore } from './auth'
import type { PetCoords } from '../api/aiRecognize'

// ── Types ─────────────────────────────────────────────────
export interface PetRecord {
  id:            string
  user_id:       string
  name:          string
  pixel_data:    string
  coords:        PetCoords | null
  created_at:    string
  last_seen?:    string
  is_online:      boolean
  growth_points:  number
  talent?:        string
  talent_drawing?: string
  accessory?:            string | null
  propeller_expiry?:     number | null
  original_created_at?:  string | null
  coins?:                number
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
  let userId = useAuthStore.getState().userId
  if (!userId) {
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
  }
  if (!userId) return null

  // Check Supabase for an existing pet for this user before trusting localStorage
  const { data: existingPet } = await supabase
    .from('pets')
    .select('id, is_dead')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingPet) {
    const ep = existingPet as { id: string; is_dead: boolean }
    if (!ep.is_dead) {
      // Lock user to their existing alive pet
      localStorage.setItem(LOCAL_PET_ID_KEY, ep.id)
      return ep.id
    } else {
      // Dead pet — clear cached id so a new one can be created
      localStorage.removeItem(LOCAL_PET_ID_KEY)
    }
  }

  // Idempotency: don't insert a second time for the same browser session
  const cached = localStorage.getItem(LOCAL_PET_ID_KEY)
  if (cached) return cached

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('pets')
    .insert({
      user_id:              userId,
      name:                 pet.name,
      pixel_data:           pet.pixelData,
      coords:               pet.coords,
      growth_points:        parseInt(localStorage.getItem('oodle_growth') ?? '0', 10),
      last_seen:            now,
      is_online:            true,
      original_created_at:  now,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[petService] savePet failed:', error.message)
    return null
  }

  const id = data?.id ?? null
  if (id) {
    localStorage.setItem(LOCAL_PET_ID_KEY, id)
    localStorage.setItem('oodle_pet_created_at', String(Date.now()))
    localStorage.setItem('oodle_pet_original_created_at', now)
  }
  return id
}

// ── fetchUserPet ─────────────────────────────────────────
// Returns the signed-in user's current alive pet, or null if none exists.
// Also returns originalCreatedAt so callers can cache it for cross-device day counts.
export async function fetchUserPet(): Promise<{
  id: string
  name: string
  pixelData: string
  coords: PetCoords
  originalCreatedAt: string | null
} | null> {
  let userId = useAuthStore.getState().userId
  if (!userId) {
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
  }
  if (!userId) return null

  const { data, error } = await supabase
    .from('pets')
    .select('id, name, pixel_data, coords, original_created_at')
    .eq('user_id', userId)
    .eq('is_dead', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  const pet = data as { id: string; name: string; pixel_data: string; coords: PetCoords; original_created_at: string | null }
  return {
    id:                pet.id,
    name:              pet.name,
    pixelData:         pet.pixel_data,
    coords:            pet.coords,
    originalCreatedAt: pet.original_created_at ?? null,
  }
}

// ── syncLoginStreak ───────────────────────────────────────
// Reads streak data from the pets table (read-only).
// Uses reward_claimed_date for claimedToday so that the DB column default
// (last_login_date = CURRENT_DATE) does not falsely show reward as claimed.
export async function syncLoginStreak(): Promise<{ streak: number; claimedToday: boolean }> {
  const petId = localStorage.getItem('oodle_pet_supabase_id')
  if (!petId) return { streak: 1, claimedToday: false }

  const today     = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('pets')
    .select('streak, last_login_date, reward_claimed_date')
    .eq('id', petId)
    .single()

  if (error || !data) return { streak: 1, claimedToday: false }

  const row               = data as { streak: number | null; last_login_date: string | null; reward_claimed_date: string | null }
  const dbStreak          = row.streak ?? 1
  const lastLogin         = row.last_login_date
  const rewardClaimedDate = row.reward_claimed_date

  const claimedToday = rewardClaimedDate === today

  if (lastLogin === today)     return { streak: dbStreak,     claimedToday }
  if (lastLogin === yesterday) return { streak: dbStreak + 1, claimedToday }
  return { streak: 1, claimedToday: false }
}

// ── claimDailyStreak ──────────────────────────────────────
// Writes streak + both date columns. reward_claimed_date is the source of
// truth for whether the user actually pressed CLAIM (not last_login_date).
export async function claimDailyStreak(streak: number): Promise<void> {
  const petId = localStorage.getItem('oodle_pet_supabase_id')
  if (!petId) return
  const today = new Date().toISOString().slice(0, 10)
  const { error } = await supabase
    .from('pets')
    .update({ streak, last_login_date: today, reward_claimed_date: today })
    .eq('id', petId)
  if (error) console.error('[petService] claimDailyStreak failed:', error.message)
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

// ── updateGrowth ──────────────────────────────────────────
// Syncs the current user's growth_points to Supabase.
export async function updateGrowth(): Promise<void> {
  const petId = localStorage.getItem('oodle_pet_supabase_id')
  if (!petId) return
  const growth = parseInt(localStorage.getItem('oodle_growth') ?? '0', 10)
  await supabase.from('pets').update({ growth_points: growth }).eq('id', petId)
}

// ── saveTalent ────────────────────────────────────────────
export async function saveTalent(talent: string): Promise<void> {
  const petId = localStorage.getItem('oodle_pet_supabase_id')
  if (!petId) return
  await supabase.from('pets').update({ talent }).eq('id', petId)
}

// ── saveTalentDrawing ─────────────────────────────────────
export async function saveTalentDrawing(drawingData: string): Promise<void> {
  const petId = localStorage.getItem('oodle_pet_supabase_id')
  if (!petId) return
  await supabase.from('pets').update({ talent_drawing: drawingData, talent: 'drawing' }).eq('id', petId)
}

// ── setOnlineStatus ───────────────────────────────────────
// Sets the pet's is_online flag. Call with true on Plaza enter, false on leave.
export async function setOnlineStatus(petId: string, online: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_pet_online', {
    p_pet_id: petId,
    p_online: online,
  })
  if (error) console.error('[petService] setOnlineStatus failed:', error.message)
}

// ── pingOnline ────────────────────────────────────────────
// Heartbeat: stamps last_seen to now so the pet stays visible in Plaza.
export async function pingOnline(): Promise<void> {
  const petId = localStorage.getItem('oodle_pet_supabase_id')
  if (!petId) return
  await supabase.rpc('ping_pet_online', { p_pet_id: petId })
}

// ── killPet ───────────────────────────────────────────────
// Marks the current pet as dead in Supabase.
export async function killPet(): Promise<void> {
  const petId = localStorage.getItem('oodle_pet_supabase_id')
  if (!petId) return
  await supabase.from('pets').update({ is_dead: true, died_at: new Date().toISOString() }).eq('id', petId)
}

// ── checkPetDead ──────────────────────────────────────────
// Returns true if the user's most recent pet is marked dead.
export async function checkPetDead(): Promise<boolean> {
  const userId = useAuthStore.getState().userId
  if (!userId) return false
  const { data } = await supabase
    .from('pets')
    .select('is_dead')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { is_dead: boolean } | null)?.is_dead ?? false
}

// ── fetchAllPets ──────────────────────────────────────────
// Returns pets active in the last 45 seconds, ordered newest first.
// Returns [] on failure (caller should fall back to localStorage).
export async function fetchAllPets(): Promise<PetRecord[]> {
  const { data, error } = await supabase
    .from('pets')
    .select('*')
    .gte('last_seen', new Date(Date.now() - 20_000).toISOString())
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

// ── thumbsUpPet ───────────────────────────────────────────
// Inserts a thumbs-up into pet_thumbsup (one per pet per day).
// Relies on the DB unique constraint to block duplicates.
// Does NOT touch like_balance — that is shout-likes only.
export async function thumbsUpPet(petId: string): Promise<{ success: boolean; reason?: string }> {
  const userId = useAuthStore.getState().userId
  if (!userId) return { success: false, reason: 'not_logged_in' }

  const todayStr = new Date().toISOString().slice(0, 10)

  const { error } = await supabase
    .from('pet_thumbsup')
    .insert({ pet_id: petId, user_id: userId, like_date: todayStr })

  if (error) {
    if (error.code === '23505') return { success: false, reason: 'already_liked' }
    console.error('[petService] thumbsUpPet insert failed:', error.message)
    return { success: false, reason: 'error' }
  }

  return { success: true }
}

// ── getTodayThumbsUpPetIds ────────────────────────────────
// Returns the set of pet ids the current user has thumbs-up'd today.
export async function getTodayThumbsUpPetIds(): Promise<Set<string>> {
  const userId = useAuthStore.getState().userId
  if (!userId) return new Set()

  const todayStr = new Date().toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('pet_thumbsup')
    .select('pet_id')
    .eq('user_id', userId)
    .eq('like_date', todayStr)

  if (error) {
    console.error('[petService] getTodayThumbsUpPetIds failed:', error.message)
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

// ── getShoutOwner ─────────────────────────────────────────
// Returns the user_id of whoever posted the given shout, or null.
export async function getShoutOwner(shoutId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('shouts')
    .select('user_id')
    .eq('id', shoutId)
    .single()
  if (error || !data) return null
  return (data as { user_id: string }).user_id
}

// ── likeShout ─────────────────────────────────────────────
// Calls the like_shout RPC atomically. Silently ignores unique constraint
// violations (23505) since the DB already enforced the limit.
export async function likeShout(shoutId: string): Promise<void> {
  const userId = useAuthStore.getState().userId
  if (!userId) return

  const { error } = await supabase.rpc('like_shout', {
    p_shout_id: shoutId,
    p_liker_id: userId,
  })

  if (error && error.code !== '23505') {
    console.error('[petService] likeShout failed:', error.message)
  }
}

// ══════════════════════════════════════════════════════════
// Like-balance economy (food redemption)
// ══════════════════════════════════════════════════════════

// ── getLikeBalance ────────────────────────────────────────
// Returns the current user's like balance (0 if no row exists yet).
export async function getLikeBalance(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser()
  console.log('[likes] auth uid:', user?.id)
  if (!user) return 0
  const { data, error } = await supabase
    .from('like_balance')
    .select('balance')
    .eq('user_id', user.id)
    .maybeSingle()
  console.log('[likes] query result:', data, error)
  if (error) return 0
  return (data?.balance ?? 0) as number
}

// ── redeemLikesForFood ────────────────────────────────────
// Calls the redeem_likes RPC to atomically deduct p_cost from
// the user's balance. Returns true on success, false if balance
// is insufficient or the RPC fails.
export async function redeemLikesForFood(cost: 5 | 10): Promise<boolean> {
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

// ── unlikePet ─────────────────────────────────────────────
export async function unlikePet(petId: string): Promise<void> {
  const userId = useAuthStore.getState().userId
  if (!userId) return
  const { error } = await supabase
    .from('pet_unlikes')
    .insert({ pet_id: petId, user_id: userId })
  if (error) console.error('[petService] unlikePet failed:', error.message)
  // Check if jail threshold reached
  await supabase.rpc('check_pet_unlikes', { p_pet_id: petId })
}

// ── checkJailStatus ───────────────────────────────────────
export async function checkJailStatus(): Promise<Date | null> {
  const petId = localStorage.getItem('oodle_pet_supabase_id')
  if (!petId) return null
  const { data } = await supabase
    .from('pets')
    .select('jailed_until')
    .eq('id', petId)
    .maybeSingle()
  if (!(data as { jailed_until?: string } | null)?.jailed_until) return null
  const until = new Date((data as { jailed_until: string }).jailed_until)
  return until > new Date() ? until : null
}

// ── jailPet ───────────────────────────────────────────────
export async function jailPet(petId: string, hours: number): Promise<void> {
  const until = new Date(Date.now() + hours * 3600000).toISOString()
  await supabase.from('pets').update({ jailed_until: until }).eq('id', petId)
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

// ── saveAccessory ─────────────────────────────────────────
// Persists the pet's equipped accessory (e.g. 'propeller') to Supabase.
// Pass null to remove the accessory.
export async function saveAccessory(accessory: string | null): Promise<void> {
  const petId = localStorage.getItem('oodle_pet_supabase_id')
  if (!petId) return
  await supabase.from('pets').update({ accessory }).eq('id', petId)
}

// ── savePropellerExpiry ────────────────────────────────────
// Writes the temp-propeller expiry timestamp to Supabase so other
// players' browsers can see this pet is flying.
export async function savePropellerExpiry(expiry: number): Promise<void> {
  const petId = localStorage.getItem('oodle_pet_supabase_id')
  if (!petId) return
  const { error } = await supabase
    .from('pets')
    .update({ propeller_expiry: expiry })
    .eq('id', petId)
  if (error) {
    console.error('[petService] savePropellerExpiry failed:', error.message)
  } else {
    console.log('propeller_expiry saved to DB:', expiry)
  }
}

// ── getCoins ──────────────────────────────────────────────
// Returns the pet's current coin balance from Supabase.
export async function getCoins(): Promise<number> {
  const petId = localStorage.getItem('oodle_pet_supabase_id')
  if (!petId) return 0
  const { data } = await supabase.from('pets').select('coins').eq('id', petId).single()
  return (data as { coins?: number } | null)?.coins ?? 0
}

// ── addCoins ──────────────────────────────────────────────
// Credits coins to the pet via Supabase RPC.
export async function addCoins(amount: number): Promise<void> {
  const petId = localStorage.getItem('oodle_pet_supabase_id')
  if (!petId) return
  await supabase.rpc('add_coins', { p_pet_id: petId, p_amount: amount })
}

// ── fetchParadePets ───────────────────────────────────────
// Returns a random sample of recently-created pets for the Draw page parade.
// Unlike fetchAllPets, does NOT filter by last_seen — offline pets are included.
export async function fetchParadePets(limit = 10): Promise<PetRecord[]> {
  const { data, error } = await supabase
    .from('pets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30)

  if (error || !data) return []

  const arr = [...(data as PetRecord[])]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp
  }
  return arr.slice(0, limit)
}

// ── getPetById ────────────────────────────────────────────
// Fetches a single pet by id, used for shared pet link banners.
// Returns null on error or if the pet doesn't exist.
export async function getPetById(petId: string): Promise<PetRecord | null> {
  const { data, error } = await supabase
    .from('pets')
    .select('*')
    .eq('id', petId)
    .single()
  if (error || !data) return null
  return data as PetRecord
}

// ══════════════════════════════════════════════════════════
// Breeding system
// ══════════════════════════════════════════════════════════

export interface BreedRequestRecord {
  id:               string
  requester_pet_id: string
  target_pet_id:    string
  status:           string
  created_at:       string
  requester_pet?:   { name: string; pixel_data: string } | null
}

export interface EggRecord {
  id:              string
  owner_pet_id:    string
  parent_pet_id_1: string
  parent_pet_id_2: string
  pixel_data:      string
  warm_count:      number
  hatched:         boolean
  hatched_at:      string | null
  baby_expires_at: string | null
  created_at:      string
}

export async function sendBreedRequest(
  myPetId:     string,
  targetPetId: string,
): Promise<{ error?: string }> {
  const { data: myPet, error: petErr } = await supabase
    .from('pets')
    .select('created_at, last_breed_at')
    .eq('id', myPetId)
    .single()

  if (petErr || !myPet) return { error: 'pet_not_found' }

  const pet   = myPet as { created_at: string; last_breed_at: string | null }
  const days  = Math.floor((Date.now() - new Date(pet.created_at).getTime()) / 86400000)
  if (days < 10) return { error: 'too_young' }

  if (pet.last_breed_at) {
    const daysSince = (Date.now() - new Date(pet.last_breed_at).getTime()) / 86400000
    if (daysSince < 7) return { error: 'cooldown' }
  }

  const { error } = await supabase
    .from('breed_requests')
    .insert({ requester_pet_id: myPetId, target_pet_id: targetPetId, status: 'pending' })

  if (error) {
    console.error('[petService] sendBreedRequest failed:', error.message)
    return { error: 'insert_failed' }
  }
  return {}
}

export async function respondBreedRequest(requestId: string, accept: boolean): Promise<void> {
  if (!accept) {
    await supabase.from('breed_requests').update({ status: 'declined' }).eq('id', requestId)
    return
  }

  await supabase.from('breed_requests').update({ status: 'accepted' }).eq('id', requestId)

  const { data: req } = await supabase
    .from('breed_requests')
    .select('requester_pet_id, target_pet_id')
    .eq('id', requestId)
    .single()

  if (!req) return
  const breedReq = req as { requester_pet_id: string; target_pet_id: string }
  await createEggs({ id: requestId, ...breedReq })
}

export async function createEggs(request: {
  id:               string
  requester_pet_id: string
  target_pet_id:    string
}): Promise<void> {
  const { data: petsData } = await supabase
    .from('pets')
    .select('id, pixel_data')
    .in('id', [request.requester_pet_id, request.target_pet_id])

  if (!petsData || petsData.length < 2) return

  const petsArr = petsData as { id: string; pixel_data: string }[]
  const pet1    = petsArr.find(p => p.id === request.requester_pet_id)
  const pet2    = petsArr.find(p => p.id === request.target_pet_id)
  if (!pet1 || !pet2) return

  try {
    const res = await fetch('/api/breed/create-eggs', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pet1PixelData: pet1.pixel_data, pet2PixelData: pet2.pixel_data }),
    })
    if (!res.ok) { console.error('[petService] createEggs API error:', res.status); return }

    const { babyPixelData } = await res.json() as { babyPixelData?: string }
    if (!babyPixelData) return

    const eggBase = {
      pixel_data:      babyPixelData,
      warm_count:      0,
      hatched:         false,
      parent_pet_id_1: pet1.id,
      parent_pet_id_2: pet2.id,
    }

    await Promise.all([
      supabase.from('eggs').insert({ ...eggBase, owner_pet_id: pet1.id }),
      supabase.from('eggs').insert({ ...eggBase, owner_pet_id: pet2.id }),
      supabase.from('pets').update({ last_breed_at: new Date().toISOString() }).in('id', [pet1.id, pet2.id]),
      supabase.from('breed_requests').update({ status: 'completed' }).eq('id', request.id),
    ])
  } catch (err) {
    console.error('[petService] createEggs failed:', err)
  }
}

export async function fetchMyEgg(): Promise<EggRecord | null> {
  const petId = localStorage.getItem('oodle_pet_supabase_id')
  if (!petId) return null

  const { data, error } = await supabase
    .from('eggs')
    .select('*')
    .eq('owner_pet_id', petId)
    .eq('hatched', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) { console.error('[petService] fetchMyEgg failed:', error.message); return null }
  return (data as EggRecord | null) ?? null
}

export async function warmEgg(eggId: string): Promise<{ hatched: boolean }> {
  const { data: egg, error } = await supabase
    .from('eggs')
    .select('warm_count, pixel_data, owner_pet_id')
    .eq('id', eggId)
    .single()

  if (error || !egg) return { hatched: false }

  const eggData = egg as { warm_count: number; pixel_data: string; owner_pet_id: string }

  if (eggData.warm_count >= 2) {
    await hatchEgg(eggId)
    return { hatched: true }
  }

  await supabase.from('eggs').update({ warm_count: eggData.warm_count + 1 }).eq('id', eggId)
  return { hatched: false }
}

export async function hatchEgg(eggId: string): Promise<void> {
  const { data: egg, error } = await supabase
    .from('eggs')
    .select('pixel_data, owner_pet_id')
    .eq('id', eggId)
    .single()

  if (error || !egg) return

  const eggData       = egg as { pixel_data: string; owner_pet_id: string }
  const babyExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString()

  await Promise.all([
    supabase.from('eggs').update({ hatched: true, hatched_at: new Date().toISOString() }).eq('id', eggId),
    supabase.from('pets').update({ baby_pixel_data: eggData.pixel_data, baby_expires_at: babyExpiresAt }).eq('id', eggData.owner_pet_id),
  ])
}

export async function checkBreedRequests(myPetId: string): Promise<BreedRequestRecord[]> {
  const { data, error } = await supabase
    .from('breed_requests')
    .select('*, requester_pet:requester_pet_id(name, pixel_data)')
    .eq('target_pet_id', myPetId)
    .eq('status', 'pending')

  if (error) { console.error('[petService] checkBreedRequests failed:', error.message); return [] }
  return (data ?? []) as BreedRequestRecord[]
}

export async function fetchMyBabyData(): Promise<{ baby_pixel_data: string; baby_expires_at: string } | null> {
  const petId = localStorage.getItem('oodle_pet_supabase_id')
  if (!petId) return null

  const { data, error } = await supabase
    .from('pets')
    .select('baby_pixel_data, baby_expires_at')
    .eq('id', petId)
    .single()

  if (error || !data) return null
  const row = data as { baby_pixel_data: string | null; baby_expires_at: string | null }
  if (!row.baby_pixel_data || !row.baby_expires_at) return null
  if (Date.now() > new Date(row.baby_expires_at).getTime()) return null
  return { baby_pixel_data: row.baby_pixel_data, baby_expires_at: row.baby_expires_at }
}
